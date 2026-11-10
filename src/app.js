const path = require('path')
const express = require('express')
const createRateLimiter = require('ratelimit-kit')
const { parseSearchParams } = require('./params')
const { createPlans } = require('./plans')
const { createPaygate } = require('./paygate')
const { mountMediaRoutes } = require('./media-routes')
const { mountMemberRoutes } = require('./member-routes')
const { createSharePage } = require('./share-page')
const { createShowLibrary } = require('./shows')
const { createNewsletter } = require('./newsletter')
const { createShowArtwork } = require('./show-artwork')
const { createAnnotator } = require('./annotator')
const { createTranscriptLibrary } = require('./transcripts')
const { createDictionary } = require('./dictionary')
const { createLessonSource, mountLessonRoutes } = require('./lessons')
const { createSongLibrary, createUserSongs, mountSongRoutes } = require('./songs')
const { createYtDlp, importFromYouTube } = require('./song-import')
const { mountStudyRoutes, mountDictionaryRoute, createDailyUsage } = require('./study-routes')

const PUBLIC_DIR = path.join(__dirname, '..', 'public')
const SHOW_ID_PATTERN = /^[a-z0-9-]{1,80}$/

const LANG_PATTERN = /^[a-z]{2,3}$/
// 播放網址的有效時間:夠一個人開著頁面慢慢看,過了就要重新搜尋
const VIDEO_TTL_MS = 3 * 60 * 60_000

// 片源給的數字欄位一律轉成數字再出去(前端會直接放進畫面,不能讓片源塞字串進來)
function toNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

// LetMeUse webhook 的內容:{ event, payload: { userId, email, displayName }, ... }
// 事件名稱要從內容讀:簽章只保護內容,標頭上的事件名稱誰都能改
// (不然拿一份簽過章的登入通知、把標頭改成「註冊」重送,就能觸發訂閱)。
function registrationPayload(rawBody) {
  try {
    const { event, payload } = JSON.parse(Buffer.from(rawBody).toString('utf8'))
    if (event !== 'user.registered') return null
    if (!payload || typeof payload.email !== 'string') return null
    return { email: payload.email, name: payload.displayName }
  } catch {
    return null
  }
}

// Express 4 不會接 async handler 丟出來的錯,包一層交給錯誤處理
function wrapAsync(app) {
  for (const method of ['get', 'post']) {
    const original = app[method].bind(app)
    app[method] = (route, ...handlers) =>
      original(
        route,
        ...handlers.map((handler) =>
          handler.length >= 4
            ? handler
            : (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
        )
      )
  }
}

function createApp({
  clipcafe,
  auth,
  tokens,
  freeLimit = 3,
  memberLimit = 0,
  plans = createPlans({ guestLimit: freeLimit, memberLimit }),
  paygate = createPaygate(),
  publicUrl = '',
  strictPlayback = false,
  shows = createShowLibrary({ dir: path.join(__dirname, '..', 'data', 'shows') }),
  newsletter = createNewsletter(),
  annotator = createAnnotator(),
  dictionary = createDictionary({ dir: path.join(__dirname, '..', 'data', 'dictionary') }),
  lessons = createLessonSource(),
  transcripts = createTranscriptLibrary({ dir: path.join(__dirname, '..', 'data', 'transcripts') }),
  songs = createSongLibrary({ dir: path.join(__dirname, '..', 'data', 'songs') }),
  mySongs = createUserSongs({ dir: path.join(__dirname, '..', 'data', 'songs', 'users') }),
  // 會員貼連結加歌:要有 yt-dlp 才開放(SONG_IMPORT=0 可以關掉)
  songImporter = process.env.SONG_IMPORT === '0'
    ? null
    : ((ytdlp) => (url) => importFromYouTube(url, { ytdlp }))(createYtDlp()),
  letmeuse = {}
}) {
  if (!tokens) throw new Error('createApp needs media tokens')

  const app = express()
  app.disable('x-powered-by')
  wrapAsync(app)

  const limiter = createRateLimiter({ windowMs: 60_000 })
  const clientIp = createRateLimiter.clientIp

  // 分享預覽要用的圖:這句片語的第一個片段(訪客也看得到的那一個)
  const sharePage = createSharePage({
    indexPath: path.join(PUBLIC_DIR, 'index.html'),
    publicUrl,
    lookupImage: async (phrase) => {
      const data = await clipcafe.search({ q: phrase, size: 1, from: 0, slop: 0 })
      const first = (data.results || [])[0]
      return first && first.slug ? `/og/${tokens.seal('id', first.slug)}.jpg` : null
    }
  })

  // 帶片語的首頁(/?q=…)由這裡送出,<head> 換成那句片語的預覽;其他照常走靜態檔。
  // 要排在 express.static 前面,不然首頁會先被靜態檔接走。
  app.get('/', async (req, res, next) => {
    if (req.query.q === undefined) return next()
    const html = limiter.check(`share:${clientIp(req)}`, 60).allowed ? await sharePage.render(req.query.q) : null
    if (!html) return next()
    res.set('Cache-Control', 'public, max-age=0')
    return res.type('html').send(html)
  })

  app.get('/watch', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'watch.html')))
  app.get('/lessons', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'lessons.html')))
  app.get('/type', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'type.html')))

  app.use(express.static(PUBLIC_DIR))

  // webhook 要驗 raw body 的 HMAC,必須排在 json parser 之前
  app.post('/api/webhooks/letmeuse', express.raw({ type: '*/*' }), (req, res) => {
    const signature = req.get('X-LetMeUse-Signature')
    // 沒有內容的請求 req.body 不是 Buffer,直接當簽章不對
    if (!Buffer.isBuffer(req.body) || !auth.verifyWebhookSignature(req.body, signature)) {
      return res.status(401).json({ success: false, error: 'invalid signature' })
    }
    const event = req.get('X-LetMeUse-Event') || 'unknown'
    // 新會員註冊 → 同步到電子報名單(不等它,webhook 要馬上回)
    const registered = registrationPayload(req.body)
    if (registered) newsletter.subscribe(registered).catch(() => {})
    process.stdout.write(`[letmeuse-webhook] ${event}\n`)
    res.json({ received: true })
  })

  mountMediaRoutes(app, { clipcafe, tokens, limiter, clientIp, strictPlayback })

  app.use(express.json({ limit: '100kb' }))

  // 驗不過、驗到一半出錯,一律當未登入(fail closed)
  async function currentUser(req) {
    const token = auth.extractBearer(req.get('Authorization'))
    if (!token) return null
    try {
      return await auth.verifyToken(token)
    } catch (err) {
      process.stderr.write(`[auth] verify failed: ${err.message}\n`)
      return null
    }
  }

  // 這個請求是誰、哪個等級:guest(沒登入)/ free(免費會員)/ pro(付費)
  async function viewer(req, { fresh = false } = {}) {
    const user = await currentUser(req)
    if (!user) return { user: null, tier: 'guest', activeUntil: null }
    const { tier, activeUntil } = await paygate.tierFor(user.email, { fresh })
    return { user, tier, activeUntil }
  }

  // 片源給的資料 → 對外的樣子。slug、mp4 網址這些會洩漏片源的欄位一律不出去。
  function toPublicClip(clip, tier) {
    const id = tokens.seal('id', clip.slug)
    const langs = plans.can(tier, 'subtitles')
      ? (Array.isArray(clip.subLangs) ? clip.subLangs : []).filter((lang) => LANG_PATTERN.test(lang))
      : []
    return {
      id,
      text: typeof clip.text === 'string' ? clip.text : '',
      movieTitle: typeof clip.movieTitle === 'string' ? clip.movieTitle : '',
      movieYear: toNumber(clip.movieYear),
      season: toNumber(clip.season),
      episode: toNumber(clip.episode),
      duration: toNumber(clip.duration),
      quality: typeof clip.quality === 'string' ? clip.quality : '',
      video: `/v/${tokens.seal('v', clip.slug, { ttlMs: VIDEO_TTL_MS })}`,
      thumb: `/thumb/${id}.jpg`,
      subs: langs.map((lang) => ({ lang, url: `/sub/${id}/${lang}.vtt` }))
    }
  }

  app.get('/api/config', async (req, res) => {
    const billingReady = paygate.enabled && Boolean(publicUrl)
    res.set('Cache-Control', 'no-store')
    res.json({
      success: true,
      data: {
        letmeuse: {
          appId: letmeuse.appId || null,
          baseUrl: letmeuse.baseUrl || null
        },
        freeLimit,
        tiers: plans.summary(),
        // 註冊會同步到電子報名單時,前端要在登入按鈕旁邊講清楚
        newsletter: newsletter.enabled,
        // 「逐句解析」有沒有開(要接上標註引擎才有)
        study: annotator.enabled || dictionary.enabled,
        // 點字查詞用的離線字典有沒有載入
        dictionary: dictionary.enabled,
        lessons: lessons.enabled,
        // 聽歌練英打有沒有歌可以練
        songs: songs.enabled,
        // 會員能不能自己貼 YouTube 連結加歌
        songImport: Boolean(songImporter && mySongs.enabled),
        billing: { enabled: billingReady, plan: billingReady ? await paygate.plan() : null }
      }
    })
  })

  mountMemberRoutes(app, { viewer, plans, paygate, tokens, limiter, publicUrl })
  mountStudyRoutes(app, {
    viewer,
    plans,
    tokens,
    clipcafe,
    annotator,
    dictionary,
    shows,
    transcripts,
    usage: createDailyUsage(),
    limiter,
    clientIp
  })
  mountDictionaryRoute(app, { dictionary, limiter, clientIp })
  mountLessonRoutes(app, { source: lessons, viewer, plans, limiter, clientIp })
  mountSongRoutes(app, {
    songs,
    viewer,
    plans,
    limiter,
    clientIp,
    mySongs,
    importer: songImporter,
    // 挑難字要靠離線字典(level 1 最常用 … 5 少見)
    dictionary,
    // 「一天能加幾支」跟逐句解析共用同一套每日計數
    usage: createDailyUsage()
  })

  // 看劇區:有哪些劇、某一季的每一集(標題與劇情介紹,中英文)
  const artwork = createShowArtwork({ clipcafe, tokens })

  // 封面還沒找到的回應只快取一下下,免得「沒圖」的版本被瀏覽器留五分鐘
  function showCache(res, complete) {
    res.set('Cache-Control', complete ? 'public, max-age=300' : 'public, max-age=20')
  }

  app.get('/api/shows', async (req, res) => {
    const list = await Promise.all(
      shows.list().map(async (show) => ({
        ...show,
        seasons: await Promise.all(
          show.seasons.map(async (season) => ({ ...season, artwork: await artwork.get(show, season.season) }))
        )
      }))
    )
    showCache(res, list.every((show) => show.seasons.every((season) => season.artwork)))
    res.json({ success: true, data: { shows: list } })
  })

  app.get('/api/shows/:id/seasons/:season', async (req, res) => {
    const number = Number.parseInt(req.params.season, 10)
    const season = SHOW_ID_PATTERN.test(req.params.id) && Number.isInteger(number) ? shows.season(req.params.id, number) : null
    if (!season) return res.status(404).json({ success: false, error: 'season not found' })
    const art = await artwork.get(season.show, number)
    showCache(res, Boolean(art))
    // 哪幾集已經匯入整集台詞,前端才知道要不要顯示入口
    const episodes = season.episodes.map((ep) => ({
      ...ep,
      hasTranscript: transcripts.has(req.params.id, number, ep.number)
    }))
    return res.json({ success: true, data: { ...season, episodes, artwork: art } })
  })

  app.get('/api/search', async (req, res) => {
    const { params, error } = parseSearchParams(req.query)
    if (error) {
      return res.status(400).json({ success: false, error })
    }
    if (!limiter.check(`search:${clientIp(req)}`, 90).allowed) {
      res.set('Retry-After', '30')
      return res.status(429).json({ success: false, error: '搜尋太頻繁了,等一下再試' })
    }

    const { tier } = await viewer(req)
    const limit = plans.resultLimit(tier)
    const gated = limit !== null
    const effective = gated ? { ...params, from: 0, size: Math.min(params.size, limit) } : params

    try {
      const data = await clipcafe.search(effective)
      const visible = gated ? (data.results || []).slice(0, limit) : data.results || []
      // 結果跟登入身分有關,而且每次簽的播放網址都不同:不能讓瀏覽器拿訪客時的舊結果來用
      res.set('Cache-Control', 'no-store')
      res.json({
        success: true,
        data: {
          ...data,
          results: visible.filter((clip) => clip && clip.slug).map((clip) => toPublicClip(clip, tier)),
          limited: gated && data.total > limit,
          tier
        }
      })
    } catch (err) {
      process.stderr.write(`[search] q=${JSON.stringify(params.q)}: ${err.message}\n`)
      res.status(502).json({ success: false, error: '搜尋服務暫時出錯,稍後再試' })
    }
  })

  app.use((req, res) => {
    res.status(404).json({ success: false, error: 'not found' })
  })

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // 網址編碼壞掉、內容格式不對這類是對方的問題:回 4xx 就好,不要當成伺服器出錯去記一大段
    if (err.status >= 400 && err.status < 500 && !res.headersSent) {
      res.set('Cache-Control', 'no-store')
      return res.status(err.status).json({ success: false, error: 'bad request' })
    }
    process.stderr.write(`[unhandled] ${req.method} ${req.originalUrl}: ${err.stack}\n`)
    // 已經送到一半就只能斷線,不然連線會掛著
    if (res.headersSent) return res.destroy()
    res.set('Cache-Control', 'no-store')
    res.status(500).json({ success: false, error: 'internal error' })
  })

  return app
}

module.exports = { createApp }

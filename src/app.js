const path = require('path')
const express = require('express')
const createRateLimiter = require('ratelimit-kit')
const { parseSearchParams } = require('./params')
const { createPlans } = require('./plans')
const { createPaygate } = require('./paygate')
const { mountMediaRoutes } = require('./media-routes')
const { mountMemberRoutes } = require('./member-routes')

const LANG_PATTERN = /^[a-z]{2,3}$/
// 播放網址的有效時間:夠一個人開著頁面慢慢看,過了就要重新搜尋
const VIDEO_TTL_MS = 3 * 60 * 60_000

// 片源給的數字欄位一律轉成數字再出去(前端會直接放進畫面,不能讓片源塞字串進來)
function toNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
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
  letmeuse = {}
}) {
  if (!tokens) throw new Error('createApp needs media tokens')

  const app = express()
  app.disable('x-powered-by')
  app.use(express.static(path.join(__dirname, '..', 'public')))

  const limiter = createRateLimiter({ windowMs: 60_000 })
  const clientIp = createRateLimiter.clientIp

  // webhook 要驗 raw body 的 HMAC,必須排在 json parser 之前
  app.post('/api/webhooks/letmeuse', express.raw({ type: '*/*' }), (req, res) => {
    const signature = req.get('X-LetMeUse-Signature')
    if (!auth.verifyWebhookSignature(req.body, signature)) {
      return res.status(401).json({ success: false, error: 'invalid signature' })
    }
    const event = req.get('X-LetMeUse-Event') || 'unknown'
    process.stdout.write(`[letmeuse-webhook] ${event}\n`)
    res.json({ received: true })
  })

  wrapAsync(app)
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
        billing: { enabled: billingReady, plan: billingReady ? await paygate.plan() : null }
      }
    })
  })

  mountMemberRoutes(app, { viewer, plans, paygate, tokens, limiter, publicUrl })

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
    process.stderr.write(`[unhandled] ${req.method} ${req.originalUrl}: ${err.stack}\n`)
    // 已經送到一半就只能斷線,不然連線會掛著
    if (res.headersSent) return res.destroy()
    res.set('Cache-Control', 'no-store')
    res.status(500).json({ success: false, error: 'internal error' })
  })

  return app
}

module.exports = { createApp }

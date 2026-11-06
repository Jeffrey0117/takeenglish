const { parseCues, groupCues, splitSentences } = require('./vtt')

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{30,400}$/
const SHOW_ID_PATTERN = /^[a-z0-9-]{1,80}$/
const TRANSCRIPT_PAGE_SIZE = 30
const MAX_TRACKED_USERS = 20_000
const ANNOTATOR_STATUS = { disabled: 503, busy: 503, failed: 502 }
const REQUESTS_PER_MINUTE = 40
// Pro 不限支數,但一個帳號一天解析幾百支不是正常使用,擋一下免得被拿來燒 AI 費用
const PRO_DAILY_SOFT_CAP = 300

function fail(res, status, error, extra = {}) {
  res.set('Cache-Control', 'no-store')
  return res.status(status).json({ success: false, error, ...extra })
}

// 免費會員每天能解析幾支片段。同一支當天重複打開不重複算;記在記憶體裡,重啟歸零。
function createDailyUsage({ now = Date.now } = {}) {
  const users = new Map()
  const today = () => new Date(now()).toISOString().slice(0, 10)

  function entryFor(userId) {
    const day = today()
    const current = users.get(userId)
    if (current && current.day === day) return current
    if (users.size >= MAX_TRACKED_USERS) users.delete(users.keys().next().value)
    const fresh = { day, items: new Set() }
    users.set(userId, fresh)
    return fresh
  }

  // 只看不扣:現在要這一支的話,額度夠不夠。limit = null 表示不限
  function check(userId, item, limit) {
    if (limit === null) return { allowed: true, used: 0, limit: null }
    const entry = entryFor(userId)
    const allowed = entry.items.has(item) || entry.items.size < limit
    return { allowed, used: entry.items.size, limit }
  }

  // 真的給出內容之後才記一筆。回 { allowed, used, limit }
  function consume(userId, item, limit) {
    if (limit === null) return { allowed: true, used: 0, limit: null }
    const entry = entryFor(userId)
    if (entry.items.has(item)) return { allowed: true, used: entry.items.size, limit }
    if (entry.items.size >= limit) return { allowed: false, used: entry.items.size, limit }
    entry.items.add(item)
    return { allowed: true, used: entry.items.size, limit }
  }

  return { check, consume }
}

// 「點字就懂」的三個入口:
//   片段字幕       GET /api/clips/:id/study
//   每集劇情介紹   GET /api/shows/:id/seasons/:n/episodes/:ep/study
//   整集台詞       GET /api/shows/:id/seasons/:n/episodes/:ep/transcript?page=0
// 誰能看多少由 plans 決定(study = 每天幾支片段、studyEpisodes = 前幾集開放)。
function mountStudyRoutes(app, { viewer, plans, tokens, clipcafe, annotator, shows, transcripts, usage, limiter, clientIp }) {
  function tooMany(req, res) {
    if (limiter.check(`study:${clientIp(req)}`, REQUESTS_PER_MINUTE).allowed) return false
    res.set('Retry-After', '30')
    fail(res, 429, 'too_many_requests')
    return true
  }

  async function annotated(res, key, sentences) {
    try {
      return await annotator.annotate(key, sentences)
    } catch (err) {
      const status = ANNOTATOR_STATUS[err.code]
      if (!status) throw err
      fail(res, status, 'study_unavailable')
      return null
    }
  }

  app.get('/api/clips/:id/study', async (req, res) => {
    if (tooMany(req, res)) return
    const slug = TOKEN_PATTERN.test(req.params.id) ? tokens.open('id', req.params.id) : null
    if (!slug) return fail(res, 404, 'clip_not_found')
    if (!annotator.enabled) return fail(res, 503, 'study_unavailable')
    const { user, tier } = await viewer(req)
    if (!user) return fail(res, 401, 'unauthorized')
    const limit = plans.quota(tier, 'study')
    if (limit === 0) return fail(res, 402, 'upgrade_required', { limit })

    let subtitles
    try {
      subtitles = await clipcafe.subtitles(slug, 'en')
    } catch (err) {
      process.stderr.write(`[study] subtitles: ${err.message}\n`)
      return fail(res, 502, 'study_unavailable')
    }
    if (subtitles.status !== 200) return fail(res, subtitles.status === 404 ? 404 : 502, 'no_subtitles')
    // 字幕常把一句切成幾行,先併回完整句子再解析
    const cues = groupCues(parseCues(subtitles.text))
    if (cues.length === 0) return fail(res, 404, 'no_subtitles')

    // 先看額度夠不夠(不扣);真的解析成功才記一筆,失敗不算在使用者頭上
    const before = usage.check(user.sub, slug, limit)
    if (!before.allowed) return fail(res, 402, 'upgrade_required', { limit: before.limit, used: before.used })
    if (limit === null && !usage.check(`pro:${user.sub}`, slug, PRO_DAILY_SOFT_CAP).allowed) {
      return fail(res, 429, 'too_many_requests')
    }

    const items = await annotated(res, `clip:${slug}:en`, cues.map((cue) => cue.text))
    if (!items) return
    const quota = usage.consume(user.sub, slug, limit)
    if (limit === null) usage.consume(`pro:${user.sub}`, slug, PRO_DAILY_SOFT_CAP)
    res.set('Cache-Control', 'no-store')
    return res.json({
      success: true,
      data: {
        cues: cues.map((cue, index) => ({ ...cue, ...items[index] })),
        quota: { limit: quota.limit, used: quota.used }
      }
    })
  })

  // 這一集是否開放給這個人:前幾集人人可看,之後要 Pro
  async function episodeAccess(req, res) {
    if (tooMany(req, res)) return null
    const number = Number.parseInt(req.params.season, 10)
    const episodeNumber = Number.parseInt(req.params.episode, 10)
    const season =
      SHOW_ID_PATTERN.test(req.params.id) && Number.isInteger(number) ? shows.season(req.params.id, number) : null
    const episode = season && season.episodes.find((ep) => ep.number === episodeNumber)
    if (!episode) {
      fail(res, 404, 'episode_not_found')
      return null
    }
    if (!annotator.enabled) {
      fail(res, 503, 'study_unavailable')
      return null
    }
    const { user, tier } = await viewer(req)
    const open = plans.quota(tier, 'studyEpisodes')
    if (open !== null && episodeNumber > open) {
      fail(res, user ? 402 : 401, user ? 'upgrade_required' : 'unauthorized', { freeEpisodes: open })
      return null
    }
    return { showId: req.params.id, number, episode }
  }

  app.get('/api/shows/:id/seasons/:season/episodes/:episode/study', async (req, res) => {
    const access = await episodeAccess(req, res)
    if (!access) return
    const sentences = splitSentences(access.episode.summary && access.episode.summary.en)
    if (sentences.length === 0) return fail(res, 404, 'nothing_to_study')
    const key = `summary:${access.showId}:${access.number}:${access.episode.number}`
    const items = await annotated(res, key, sentences)
    if (!items) return
    res.set('Cache-Control', 'no-store')
    return res.json({
      success: true,
      data: { sentences: sentences.map((text, index) => ({ text, ...items[index] })) }
    })
  })

  app.get('/api/shows/:id/seasons/:season/episodes/:episode/transcript', async (req, res) => {
    const access = await episodeAccess(req, res)
    if (!access) return
    const raw = transcripts.get(access.showId, access.number, access.episode.number)
    if (!raw || raw.length === 0) return fail(res, 404, 'no_transcript')
    const cues = groupCues(raw)
    const pages = Math.ceil(cues.length / TRANSCRIPT_PAGE_SIZE)
    const page = Math.min(Math.max(Number.parseInt(req.query.page, 10) || 0, 0), pages - 1)
    const slice = cues.slice(page * TRANSCRIPT_PAGE_SIZE, (page + 1) * TRANSCRIPT_PAGE_SIZE)
    const key = `transcript:${access.showId}:${access.number}:${access.episode.number}:${page}`
    const items = await annotated(res, key, slice.map((cue) => cue.text))
    if (!items) return
    res.set('Cache-Control', 'no-store')
    return res.json({
      success: true,
      data: { page, pages, lines: slice.map((cue, index) => ({ ...cue, ...items[index] })) }
    })
  })
}

module.exports = { mountStudyRoutes, createDailyUsage }

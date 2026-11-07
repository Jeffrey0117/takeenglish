const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { groupCues } = require('./vtt')

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const FILE_PATTERN = /^[A-Za-z0-9._-]{1,200}$/
const RANGE_PATTERN = /^bytes=(\d+-\d*|-\d+)$/
const PAGE_SIZE = 24
const LIST_TTL_MS = 5 * 60_000
const LESSON_TTL_MS = 30 * 60_000
const MAX_CACHED_LESSONS = 300
const TIMEOUT_MS = 10_000

function fail(res, status, error) {
  res.set('Cache-Control', 'no-store')
  return res.status(status).json({ success: false, error })
}

// 影片學習區:內容來自 ReelScript 引擎已經處理好的影片(只讀,不觸發任何處理,不花錢)。
// 使用者看到的全是本站的頁面;影片和縮圖由本站轉送,對外看不到引擎在哪裡。
// 引擎回來的一支影片 → 本站要的樣子(公開影片和會員自己的影片共用)
function normalizeLesson(raw) {
  let segments = (Array.isArray(raw.segments) ? raw.segments : [])
    .filter((s) => s && typeof s.en === 'string' && Number.isFinite(s.start) && Number.isFinite(s.end))
    .map((s) => ({
      start: s.start,
      end: s.end,
      text: s.en,
      zh: typeof s.zh === 'string' ? s.zh : '',
      vocab: (Array.isArray(s.vocabulary) ? s.vocabulary : [])
        .filter((v) => v && typeof v.word === 'string' && typeof v.translation === 'string' && v.word && v.translation)
        .map((v) => ({ word: v.word, zh: v.translation }))
    }))
  // 沒翻譯的(不用 AI 處理的影片)是逐段字幕,先併回完整句子
  if (segments.length && segments.every((s) => !s.zh)) {
    segments = groupCues(segments.map(({ start, end, text }) => ({ start, end, text }))).map((s) => ({ ...s, zh: '', vocab: [] }))
  }
  return {
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : '',
    channel: typeof raw.channel === 'string' ? raw.channel : '',
    source: typeof raw.source === 'string' ? raw.source : '',
    status: typeof raw.status === 'string' ? raw.status : 'ready',
    theme: typeof raw.theme === 'string' ? raw.theme : '',
    keyPoints: (Array.isArray(raw.keyPoints) ? raw.keyPoints : []).filter((p) => typeof p === 'string' && p).slice(0, 10),
    quotes: (Array.isArray(raw.goldenQuotes) ? raw.goldenQuotes : [])
      .filter((q) => q && typeof q.en === 'string' && q.en)
      .map((q) => ({ en: q.en, zh: typeof q.zh === 'string' ? q.zh : '' }))
      .slice(0, 10),
    duration: Number.isFinite(raw.duration) ? raw.duration : null,
    file: FILE_PATTERN.test(raw.filename || '') ? raw.filename : null,
    thumb: FILE_PATTERN.test(raw.thumbnail || '') ? raw.thumbnail : null,
    segments
  }
}

const OWNER_PATTERN = /^te:[A-Za-z0-9_-]{1,80}$/
const MEDIA_TTL_MS = 6 * 60 * 60_000

function createLessonSource({ baseUrl, internalKey = '', fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const enabled = Boolean(baseUrl)
  // 會員貼連結加影片要用引擎的內部介面(要金鑰)
  const canAdd = enabled && Boolean(internalKey)
  // 會員自己的影片:看過的那支記住檔名,<video> 抓影片時不會帶登入資訊,要靠這個找檔案
  const ownMedia = new Map()
  let listCache = null
  const lessons = new Map()

  async function getJson(path, init = {}) {
    const res = await fetchImpl(new URL(path, baseUrl), { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (res.status === 404) {
      await res.body?.cancel().catch(() => {})
      return null
    }
    if (!res.ok) throw new Error(`lesson engine responded with ${res.status}`)
    return res.json()
  }

  // 全部已處理好、有字幕的影片(引擎一次最多給 100 筆,這裡翻頁拿完)
  async function all() {
    if (listCache && now() < listCache.until) return listCache.items
    const items = []
    for (let offset = 0; offset < 2000; offset += 100) {
      const page = await getJson(`/api/public/videos?limit=100&offset=${offset}`)
      const videos = (page && page.videos) || []
      for (const v of videos) {
        if (!v.hasTranscript || !ID_PATTERN.test(v.id || '')) continue
        items.push({
          id: v.id,
          title: typeof v.title === 'string' ? v.title : '',
          channel: typeof v.channel === 'string' ? v.channel : '',
          source: typeof v.source === 'string' ? v.source : '',
          category: typeof v.category === 'string' ? v.category : '',
          duration: Number.isFinite(v.duration) ? v.duration : null,
          hasThumb: Boolean(v.thumbnail)
        })
      }
      if (videos.length < 100) break
    }
    listCache = { items, until: now() + LIST_TTL_MS }
    return items
  }

  async function list(page = 0) {
    const items = await all()
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
    const current = Math.min(Math.max(page, 0), pages - 1)
    return { total: items.length, page: current, pages, items: items.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE) }
  }

  // 一部影片的逐句中英字幕。回 { …, segments, file, thumb } 或 null
  async function lesson(id) {
    if (!ID_PATTERN.test(id)) return null
    const hit = lessons.get(id)
    if (hit && now() < hit.until) return hit.value
    const raw = await getJson(`/api/public/videos/${id}/lesson`)
    const value = raw ? normalizeLesson(raw) : null
    if (lessons.size >= MAX_CACHED_LESSONS) lessons.delete(lessons.keys().next().value)
    lessons.set(id, { value, until: now() + LESSON_TTL_MS })
    return value
  }

  // 轉送引擎上的影片或縮圖(影片支援 Range,才能拖進度條、從某一句開始播)
  async function media(kind, file, range) {
    const prefix = kind === 'video' ? '/videos/' : '/thumbnails/'
    const headers = typeof range === 'string' && RANGE_PATTERN.test(range) ? { Range: range } : {}
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetchImpl(new URL(prefix + encodeURIComponent(file), baseUrl), { headers, signal: controller.signal })
      return { res, abort: () => controller.abort() }
    } finally {
      clearTimeout(timer)
    }
  }

  const internal = (path, init = {}) =>
    getJson(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${internalKey}` } })

  // 會員自己加的影片清單(含處理進度)
  async function mine(owner) {
    if (!canAdd || !OWNER_PATTERN.test(owner)) return []
    const data = await internal(`/api/internal/videos?owner=${encodeURIComponent(owner)}`)
    return ((data && data.videos) || [])
      .filter((v) => ID_PATTERN.test(v.id || ''))
      .map((v) => {
        if (FILE_PATTERN.test(v.thumbnail || '')) rememberMedia(v.id, { thumb: v.thumbnail })
        return {
          id: v.id,
          title: typeof v.title === 'string' ? v.title : '',
          channel: typeof v.channel === 'string' ? v.channel : '',
          duration: Number.isFinite(v.duration) ? v.duration : null,
          status: typeof v.status === 'string' ? v.status : '',
          error: typeof v.error === 'string' ? v.error : '',
          hasThumb: FILE_PATTERN.test(v.thumbnail || '')
        }
      })
  }

  // 貼連結加一支。回 { status, video } 或丟出 { status: 400|429|… }
  async function add(owner, url) {
    if (!canAdd || !OWNER_PATTERN.test(owner)) throw Object.assign(new Error('adding is not configured'), { status: 503 })
    const res = await fetchImpl(new URL('/api/internal/videos', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${internalKey}` },
      body: JSON.stringify({ url, owner }),
      signal: AbortSignal.timeout(30_000)
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw Object.assign(new Error(`engine responded with ${res.status}`), { status: res.status, detail: body.detail })
    return { id: body.video && body.video.id, status: body.video && body.video.status, duplicate: Boolean(body.duplicate) }
  }

  // 會員自己的一支(要是他的才拿得到)
  async function own(owner, id) {
    if (!canAdd || !OWNER_PATTERN.test(owner) || !ID_PATTERN.test(id)) return null
    const raw = await internal(`/api/internal/videos/${id}?owner=${encodeURIComponent(owner)}`)
    if (!raw) return null
    const value = normalizeLesson(raw)
    rememberMedia(id, { file: value.file, thumb: value.thumb })
    return value
  }

  function rememberMedia(id, files) {
    const previous = ownMedia.get(id)
    if (ownMedia.size >= 2000) ownMedia.delete(ownMedia.keys().next().value)
    ownMedia.set(id, { ...(previous || {}), ...files, until: now() + MEDIA_TTL_MS })
  }

  // 影片/縮圖檔名:公開影片查引擎;會員自己的用剛剛記住的
  async function mediaFile(id, kind) {
    const remembered = ownMedia.get(id)
    if (remembered && now() < remembered.until) {
      const file = kind === 'video' ? remembered.file : remembered.thumb
      if (file) return file
    }
    const found = await lesson(id)
    return found ? (kind === 'video' ? found.file : found.thumb) : null
  }

  return { enabled, canAdd, list, lesson, media, mine, add, own, mediaFile }
}

// 頁面與資料的路由。誰能看中文翻譯與重點片語由 plans 決定(lessonNotes)。
function mountLessonRoutes(app, { source, viewer, plans, limiter, clientIp }) {
  function tooMany(req, res, bucket, max) {
    if (limiter.check(`${bucket}:${clientIp(req)}`, max).allowed) return false
    res.set('Retry-After', '30')
    fail(res, 429, 'too_many_requests')
    return true
  }

  // 回給前端的一支影片。own = 會員自己加的(逐字稿不鎖,看他自己的東西)
  function present(lesson, user, tier, own) {
    const notes = plans.can(tier, 'lessonNotes')
    const modes = plans.can(tier, 'lessonModes')
    // 逐字稿只露前幾句;鎖住的句子連內容都不送出去,只告訴前端還有幾句
    const limit = own ? null : plans.quota(tier, 'lessonLines')
    const visible = limit === null ? lesson.segments : lesson.segments.slice(0, limit)
    return {
      id: lesson.id,
      title: lesson.title,
      channel: lesson.channel,
      source: lesson.source,
      theme: lesson.theme,
      duration: lesson.duration,
      video: lesson.file ? `/lesson-media/${lesson.id}/video` : null,
      thumb: lesson.thumb ? `/lesson-media/${lesson.id}/thumb.jpg` : null,
      tier,
      signedIn: Boolean(user),
      // 沒權限看筆記的:英文照給(可以點字查字典),中文和重點片語拿掉
      notes,
      modes,
      totalLines: lesson.segments.length,
      lockedLines: lesson.segments.length - visible.length,
      // 影片播到這裡就是牆(第一句被鎖住的句子開始的地方)
      lockedFrom: visible.length < lesson.segments.length ? lesson.segments[visible.length].start : null,
      segments: visible.map((s) => (notes ? s : { ...s, zh: '', vocab: [] })),
      // 重點整理:Pro 全部;其他人先看第一個重點和第一句金句,其餘只告訴他還有幾個
      summary: modes
        ? { keyPoints: lesson.keyPoints, quotes: lesson.quotes, preview: false, lockedPoints: 0, lockedQuotes: 0 }
        : {
            keyPoints: lesson.keyPoints.slice(0, 1),
            quotes: lesson.quotes.slice(0, 1),
            preview: true,
            lockedPoints: Math.max(lesson.keyPoints.length - 1, 0),
            lockedQuotes: Math.max(lesson.quotes.length - 1, 0)
          },
      own,
      status: lesson.status
    }
  }

  app.get('/api/lessons', async (req, res) => {
    if (!source.enabled) return fail(res, 503, 'lessons_unavailable')
    if (tooMany(req, res, 'lessons', 120)) return
    try {
      const data = await source.list(Number.parseInt(req.query.page, 10) || 0)
      res.set('Cache-Control', 'public, max-age=120')
      return res.json({
        success: true,
        data: {
          ...data,
          items: data.items.map((item) => ({ ...item, thumb: item.hasThumb ? `/lesson-media/${item.id}/thumb.jpg` : null, hasThumb: undefined }))
        }
      })
    } catch (err) {
      process.stderr.write(`[lessons] list: ${err.message}\n`)
      return fail(res, 502, 'lessons_unavailable')
    }
  })

  app.get('/api/lessons/:id', async (req, res) => {
    if (!source.enabled) return fail(res, 503, 'lessons_unavailable')
    if (tooMany(req, res, 'lessons', 120)) return
    let lesson
    try {
      lesson = await source.lesson(req.params.id)
    } catch (err) {
      process.stderr.write(`[lessons] ${err.message}\n`)
      return fail(res, 502, 'lessons_unavailable')
    }
    if (!lesson) return fail(res, 404, 'lesson_not_found')
    const { user, tier } = await viewer(req)
    res.set('Cache-Control', 'no-store')
    return res.json({ success: true, data: present(lesson, user, tier, false) })
  })

  // ---- 會員自己的影片(貼連結加) ----
  const ownerOf = (user) => `te:${String(user.sub || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)}`

  app.get('/api/my-lessons', async (req, res) => {
    if (!source.canAdd) return fail(res, 503, 'lessons_unavailable')
    const { user, tier } = await viewer(req)
    if (!user) return fail(res, 401, 'unauthorized')
    if (tooMany(req, res, 'my-lessons', 120)) return
    try {
      const items = await source.mine(ownerOf(user))
      res.set('Cache-Control', 'no-store')
      return res.json({
        success: true,
        data: {
          canAdd: plans.can(tier, 'lessonUpload'),
          items: items.map((item) => ({ ...item, thumb: item.hasThumb ? `/lesson-media/${item.id}/thumb.jpg` : null, hasThumb: undefined }))
        }
      })
    } catch (err) {
      process.stderr.write(`[lessons] mine: ${err.message}\n`)
      return fail(res, 502, 'lessons_unavailable')
    }
  })

  app.post('/api/my-lessons', async (req, res) => {
    if (!source.canAdd) return fail(res, 503, 'lessons_unavailable')
    const { user, tier } = await viewer(req)
    if (!user) return fail(res, 401, 'unauthorized')
    // 自己貼影片是 Pro 的功能:這裡就是牆
    if (!plans.can(tier, 'lessonUpload')) return fail(res, 402, 'upgrade_required')
    if (tooMany(req, res, 'my-lessons-add', 10)) return
    const url = typeof (req.body && req.body.url) === 'string' ? req.body.url.trim() : ''
    if (!/^https:[/][/]/.test(url) || url.length > 500) return fail(res, 400, 'unsupported_url')
    try {
      const added = await source.add(ownerOf(user), url)
      res.set('Cache-Control', 'no-store')
      return res.json({ success: true, data: added })
    } catch (err) {
      if (err.status === 400) return fail(res, 400, 'unsupported_url')
      if (err.status === 429) return fail(res, 429, 'monthly_limit')
      process.stderr.write(`[lessons] add: ${err.message}\n`)
      return fail(res, 502, 'lessons_unavailable')
    }
  })

  app.get('/api/my-lessons/:id', async (req, res) => {
    if (!source.canAdd) return fail(res, 503, 'lessons_unavailable')
    const { user, tier } = await viewer(req)
    if (!user) return fail(res, 401, 'unauthorized')
    if (tooMany(req, res, 'lessons', 120)) return
    let lesson
    try {
      lesson = await source.own(ownerOf(user), req.params.id)
    } catch (err) {
      process.stderr.write(`[lessons] own: ${err.message}\n`)
      return fail(res, 502, 'lessons_unavailable')
    }
    if (!lesson) return fail(res, 404, 'lesson_not_found')
    res.set('Cache-Control', 'no-store')
    return res.json({ success: true, data: present(lesson, user, tier, true) })
  })

  async function sendMedia(req, res, kind) {
    if (!source.enabled) return fail(res, 503, 'lessons_unavailable')
    if (req.method !== 'GET') {
      res.set('Allow', 'GET')
      return fail(res, 405, 'method not allowed')
    }
    if (tooMany(req, res, `lesson-${kind}`, kind === 'video' ? 600 : 300)) return
    let file
    try {
      file = await source.mediaFile(req.params.id, kind)
    } catch {
      return fail(res, 502, 'lessons_unavailable')
    }
    if (!file) return fail(res, 404, 'not_found')

    let upstream
    try {
      upstream = await source.media(kind, file, req.get('Range'))
    } catch (err) {
      process.stderr.write(`[lessons] media: ${err.message}\n`)
      return fail(res, 502, 'media_unavailable')
    }
    const { res: up, abort } = upstream
    if (up.status !== 200 && up.status !== 206) {
      await up.body?.cancel().catch(() => {})
      return fail(res, up.status === 404 ? 404 : up.status === 416 ? 416 : 502, 'media_unavailable')
    }
    const headers = {
      'Content-Type': kind === 'video' ? 'video/mp4' : 'image/jpeg',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Cache-Control': kind === 'video' ? 'private, max-age=3600' : 'public, max-age=86400'
    }
    if (kind === 'video') headers['Accept-Ranges'] = 'bytes'
    for (const name of ['content-length', 'content-range']) {
      const value = up.headers.get(name)
      if (value) headers[name] = value
    }
    res.once('close', abort)
    try {
      res.status(up.status).set(headers)
      await pipeline(Readable.fromWeb(up.body), res)
    } catch {
      abort()
    }
  }

  app.get('/lesson-media/:id/video', (req, res) => sendMedia(req, res, 'video'))
  app.get('/lesson-media/:id/thumb.jpg', (req, res) => sendMedia(req, res, 'thumb'))
}

module.exports = { createLessonSource, mountLessonRoutes }

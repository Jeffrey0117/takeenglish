const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{30,400}$/
const LANG_PATTERN = /^[a-z]{2,3}$/
const THUMB_CACHE_CONTROL = 'public, max-age=31536000, immutable'
const SUBTITLE_CACHE_CONTROL = 'public, max-age=86400'
// 上游說「沒這個」「現在很忙」「範圍不對」→ 照實回;其餘一律 502
const PASSTHROUGH_STATUS = new Set([404, 416, 503])
const FILENAME_PATTERN = /[^a-z0-9]+/g

function fail(res, status, message) {
  res.set('Cache-Control', 'no-store')
  return res.status(status).json({ success: false, error: message })
}

const PLAYER_DESTS = new Set(['video', 'audio', 'empty'])
const NAVIGATION_DESTS = new Set(['document', 'iframe', 'frame', 'embed', 'object'])
const FOREIGN_SITES = new Set(['cross-site', 'same-site'])
// 同一個 IP 同時最多幾條影片連線(暫停中的影片也會佔著連線一小段時間)
const MAX_STREAMS_PER_IP = 12

// 影片只給自己頁面上的播放器用。Sec-Fetch-* 是瀏覽器自己附的,網頁改不了:
//   別的網站嵌我們的影片網址(cross-site / same-site)→ 擋
//   把影片網址貼到網址列或 iframe 直接開(dest=document…)→ 擋
// 預設放行沒帶標頭的請求:舊瀏覽器不送,而且各家手機瀏覽器的影片請求帶法不完全一致,
// 寧可放過照抄網址的人,也不要讓正常觀眾播不出來。真正的防線是網址會過期。
// strict=true:一定要帶標頭而且是同站播放器發的(curl 照抄網址會被擋),上線前先用實機測過。
function isEmbeddedPlayback(req, strict) {
  const site = req.get('Sec-Fetch-Site')
  const dest = req.get('Sec-Fetch-Dest')
  if (strict) return site === 'same-origin' && PLAYER_DESTS.has(dest)
  if (site && FOREIGN_SITES.has(site)) return false
  if (dest && NAVIGATION_DESTS.has(dest)) return false
  return true
}

function downloadName(raw) {
  const cleaned = String(raw || '')
    .toLowerCase()
    .replace(FILENAME_PATTERN, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `takeenglish-${cleaned || 'clip'}.mp4`
}

// 縮圖、字幕、播放、下載。對外網址全部是我們自己簽的代號,片源在哪裡外面看不到。
function mountMediaRoutes(app, { clipcafe, tokens, limiter, clientIp, strictPlayback = false }) {
  const streamsByIp = new Map()

  function limited(req, res, bucket, max) {
    if (limiter.check(`${bucket}:${clientIp(req)}`, max).allowed) return false
    res.set('Retry-After', '30')
    fail(res, 429, 'too many requests')
    return true
  }

  // 佔一條影片連線;回傳歸還用的函式,超過上限回 null。
  // 少了這個,一個人開一堆慢速連線就能把全站的串流名額佔光。
  function claimStream(ip) {
    const current = streamsByIp.get(ip) || 0
    if (current >= MAX_STREAMS_PER_IP) return null
    streamsByIp.set(ip, current + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const left = (streamsByIp.get(ip) || 1) - 1
      if (left <= 0) streamsByIp.delete(ip)
      else streamsByIp.set(ip, left)
    }
  }

  async function sendVideo(req, res, slug, extraHeaders) {
    // 播放器只會用 GET;HEAD 會讓整支片白白過兩層代理
    if (req.method !== 'GET') {
      res.set('Allow', 'GET')
      return fail(res, 405, 'method not allowed')
    }
    const release = claimStream(clientIp(req))
    if (!release) {
      res.set('Retry-After', '10')
      return fail(res, 429, 'too many concurrent streams')
    }
    try {
      let upstream
      try {
        upstream = await clipcafe.stream(slug, req.get('Range'))
      } catch (err) {
        process.stderr.write(`[stream] ${err.message}\n`)
        return fail(res, 502, 'video unavailable')
      }
      if (!upstream.body) {
        const status = PASSTHROUGH_STATUS.has(upstream.status) ? upstream.status : 502
        return fail(res, status, 'video unavailable')
      }
      res.once('close', upstream.abort)
      try {
        res.status(upstream.status).set({
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'X-Content-Type-Options': 'nosniff',
          'Cross-Origin-Resource-Policy': 'same-origin',
          ...upstream.headers,
          ...extraHeaders
        })
        await pipeline(Readable.fromWeb(upstream.body), res)
      } catch {
        /* 觀眾關掉或上游斷線,連線已經收掉 */
        upstream.abort()
      }
    } finally {
      release()
    }
  }

  app.get('/thumb/:id.jpg', async (req, res) => {
    const slug = TOKEN_PATTERN.test(req.params.id) ? tokens.open('id', req.params.id) : null
    if (!slug) return fail(res, 404, 'thumbnail unavailable')
    if (limited(req, res, 'thumb', 600)) return
    try {
      const upstream = await clipcafe.thumb(slug)
      if (upstream.status === 200) {
        res.set('Cache-Control', THUMB_CACHE_CONTROL)
        return res.type('jpeg').send(upstream.body)
      }
      const status = PASSTHROUGH_STATUS.has(upstream.status) ? upstream.status : 502
      return fail(res, status, 'thumbnail unavailable')
    } catch (err) {
      process.stderr.write(`[thumb] ${err.message}\n`)
      return fail(res, 502, 'thumbnail unavailable')
    }
  })

  app.get('/sub/:id/:lang.vtt', async (req, res) => {
    const { id, lang } = req.params
    const slug = TOKEN_PATTERN.test(id) && LANG_PATTERN.test(lang) ? tokens.open('id', id) : null
    if (!slug) return fail(res, 404, 'subtitles unavailable')
    if (limited(req, res, 'sub', 600)) return
    try {
      const upstream = await clipcafe.subtitles(slug, lang)
      if (upstream.status === 200) {
        res.set({ 'Cache-Control': SUBTITLE_CACHE_CONTROL, 'X-Content-Type-Options': 'nosniff' })
        return res.type('text/vtt; charset=utf-8').send(upstream.text)
      }
      const status = PASSTHROUGH_STATUS.has(upstream.status) ? upstream.status : 502
      return fail(res, status, 'subtitles unavailable')
    } catch (err) {
      process.stderr.write(`[subs] ${err.message}\n`)
      return fail(res, 502, 'subtitles unavailable')
    }
  })

  app.get('/v/:token', async (req, res) => {
    const slug = TOKEN_PATTERN.test(req.params.token) ? tokens.open('v', req.params.token) : null
    if (!slug) return fail(res, 403, 'link expired')
    if (!isEmbeddedPlayback(req, strictPlayback)) return fail(res, 403, 'playback is only available on the site')
    if (limited(req, res, 'video', 600)) return
    return sendVideo(req, res, slug, {
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': 'inline'
    })
  })

  app.get('/dl/:token', async (req, res) => {
    const slug = TOKEN_PATTERN.test(req.params.token) ? tokens.open('dl', req.params.token) : null
    if (!slug) return fail(res, 403, 'link expired')
    if (limited(req, res, 'download', 30)) return
    return sendVideo(req, res, slug, {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${downloadName(req.query.name)}"`
    })
  })
}

module.exports = { mountMediaRoutes, downloadName }

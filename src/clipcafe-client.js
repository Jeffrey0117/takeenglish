const DEFAULT_TIMEOUT_MS = 15000
// 縮圖第一次要等 clipcafe-api 排隊抽圖,給比搜尋寬一點的時間
const THUMB_TIMEOUT_MS = 25000
const THUMB_MAX_BYTES = 2 * 1024 * 1024
const SUBTITLE_TIMEOUT_MS = 10000
const SUBTITLE_MAX_BYTES = 512 * 1024
// 串流只限「多久內要連上」,連上之後影片要傳多久由觀眾決定
const STREAM_CONNECT_TIMEOUT_MS = 12000

function createClipcafeClient({ baseUrl, apiKey = '', fetchImpl = globalThis.fetch }) {
  // clipcafe-api 只認自家後端:有設金鑰就每個請求都帶
  function headers(extra = {}) {
    return apiKey ? { ...extra, Authorization: `Bearer ${apiKey}` } : extra
  }

  async function search({ q, slop = 0, size = 30, from = 0 }) {
    const url = new URL('/api/search', baseUrl)
    url.searchParams.set('q', q)
    url.searchParams.set('slop', String(slop))
    url.searchParams.set('size', String(size))
    url.searchParams.set('from', String(from))

    const res = await fetchImpl(url, {
      headers: headers(),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
    })
    if (!res.ok) {
      throw new Error(`clipcafe-api responded with ${res.status}`)
    }
    const body = await res.json()
    if (!body.success) {
      throw new Error(body.error || 'clipcafe-api returned failure')
    }
    return body.data
  }

  // 回 { status, body }:只有 200 才有 body(jpeg Buffer),其他狀態由呼叫端決定怎麼回
  async function thumb(slug) {
    const url = new URL(`/api/thumb/${encodeURIComponent(slug)}`, baseUrl)
    const res = await fetchImpl(url, {
      headers: headers(),
      signal: AbortSignal.timeout(THUMB_TIMEOUT_MS)
    })
    if (res.status !== 200) {
      await res.body?.cancel()
      return { status: res.status, body: null }
    }
    // 不收的回應先放掉連線再丟錯,不要等 GC;太大的在讀進記憶體之前就擋
    const type = res.headers.get('content-type') || ''
    if (!type.startsWith('image/jpeg')) {
      await res.body?.cancel()
      throw new Error(`unexpected content type from clipcafe-api: ${type}`)
    }
    const declared = Number.parseInt(res.headers.get('content-length') || '', 10)
    if (declared > THUMB_MAX_BYTES) {
      await res.body?.cancel()
      throw new Error('thumbnail from clipcafe-api is too large')
    }
    const body = Buffer.from(await res.arrayBuffer())
    if (body.length > THUMB_MAX_BYTES) {
      throw new Error('thumbnail from clipcafe-api is too large')
    }
    return { status: 200, body }
  }

  // 回 { status, text }:只有 200 才有 text(WebVTT 字串)
  async function subtitles(slug, lang) {
    const url = new URL(`/api/subs/${encodeURIComponent(slug)}/${encodeURIComponent(lang)}`, baseUrl)
    const res = await fetchImpl(url, {
      headers: headers(),
      signal: AbortSignal.timeout(SUBTITLE_TIMEOUT_MS)
    })
    if (res.status !== 200) {
      await res.body?.cancel()
      return { status: res.status, text: null }
    }
    const declared = Number.parseInt(res.headers.get('content-length') || '', 10)
    if (declared > SUBTITLE_MAX_BYTES) {
      await res.body?.cancel()
      throw new Error('subtitles from clipcafe-api are too large')
    }
    const text = await res.text()
    if (!text.startsWith('WEBVTT')) {
      throw new Error('clipcafe-api returned something that is not WebVTT')
    }
    return { status: 200, text }
  }

  // 開一條影片串流。回 { status, headers, body, abort }:
  //   200/206 才有 body(web ReadableStream),呼叫端負責接到回應上、結束時呼叫 abort
  //   其他狀態 body 為 null
  async function stream(slug, range) {
    const url = new URL(`/api/stream/${encodeURIComponent(slug)}`, baseUrl)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), STREAM_CONNECT_TIMEOUT_MS)
    let res
    try {
      res = await fetchImpl(url, {
        headers: headers(range ? { Range: range } : {}),
        signal: controller.signal
      })
    } finally {
      clearTimeout(timer)
    }
    if (res.status !== 200 && res.status !== 206) {
      await res.body?.cancel()
      return { status: res.status, headers: {}, body: null, abort: () => {} }
    }
    const picked = {}
    for (const name of ['content-length', 'content-range']) {
      const value = res.headers.get(name)
      if (value) picked[name] = value
    }
    return { status: res.status, headers: picked, body: res.body, abort: () => controller.abort() }
  }

  return { search, thumb, subtitles, stream }
}

module.exports = { createClipcafeClient }

const DEFAULT_TIMEOUT_MS = 15000
// 縮圖第一次要等 clipcafe-api 排隊抽圖,給比搜尋寬一點的時間
const THUMB_TIMEOUT_MS = 25000
const THUMB_MAX_BYTES = 2 * 1024 * 1024

function createClipcafeClient({ baseUrl, fetchImpl = globalThis.fetch }) {
  async function search({ q, slop = 0, size = 30, from = 0 }) {
    const url = new URL('/api/search', baseUrl)
    url.searchParams.set('q', q)
    url.searchParams.set('slop', String(slop))
    url.searchParams.set('size', String(size))
    url.searchParams.set('from', String(from))

    const res = await fetchImpl(url, {
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

  return { search, thumb }
}

module.exports = { createClipcafeClient }

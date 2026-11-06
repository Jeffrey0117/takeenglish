const DEFAULT_TIMEOUT_MS = 15000

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

  return { search }
}

module.exports = { createClipcafeClient }

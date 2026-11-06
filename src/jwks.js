const crypto = require('crypto')

const REFRESH_COOLDOWN_MS = 60_000
const MAX_AGE_MS = 10 * 60_000
const FETCH_TIMEOUT_MS = 5_000

function defaultOnError(err) {
  process.stderr.write(`[jwks] refresh failed: ${err.message}\n`)
}

function toPublicKey(jwk) {
  if (!jwk || typeof jwk.kid !== 'string' || jwk.kty !== 'EC' || jwk.crv !== 'P-256') return null
  try {
    return crypto.createPublicKey({ key: jwk, format: 'jwk' })
  } catch {
    return null
  }
}

// LetMeUse 的 ES256 公鑰快取。
// - 查不到 kid、或整組金鑰超過 MAX_AGE 才重抓,而且兩次重抓之間有冷卻時間 →
//   亂塞 kid 的請求打不出對 LetMeUse 的請求洪水。
// - 成功抓回來的金鑰集合就是權威(空的也算):被撤掉的金鑰最慢 MAX_AGE 後失效。
// - 抓失敗(端點掛掉/回垃圾)才沿用舊金鑰,別讓一次故障把所有登入者踢掉。
function createJwksCache({
  url,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  onError = defaultOnError
}) {
  let keysByKid = new Map()
  let fetchedAt = null
  let lastAttempt = null
  let inflight = null

  async function load() {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`jwks endpoint responded with ${res.status}`)
    const body = await res.json()
    if (!Array.isArray(body?.keys)) throw new Error('jwks response has no keys array')
    const entries = body.keys
      .map((jwk) => [jwk?.kid, toPublicKey(jwk)])
      .filter(([, key]) => key !== null)
    keysByKid = new Map(entries)
    fetchedAt = now()
  }

  function refresh() {
    if (inflight) return inflight
    lastAttempt = now()
    inflight = load()
      .catch(onError)
      .finally(() => {
        inflight = null
      })
    return inflight
  }

  function cooledDown() {
    return lastAttempt === null || now() - lastAttempt > REFRESH_COOLDOWN_MS
  }

  function stale() {
    return fetchedAt === null || now() - fetchedAt > MAX_AGE_MS
  }

  async function getKey(kid) {
    if (typeof kid !== 'string' || !kid) return null
    const needsRefresh = !keysByKid.has(kid) || stale()
    if (needsRefresh && (inflight || cooledDown())) await refresh()
    return keysByKid.get(kid) || null
  }

  return { getKey, refresh }
}

module.exports = { createJwksCache }

const crypto = require('crypto')

function b64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(padded, 'base64')
}

function safeJsonParse(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch {
    return null
  }
}

const ES256_SIGNATURE_BYTES = 64

function verifyEs256(signingInput, signature, publicKey) {
  if (signature.length !== ES256_SIGNATURE_BYTES) return false
  try {
    return crypto.verify(
      'sha256',
      Buffer.from(signingInput),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      signature
    )
  } catch {
    return false
  }
}

// LetMeUse 用 ES256 簽 access token,公鑰從 JWKS 拿。這裡只收 ES256:
// HS256(app secret)一律拒收 — secret 一外洩,任何人都能自簽任意用戶的 token;
// alg none 同理。沒設 appId 也一律拒收,因為 JWKS 是所有 LetMeUse app 共用的,
// 不比對 app claim 就等於別的 app 的 token 也能進來。
function createAuth({ appId, secret, jwks }) {
  async function verifyToken(token) {
    if (!appId || !jwks || !token || typeof token !== 'string') return null
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const header = safeJsonParse(b64urlDecode(parts[0]))
    if (!header || header.alg !== 'ES256') return null

    const publicKey = await jwks.getKey(header.kid)
    if (!publicKey) return null
    if (!verifyEs256(`${parts[0]}.${parts[1]}`, b64urlDecode(parts[2]), publicKey)) return null

    const payload = safeJsonParse(b64urlDecode(parts[1]))
    if (!payload || typeof payload !== 'object') return null
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null
    if (payload.app !== appId) return null
    return payload
  }

  function extractBearer(authHeader) {
    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) return null
    return authHeader.slice(7)
  }

  function verifyWebhookSignature(rawBody, signature) {
    if (!secret || !signature) return false
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    const a = Buffer.from(expected)
    const b = Buffer.from(String(signature))
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  }

  return { verifyToken, extractBearer, verifyWebhookSignature }
}

module.exports = { createAuth }

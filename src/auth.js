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

// LetMeUse 用 HS256 + app secret 簽 token;擋資料的地方一定要驗簽章,
// 只 decode 不驗 = 任何人自編 payload 就能登入
function createAuth({ appId, secret }) {
  function verifyToken(token) {
    if (!secret || !token || typeof token !== 'string') return null
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const header = safeJsonParse(b64urlDecode(parts[0]))
    if (!header || header.alg !== 'HS256') return null

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${parts[0]}.${parts[1]}`)
      .digest()
    const actual = b64urlDecode(parts[2])
    if (expected.length !== actual.length) return null
    if (!crypto.timingSafeEqual(expected, actual)) return null

    const payload = safeJsonParse(b64urlDecode(parts[1]))
    if (!payload) return null
    if (payload.exp && payload.exp * 1000 < Date.now()) return null
    if (appId && payload.app !== appId) return null
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

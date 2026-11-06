const crypto = require('crypto')

function b64url(input) {
  return Buffer.from(input).toString('base64url')
}

function createTestKeys(kid = 'test-kid') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'ES256' }
  return { kid, privateKey, jwk }
}

function makeEs256Token(payload, { privateKey, kid }) {
  const head = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }))
  const body = b64url(JSON.stringify(payload))
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363'
  })
  return `${head}.${body}.${b64url(sig)}`
}

function makeHs256Token(payload, secret, headerExtra = {}) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', ...headerExtra }))
  const body = b64url(JSON.stringify(payload))
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest()
  return `${head}.${body}.${b64url(sig)}`
}

function makeUnsignedToken(payload, headerExtra = {}) {
  const head = b64url(JSON.stringify({ alg: 'none', typ: 'JWT', ...headerExtra }))
  const body = b64url(JSON.stringify(payload))
  return `${head}.${body}.`
}

// 假的 JWKS 端點:state.jwks 可在測試中途換掉(模擬金鑰輪替),state.fail 模擬端點掛掉
function fakeJwksFetch(initialJwks) {
  const state = { jwks: initialJwks, fail: false, calls: 0 }
  const fetchImpl = async () => {
    state.calls += 1
    if (state.fail) throw new Error('jwks endpoint down')
    return { ok: true, json: async () => ({ keys: state.jwks }) }
  }
  return { state, fetchImpl }
}

function futureExp(seconds = 3600) {
  return Math.floor(Date.now() / 1000) + seconds
}

module.exports = {
  createTestKeys,
  makeEs256Token,
  makeHs256Token,
  makeUnsignedToken,
  fakeJwksFetch,
  futureExp
}

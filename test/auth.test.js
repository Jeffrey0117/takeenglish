const { test } = require('node:test')
const assert = require('node:assert')
const crypto = require('crypto')
const { createAuth } = require('../src/auth')
const { createJwksCache } = require('../src/jwks')
const {
  createTestKeys,
  makeEs256Token,
  makeHs256Token,
  makeUnsignedToken,
  fakeJwksFetch,
  futureExp
} = require('./helpers')

const SECRET = 'test-secret'
const APP_ID = 'app_test'
const KEYS = createTestKeys('kid-1')

function buildAuth({ appId = APP_ID, secret = SECRET, jwks = [KEYS.jwk] } = {}) {
  const { state, fetchImpl } = fakeJwksFetch(jwks)
  const cache = createJwksCache({
    url: 'https://jwks.test/api/jwks',
    fetchImpl,
    onError: () => {}
  })
  return { auth: createAuth({ appId, secret, jwks: cache }), state }
}

test('valid ES256 token returns payload', async () => {
  const { auth } = buildAuth()
  const token = makeEs256Token({ sub: 'u1', app: APP_ID, exp: futureExp() }, KEYS)
  const payload = await auth.verifyToken(token)
  assert.strictEqual(payload.sub, 'u1')
})

test('non-ASCII payload still verifies', async () => {
  const { auth } = buildAuth()
  const token = makeEs256Token({ sub: 'u1', name: '杰神', app: APP_ID, exp: futureExp() }, KEYS)
  const payload = await auth.verifyToken(token)
  assert.strictEqual(payload.name, '杰神')
})

test('HS256 token signed with the real app secret is rejected', async () => {
  const { auth } = buildAuth()
  const claims = { sub: 'victim', app: APP_ID, exp: futureExp() }
  assert.strictEqual(await auth.verifyToken(makeHs256Token(claims, SECRET)), null)
  assert.strictEqual(
    await auth.verifyToken(makeHs256Token(claims, SECRET, { kid: KEYS.kid })),
    null
  )
})

test('alg none is rejected', async () => {
  const { auth } = buildAuth()
  const token = makeUnsignedToken({ sub: 'u1', app: APP_ID, exp: futureExp() }, { kid: KEYS.kid })
  assert.strictEqual(await auth.verifyToken(token), null)
})

test('ES256 token signed by a different key is rejected', async () => {
  const { auth } = buildAuth()
  const attacker = createTestKeys(KEYS.kid)
  const token = makeEs256Token({ sub: 'u1', app: APP_ID, exp: futureExp() }, attacker)
  assert.strictEqual(await auth.verifyToken(token), null)
})

test('tampered payload is rejected', async () => {
  const { auth } = buildAuth()
  const token = makeEs256Token({ sub: 'u1', app: APP_ID, exp: futureExp() }, KEYS)
  const [head, , sig] = token.split('.')
  const forgedBody = Buffer.from(
    JSON.stringify({ sub: 'admin', app: APP_ID, exp: futureExp() })
  ).toString('base64url')
  assert.strictEqual(await auth.verifyToken(`${head}.${forgedBody}.${sig}`), null)
})

test('unknown kid is rejected', async () => {
  const { auth } = buildAuth()
  const stranger = createTestKeys('kid-unknown')
  const token = makeEs256Token({ sub: 'u1', app: APP_ID, exp: futureExp() }, stranger)
  assert.strictEqual(await auth.verifyToken(token), null)
})

test('expired token and token without exp are rejected', async () => {
  const { auth } = buildAuth()
  const expired = makeEs256Token({ sub: 'u1', app: APP_ID, exp: futureExp(-10) }, KEYS)
  const noExp = makeEs256Token({ sub: 'u1', app: APP_ID }, KEYS)
  assert.strictEqual(await auth.verifyToken(expired), null)
  assert.strictEqual(await auth.verifyToken(noExp), null)
})

test('token for another app is rejected', async () => {
  const { auth } = buildAuth()
  const token = makeEs256Token({ sub: 'u1', app: 'app_other', exp: futureExp() }, KEYS)
  assert.strictEqual(await auth.verifyToken(token), null)
})

test('missing appId config rejects every token', async () => {
  const { auth } = buildAuth({ appId: '' })
  const token = makeEs256Token({ sub: 'u1', app: APP_ID, exp: futureExp() }, KEYS)
  assert.strictEqual(await auth.verifyToken(token), null)
})

test('garbage input is rejected', async () => {
  const { auth } = buildAuth()
  assert.strictEqual(await auth.verifyToken('not.a.token'), null)
  assert.strictEqual(await auth.verifyToken('only-one-part'), null)
  assert.strictEqual(await auth.verifyToken(''), null)
  assert.strictEqual(await auth.verifyToken(undefined), null)
})

test('JWKS endpoint down means not logged in, never a throw', async () => {
  const { auth, state } = buildAuth()
  state.fail = true
  const token = makeEs256Token({ sub: 'u1', app: APP_ID, exp: futureExp() }, KEYS)
  assert.strictEqual(await auth.verifyToken(token), null)
})

test('extractBearer', () => {
  const { auth } = buildAuth()
  assert.strictEqual(auth.extractBearer('Bearer abc'), 'abc')
  assert.strictEqual(auth.extractBearer('abc'), null)
  assert.strictEqual(auth.extractBearer(undefined), null)
})

test('webhook signature verify', () => {
  const { auth } = buildAuth()
  const body = Buffer.from('{"event":"user.login"}')
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex')
  assert.strictEqual(auth.verifyWebhookSignature(body, sig), true)
  assert.strictEqual(auth.verifyWebhookSignature(body, 'bad'), false)
})

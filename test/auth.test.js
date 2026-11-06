const { test } = require('node:test')
const assert = require('node:assert')
const crypto = require('crypto')
const { createAuth } = require('../src/auth')

const SECRET = 'test-secret'
const APP_ID = 'app_test'

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makeToken(payload, secret = SECRET, alg = 'HS256') {
  const head = b64url(JSON.stringify({ alg, typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest()
  return `${head}.${body}.${b64url(sig)}`
}

const futureExp = Math.floor(Date.now() / 1000) + 3600

test('valid token returns payload', () => {
  const auth = createAuth({ appId: APP_ID, secret: SECRET })
  const payload = auth.verifyToken(makeToken({ sub: 'u1', app: APP_ID, exp: futureExp }))
  assert.strictEqual(payload.sub, 'u1')
})

test('tampered signature rejected', () => {
  const auth = createAuth({ appId: APP_ID, secret: SECRET })
  const token = makeToken({ sub: 'u1', app: APP_ID, exp: futureExp }, 'wrong-secret')
  assert.strictEqual(auth.verifyToken(token), null)
})

test('expired token rejected', () => {
  const auth = createAuth({ appId: APP_ID, secret: SECRET })
  const token = makeToken({ sub: 'u1', app: APP_ID, exp: Math.floor(Date.now() / 1000) - 10 })
  assert.strictEqual(auth.verifyToken(token), null)
})

test('token for another app rejected', () => {
  const auth = createAuth({ appId: APP_ID, secret: SECRET })
  const token = makeToken({ sub: 'u1', app: 'app_other', exp: futureExp })
  assert.strictEqual(auth.verifyToken(token), null)
})

test('garbage and missing secret rejected', () => {
  const auth = createAuth({ appId: APP_ID, secret: SECRET })
  assert.strictEqual(auth.verifyToken('not.a.token'), null)
  assert.strictEqual(auth.verifyToken(''), null)
  const noSecret = createAuth({ appId: APP_ID, secret: '' })
  assert.strictEqual(noSecret.verifyToken(makeToken({ sub: 'u1', app: APP_ID })), null)
})

test('extractBearer', () => {
  const auth = createAuth({ appId: APP_ID, secret: SECRET })
  assert.strictEqual(auth.extractBearer('Bearer abc'), 'abc')
  assert.strictEqual(auth.extractBearer('abc'), null)
  assert.strictEqual(auth.extractBearer(undefined), null)
})

test('webhook signature verify', () => {
  const auth = createAuth({ appId: APP_ID, secret: SECRET })
  const body = Buffer.from('{"event":"user.login"}')
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex')
  assert.strictEqual(auth.verifyWebhookSignature(body, sig), true)
  assert.strictEqual(auth.verifyWebhookSignature(body, 'bad'), false)
})

module.exports = { makeToken }

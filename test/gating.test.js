const { test } = require('node:test')
const assert = require('node:assert')
const { createApp } = require('../src/app')
const { createAuth } = require('../src/auth')
const { createJwksCache } = require('../src/jwks')
const {
  createTestKeys,
  makeEs256Token,
  makeHs256Token,
  fakeJwksFetch,
  futureExp,
  TEST_TOKENS
} = require('./helpers')

const SECRET = 'test-secret'
const APP_ID = 'app_test'
const KEYS = createTestKeys('kid-1')

function fakeClipcafe() {
  const calls = []
  return {
    calls,
    search(params) {
      calls.push(params)
      const results = Array.from({ length: params.size }, (_, i) => ({
        slug: `clip-${i}`,
        text: `line ${i}`,
        mp4: `https://example.com/${i}.mp4`
      }))
      return Promise.resolve({ total: 100, from: params.from, size: params.size, results })
    }
  }
}

function startApp({ freeLimit = 3 } = {}) {
  const clipcafe = fakeClipcafe()
  const { fetchImpl } = fakeJwksFetch([KEYS.jwk])
  const jwks = createJwksCache({ url: 'http://jwks.test/api/jwks', fetchImpl })
  const app = createApp({
    clipcafe,
    auth: createAuth({ appId: APP_ID, secret: SECRET, jwks }),
    tokens: TEST_TOKENS,
    freeLimit,
    letmeuse: { appId: APP_ID, baseUrl: 'https://example.com' }
  })
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({
        clipcafe,
        server,
        base: `http://127.0.0.1:${server.address().port}`
      })
    })
  })
}

test('anonymous search is capped at freeLimit and flagged limited', async () => {
  const { server, base, clipcafe } = await startApp()
  try {
    const res = await fetch(`${base}/api/search?q=get+a+life&size=30`)
    const body = await res.json()
    assert.strictEqual(body.success, true)
    assert.strictEqual(body.data.results.length, 3)
    assert.strictEqual(body.data.limited, true)
    assert.strictEqual(clipcafe.calls[0].size, 3)
  } finally {
    server.close()
  }
})

test('authenticated search gets full page', async () => {
  const { server, base } = await startApp()
  try {
    const token = makeEs256Token({ sub: 'u1', app: APP_ID, exp: futureExp() }, KEYS)
    const res = await fetch(`${base}/api/search?q=get+a+life&size=30`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const body = await res.json()
    assert.strictEqual(body.data.results.length, 30)
    assert.strictEqual(body.data.limited, false)
  } finally {
    server.close()
  }
})

test('forged tokens stay limited', async () => {
  const { server, base } = await startApp()
  try {
    const claims = { sub: 'hacker', app: APP_ID, exp: futureExp() }
    const forgedTokens = [
      makeHs256Token(claims, SECRET),
      makeEs256Token(claims, createTestKeys(KEYS.kid))
    ]
    for (const forged of forgedTokens) {
      const res = await fetch(`${base}/api/search?q=x&size=30`, {
        headers: { Authorization: `Bearer ${forged}` }
      })
      const body = await res.json()
      assert.strictEqual(body.data.results.length, 3)
      assert.strictEqual(body.data.limited, true)
    }
  } finally {
    server.close()
  }
})

test('freeLimit 0 disables the gate', async () => {
  const { server, base } = await startApp({ freeLimit: 0 })
  try {
    const res = await fetch(`${base}/api/search?q=x&size=30`)
    const body = await res.json()
    assert.strictEqual(body.data.results.length, 30)
    assert.strictEqual(body.data.limited, false)
  } finally {
    server.close()
  }
})

test('/api/me requires valid token', async () => {
  const { server, base } = await startApp()
  try {
    const anon = await fetch(`${base}/api/me`)
    assert.strictEqual(anon.status, 401)

    const forged = makeHs256Token({ sub: 'u1', app: APP_ID, exp: futureExp() }, SECRET)
    const denied = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${forged}` } })
    assert.strictEqual(denied.status, 401)

    const token = makeEs256Token(
      { sub: 'u1', name: 'Jeff', email: 'j@x.com', app: APP_ID, exp: futureExp() },
      KEYS
    )
    const ok = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${token}` } })
    const body = await ok.json()
    assert.strictEqual(body.data.id, 'u1')
  } finally {
    server.close()
  }
})

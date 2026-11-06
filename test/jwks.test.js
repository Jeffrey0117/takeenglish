const { test } = require('node:test')
const assert = require('node:assert')
const { createJwksCache } = require('../src/jwks')
const { createTestKeys, fakeJwksFetch } = require('./helpers')

const JWKS_URL = 'http://jwks.test/api/jwks'
const silent = () => {}

test('fetches the key set once and serves later lookups from cache', async () => {
  const keys = createTestKeys('kid-1')
  const { state, fetchImpl } = fakeJwksFetch([keys.jwk])
  const cache = createJwksCache({ url: JWKS_URL, fetchImpl })

  assert.ok(await cache.getKey('kid-1'))
  assert.ok(await cache.getKey('kid-1'))
  assert.strictEqual(state.calls, 1)
})

test('unknown kid does not refetch inside the cooldown window', async () => {
  const keys = createTestKeys('kid-1')
  const { state, fetchImpl } = fakeJwksFetch([keys.jwk])
  let clock = 1_000_000
  const cache = createJwksCache({ url: JWKS_URL, fetchImpl, now: () => clock })

  assert.strictEqual(await cache.getKey('nope'), null)
  clock += 5_000
  assert.strictEqual(await cache.getKey('nope-2'), null)
  assert.strictEqual(state.calls, 1)
})

test('picks up a rotated key after the cooldown', async () => {
  const oldKeys = createTestKeys('kid-old')
  const newKeys = createTestKeys('kid-new')
  const { state, fetchImpl } = fakeJwksFetch([oldKeys.jwk])
  let clock = 1_000_000
  const cache = createJwksCache({ url: JWKS_URL, fetchImpl, now: () => clock })

  assert.ok(await cache.getKey('kid-old'))
  state.jwks = [newKeys.jwk]
  clock += 61_000
  assert.ok(await cache.getKey('kid-new'))
  assert.strictEqual(state.calls, 2)
})

test('keeps the cached keys when a refresh fails', async () => {
  const keys = createTestKeys('kid-1')
  const { state, fetchImpl } = fakeJwksFetch([keys.jwk])
  let clock = 1_000_000
  const cache = createJwksCache({ url: JWKS_URL, fetchImpl, now: () => clock, onError: silent })

  assert.ok(await cache.getKey('kid-1'))
  state.fail = true
  clock += 61_000
  assert.strictEqual(await cache.getKey('other'), null)
  assert.ok(await cache.getKey('kid-1'))
})

test('drops a key that left the JWKS once the cached set goes stale', async () => {
  const revoked = createTestKeys('kid-revoked')
  const current = createTestKeys('kid-current')
  const { state, fetchImpl } = fakeJwksFetch([revoked.jwk])
  let clock = 1_000_000
  const cache = createJwksCache({ url: JWKS_URL, fetchImpl, now: () => clock })

  assert.ok(await cache.getKey('kid-revoked'))
  state.jwks = [current.jwk]
  clock += 11 * 60_000
  assert.strictEqual(await cache.getKey('kid-revoked'), null)
  assert.ok(await cache.getKey('kid-current'))
})

test('an empty key set from a successful response is authoritative', async () => {
  const keys = createTestKeys('kid-1')
  const { state, fetchImpl } = fakeJwksFetch([keys.jwk])
  let clock = 1_000_000
  const cache = createJwksCache({ url: JWKS_URL, fetchImpl, now: () => clock })

  assert.ok(await cache.getKey('kid-1'))
  state.jwks = []
  clock += 11 * 60_000
  assert.strictEqual(await cache.getKey('kid-1'), null)
})

test('a stale set keeps serving cached keys while the endpoint is down', async () => {
  const keys = createTestKeys('kid-1')
  const { state, fetchImpl } = fakeJwksFetch([keys.jwk])
  let clock = 1_000_000
  const cache = createJwksCache({ url: JWKS_URL, fetchImpl, now: () => clock, onError: silent })

  assert.ok(await cache.getKey('kid-1'))
  state.fail = true
  clock += 11 * 60_000
  assert.ok(await cache.getKey('kid-1'))
  assert.strictEqual(state.calls, 2)
})

test('a fresh cached key is served without refetching', async () => {
  const keys = createTestKeys('kid-1')
  const { state, fetchImpl } = fakeJwksFetch([keys.jwk])
  let clock = 1_000_000
  const cache = createJwksCache({ url: JWKS_URL, fetchImpl, now: () => clock })

  assert.ok(await cache.getKey('kid-1'))
  clock += 5 * 60_000
  assert.ok(await cache.getKey('kid-1'))
  assert.strictEqual(state.calls, 1)
})

test('a response without a keys array is treated as a failed refresh', async () => {
  const keys = createTestKeys('kid-1')
  const { fetchImpl } = fakeJwksFetch([keys.jwk])
  let clock = 1_000_000
  let garbage = false
  const errors = []
  const cache = createJwksCache({
    url: JWKS_URL,
    fetchImpl: async (...args) =>
      garbage ? { ok: true, json: async () => ({ nope: true }) } : fetchImpl(...args),
    now: () => clock,
    onError: (err) => errors.push(err)
  })

  assert.ok(await cache.getKey('kid-1'))
  garbage = true
  clock += 11 * 60_000
  assert.ok(await cache.getKey('kid-1'))
  assert.strictEqual(errors.length, 1)
})

test('endpoint down on first lookup resolves null instead of throwing', async () => {
  const { state, fetchImpl } = fakeJwksFetch([])
  state.fail = true
  const errors = []
  const cache = createJwksCache({ url: JWKS_URL, fetchImpl, onError: (err) => errors.push(err) })
  assert.strictEqual(await cache.getKey('kid-1'), null)
  assert.strictEqual(errors.length, 1)
})

test('ignores keys that are not EC P-256 or have no kid', async () => {
  const keys = createTestKeys('kid-1')
  const { kid, ...noKid } = keys.jwk
  const { fetchImpl } = fakeJwksFetch([
    noKid,
    { kty: 'RSA', kid: 'rsa-1', n: 'abc', e: 'AQAB' },
    { kty: 'EC', crv: 'P-256', kid: 'broken', x: '!!', y: '!!' }
  ])
  let clock = 1_000_000
  const cache = createJwksCache({ url: JWKS_URL, fetchImpl, now: () => clock })
  assert.strictEqual(await cache.getKey('rsa-1'), null)
  clock += 61_000
  assert.strictEqual(await cache.getKey('broken'), null)
  assert.strictEqual(await cache.getKey(undefined), null)
})

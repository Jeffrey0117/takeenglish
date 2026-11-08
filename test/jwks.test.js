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

// 2026-11-08 改寫：新鮮度的來源從「讀取時發現超過 MAX_AGE 就重抓」換成「定時
// 主動抓」（src/jwks.js 的 refreshMs，同樣 10 分鐘）。這兩條原本是靠推進假時鐘
// 讓讀取去觸發重抓，現在改成明確 refresh() 驅動 —— 要驗的性質完全沒變：
// **撤銷必須真的生效**，而且是最晚 10 分鐘內（定時刷新的週期）。
test('drops a key that left the JWKS after a refresh（撤銷必須真的生效）', async () => {
  const revoked = createTestKeys('kid-revoked')
  const current = createTestKeys('kid-current')
  const { state, fetchImpl } = fakeJwksFetch([revoked.jwk])
  const cache = createJwksCache({ url: JWKS_URL, fetchImpl })

  assert.ok(await cache.getKey('kid-revoked'))
  state.jwks = [current.jwk]
  await cache.refresh() // 定時刷新在生產環境做的就是這件事
  assert.strictEqual(await cache.getKey('kid-revoked'), null, '下架的金鑰要失效')
  assert.ok(await cache.getKey('kid-current'))
})

test('an empty key set from a successful response is authoritative', async () => {
  // 劇本：LetMeUse 私鑰外洩 → 把金鑰整批從 JWKS 下架。如果「空的不覆蓋」，
  // 這邊會繼續拿舊公鑰放行被盜金鑰簽的 token，直到有人想起來重啟 process。
  const keys = createTestKeys('kid-1')
  const { state, fetchImpl } = fakeJwksFetch([keys.jwk])
  const cache = createJwksCache({ url: JWKS_URL, fetchImpl, onError: silent })

  assert.ok(await cache.getKey('kid-1'))
  state.jwks = []
  await cache.refresh()
  assert.strictEqual(await cache.getKey('kid-1'), null, '權威的空回應要清空快取')
})

// 2026-11-08 改寫：新鮮度從「讀取時發現超過 10 分鐘就重抓」改成「定時主動抓」
// （見 src/jwks.js）。所以這條不再靠讀取觸發重抓，改成直接驗那個真正重要的性
// 質：**端點掛了的時候,已登入的人不該被踢掉。**
// 原本的版本順便斷言「讀取會觸發第二次抓取」,那是舊政策的實作細節。
test('endpoint down: cached keys keep working (一次抖動不該把所有人登出)', async () => {
  const keys = createTestKeys('kid-1')
  const { state, fetchImpl } = fakeJwksFetch([keys.jwk])
  const cache = createJwksCache({ url: JWKS_URL, fetchImpl, onError: silent })

  assert.ok(await cache.getKey('kid-1'))
  state.fail = true
  await cache.refresh() // 主動抓一次,失敗
  assert.ok(await cache.getKey('kid-1'), '傳輸失敗時舊公鑰要留著')
  assert.ok(cache.stats().lastError, '但失敗要記下來（fail-closed 不能無聲）')
})

// 放棄門檻（maxStaleMs）才是「抓不回來多久之後不再信任舊快取」。
// 刻意確認它**不是** 10 分鐘 —— 把它設成新鮮度目標等於「上游掛 10 分鐘就把
// 所有人登出」，那是這次回套差點犯下的錯。
test('maxStaleMs 是放棄門檻,不是新鮮度目標（上游短暫掛掉不該登出所有人）', async () => {
  const keys = createTestKeys('kid-1')
  const { state, fetchImpl } = fakeJwksFetch([keys.jwk])
  let clock = 1_000_000
  const cache = createJwksCache({ url: JWKS_URL, fetchImpl, now: () => clock, onError: silent })

  assert.ok(await cache.getKey('kid-1'))
  state.fail = true
  clock += 60 * 60_000 // 一小時抓不到
  assert.ok(await cache.getKey('kid-1'), '一小時的上游故障不該把人踢掉')
  assert.strictEqual(cache.stats().stale, false)

  clock += 25 * 60 * 60_000 // 累計超過 24 小時
  assert.strictEqual(cache.stats().stale, true, '超過放棄門檻要標記 stale')
  assert.strictEqual(await cache.getKey('kid-1'), null, '放棄之後一律拒絕')
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

// 同上，改成用主動 refresh() 驅動（新政策下讀取不再觸發過期重抓）。
test('a response without a keys array is treated as a failed refresh', async () => {
  const keys = createTestKeys('kid-1')
  const { fetchImpl } = fakeJwksFetch([keys.jwk])
  let garbage = false
  const errors = []
  const cache = createJwksCache({
    url: JWKS_URL,
    fetchImpl: async (...args) =>
      garbage ? { ok: true, json: async () => ({ nope: true }) } : fetchImpl(...args),
    onError: (err) => errors.push(err)
  })

  assert.ok(await cache.getKey('kid-1'))
  garbage = true
  await cache.refresh()
  assert.strictEqual(errors.length, 1, '垃圾回應算抓取失敗')
  assert.ok(await cache.getKey('kid-1'), '而且不該拿垃圾去覆蓋好的快取')
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

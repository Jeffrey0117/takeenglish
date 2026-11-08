const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createApp } = require('../src/app')
const { createAuth } = require('../src/auth')
const { createJwksCache } = require('../src/jwks')
const { createPlans } = require('../src/plans')
const { createPaygate } = require('../src/paygate')
const { createTestKeys, makeEs256Token, fakeJwksFetch, futureExp, TEST_TOKENS, clipId } = require('./helpers')

const APP_ID = 'app_test'
const KEYS = createTestKeys('kid-1')
const PLAN = {
  id: 'takeenglish:pro:monthly',
  product: 'takeenglish',
  display_name: 'Pro',
  billing_cycle: 'monthly',
  price: 149,
  is_active: 1
}

function tokenFor(email, sub = `user-${email}`) {
  return makeEs256Token({ sub, email, name: 'Tester', app: APP_ID, exp: futureExp() }, KEYS)
}

const bearer = (email) => ({ Authorization: `Bearer ${tokenFor(email)}` })

// 假的 PayGate:subscribers 裡的 email 就是付費會員
function fakePaygateServer({ subscribers = {}, plans = [PLAN], down = false } = {}) {
  const state = { subscribers: { ...subscribers }, plans, down, calls: [] }
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url)
    const body = init.body ? JSON.parse(init.body) : null
    state.calls.push({ path: u.pathname, method: init.method || 'GET', body, auth: (init.headers || {}).Authorization })
    if (state.down) throw new Error('connect ECONNREFUSED')
    const json = (status, data) => new Response(JSON.stringify(data), { status })
    if (u.pathname === '/api/subscription/check') {
      const until = state.subscribers[u.searchParams.get('email')]
      return json(200, until ? { active: true, tier: 'pro', end_date: until } : { active: false })
    }
    if (u.pathname === '/api/plans') return json(200, { plans: state.plans })
    if ((init.headers || {}).Authorization !== 'Bearer paygate-token') return json(401, { error: 'Unauthorized' })
    if (u.pathname === '/api/newebpay/subscribe') {
      return json(200, { success: true, checkout_url: 'https://pay.example/npay/npo_1' })
    }
    if (u.pathname === '/api/newebpay/cancel') {
      const until = state.subscribers[body.email]
      return until ? json(200, { success: true, active_until: until }) : json(404, { error: 'No active subscription' })
    }
    return json(404, { error: 'not found' })
  }
  return { state, fetchImpl }
}

function fakeClipcafe() {
  return {
    search(params) {
      const results = Array.from({ length: params.size }, (_, i) => ({
        slug: `clip-${i}`,
        text: `line ${i}`,
        mp4: `https://source.example/videos/clip-${i}.mp4`,
        hls: `https://source.example/hls/clip-${i}/master.m3u8`,
        movieTitle: 'Some Show',
        movieSlug: 'some-show',
        movieYear: 2020,
        season: 1,
        episode: 2,
        quality: 'HD',
        imdb: 'tt0000001',
        duration: 5,
        subLangs: ['en', 'BAD LANG']
      }))
      return Promise.resolve({ total: 100, from: params.from, size: params.size, results })
    }
  }
}

function startApp({ paygate = fakePaygateServer(), publicUrl = 'https://site.example', memberLimit = 0, now } = {}) {
  const { fetchImpl } = fakeJwksFetch([KEYS.jwk])
  const app = createApp({
    clipcafe: fakeClipcafe(),
    auth: createAuth({
      appId: APP_ID,
      secret: 's',
      jwks: createJwksCache({ url: 'https://jwks.test/api/jwks', fetchImpl })
    }),
    tokens: TEST_TOKENS,
    freeLimit: 3,
    memberLimit,
    paygate: createPaygate({
      baseUrl: 'http://paygate.test',
      token: 'paygate-token',
      fetchImpl: paygate.fetchImpl,
      onError: () => {},
      ...(now ? { now } : {})
    }),
    publicUrl,
    letmeuse: { appId: APP_ID, baseUrl: 'https://example.com' }
  })
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({ server, paygate, base: `http://127.0.0.1:${server.address().port}` })
    })
  })
}

const postJson = (url, headers = {}) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' })

// ---- 等級定義 ----

test('plans: 訪客 3 筆、會員不限、只有 Pro 能下載', () => {
  const plans = createPlans({ guestLimit: 3, memberLimit: 0 })
  assert.equal(plans.resultLimit('guest'), 3)
  assert.equal(plans.resultLimit('free'), null)
  assert.equal(plans.resultLimit('pro'), null)
  assert.equal(plans.can('guest', 'download'), false)
  assert.equal(plans.can('free', 'download'), false)
  assert.equal(plans.can('pro', 'download'), true)
  assert.equal(plans.can('guest', 'subtitles'), true)
  assert.deepEqual(plans.summary().map((t) => t.id), ['guest', 'free', 'pro'])
})

test('plans: 可以用設定收緊免費會員的筆數', () => {
  const plans = createPlans({ guestLimit: 3, memberLimit: 10 })
  assert.equal(plans.resultLimit('free'), 10)
  assert.equal(plans.resultLimit('pro'), null)
})

// ---- 搜尋結果 ----

test('search: 回傳的片段不帶 slug、片源網址或任何片源欄位', async () => {
  const { server, base } = await startApp()
  try {
    const body = await (await fetch(`${base}/api/search?q=hello`)).json()
    assert.equal(body.data.tier, 'guest')
    assert.equal(body.data.results.length, 3)
    const raw = JSON.stringify(body)
    for (const leak of ['clip-0', 'source.example', '.mp4', 'm3u8', 'some-show', 'tt0000001', 'slug']) {
      assert.ok(!raw.includes(leak), `response leaks ${leak}`)
    }
    const clip = body.data.results[0]
    assert.deepEqual(Object.keys(clip).sort(), [
      'duration', 'episode', 'id', 'movieTitle', 'movieYear', 'quality', 'season', 'subs', 'text', 'thumb', 'video'
    ])
    assert.equal(clip.id, clipId('clip-0'))
    assert.equal(clip.thumb, `/thumb/${clip.id}.jpg`)
    assert.equal(TEST_TOKENS.open('v', clip.video.replace('/v/', '')), 'clip-0')
    assert.deepEqual(clip.subs, [{ lang: 'en', url: `/sub/${clip.id}/en.vtt` }])
  } finally {
    server.close()
  }
})

test('search: 免費會員看全部;memberLimit 設了就照它擋,Pro 不受限', async () => {
  const paygate = fakePaygateServer({ subscribers: { 'pro@example.com': '2099-01-01' } })
  const { server, base } = await startApp({ paygate, memberLimit: 10 })
  try {
    const free = await (await fetch(`${base}/api/search?q=hello&size=30`, { headers: bearer('free@example.com') })).json()
    assert.equal(free.data.tier, 'free')
    assert.equal(free.data.results.length, 10)
    assert.equal(free.data.limited, true)
    const pro = await (await fetch(`${base}/api/search?q=hello&size=30`, { headers: bearer('pro@example.com') })).json()
    assert.equal(pro.data.tier, 'pro')
    assert.equal(pro.data.results.length, 30)
    assert.equal(pro.data.limited, false)
  } finally {
    server.close()
  }
})

// ---- 我是誰 ----

test('/api/me 回等級與到期日;email 大小寫不影響', async () => {
  const paygate = fakePaygateServer({ subscribers: { 'pro@example.com': '2099-01-01' } })
  const { server, base } = await startApp({ paygate })
  try {
    const pro = await (await fetch(`${base}/api/me`, { headers: bearer('Pro@Example.com') })).json()
    assert.equal(pro.data.tier, 'pro')
    assert.equal(pro.data.activeUntil, '2099-01-01')
    const free = await (await fetch(`${base}/api/me`, { headers: bearer('free@example.com') })).json()
    assert.equal(free.data.tier, 'free')
    assert.equal(free.data.activeUntil, null)
    assert.equal((await fetch(`${base}/api/me`)).status, 401)
  } finally {
    server.close()
  }
})

test('/api/me?fresh=1 跳過快取 — 剛付完款馬上變 Pro', async () => {
  const paygate = fakePaygateServer()
  const { server, base } = await startApp({ paygate })
  try {
    const headers = bearer('new@example.com')
    assert.equal((await (await fetch(`${base}/api/me`, { headers })).json()).data.tier, 'free')
    paygate.state.subscribers['new@example.com'] = '2099-01-01'
    assert.equal((await (await fetch(`${base}/api/me`, { headers })).json()).data.tier, 'free')
    assert.equal((await (await fetch(`${base}/api/me?fresh=1`, { headers })).json()).data.tier, 'pro')
    assert.equal((await (await fetch(`${base}/api/me`, { headers })).json()).data.tier, 'pro')
  } finally {
    server.close()
  }
})

test('PayGate 掛掉:剛問過的沿用上次答案,沒問過的當免費會員,站不會壞', async () => {
  let clock = 1_000_000
  const paygate = fakePaygateServer({ subscribers: { 'pro@example.com': '2099-01-01' } })
  const { server, base } = await startApp({ paygate, now: () => clock })
  try {
    assert.equal((await (await fetch(`${base}/api/me`, { headers: bearer('pro@example.com') })).json()).data.tier, 'pro')
    paygate.state.down = true
    clock += 5 * 60_000
    assert.equal((await (await fetch(`${base}/api/me`, { headers: bearer('pro@example.com') })).json()).data.tier, 'pro')
    clock += 6 * 60_000
    assert.equal((await (await fetch(`${base}/api/me`, { headers: bearer('pro@example.com') })).json()).data.tier, 'free')
    const stranger = await fetch(`${base}/api/search?q=hello`, { headers: bearer('other@example.com') })
    assert.equal(stranger.status, 200)
    assert.equal((await stranger.json()).data.tier, 'free')
  } finally {
    server.close()
  }
})

// ---- 設定 ----

test('/api/config 帶等級表與 Pro 價格(價格來自 PayGate)', async () => {
  const { server, base } = await startApp()
  try {
    const body = await (await fetch(`${base}/api/config`)).json()
    assert.equal(body.data.billing.enabled, true)
    assert.deepEqual(body.data.billing.plan, { id: PLAN.id, name: 'Pro', price: 149, cycle: 'monthly' })
    assert.equal(body.data.tiers.find((t) => t.id === 'pro').features.download, true)
    assert.equal(body.data.tiers.find((t) => t.id === 'guest').features.results, 3)
  } finally {
    server.close()
  }
})

test('/api/config 沒設 PUBLIC_URL 或方案不存在時,不顯示可結帳', async () => {
  const noUrl = await startApp({ publicUrl: '' })
  try {
    const body = await (await fetch(`${noUrl.base}/api/config`)).json()
    assert.deepEqual(body.data.billing, { enabled: false, plan: null })
  } finally {
    noUrl.server.close()
  }
  const noPlan = await startApp({ paygate: fakePaygateServer({ plans: [] }) })
  try {
    const body = await (await fetch(`${noPlan.base}/api/config`)).json()
    assert.equal(body.data.billing.plan, null)
  } finally {
    noPlan.server.close()
  }
})

// ---- 結帳與退訂 ----

test('checkout: 登入的免費會員拿到付款頁網址,email 與回跳網址由後端決定', async () => {
  const { server, base, paygate } = await startApp()
  try {
    const res = await postJson(`${base}/api/billing/checkout`, bearer('Buyer@Example.com'))
    assert.equal(res.status, 200)
    assert.equal((await res.json()).data.checkoutUrl, 'https://pay.example/npay/npo_1')
    const call = paygate.state.calls.find((c) => c.path === '/api/newebpay/subscribe')
    assert.deepEqual(call.body, {
      email: 'buyer@example.com',
      product: 'takeenglish',
      plan_id: 'takeenglish:pro:monthly',
      return_url: 'https://site.example/?upgraded=1'
    })
    assert.equal(call.auth, 'Bearer paygate-token')
  } finally {
    server.close()
  }
})

test('checkout: 沒登入 401;已經是 Pro 409(不會重複訂閱);PayGate 壞掉 502', async () => {
  const paygate = fakePaygateServer({ subscribers: { 'pro@example.com': '2099-01-01' } })
  const { server, base } = await startApp({ paygate })
  try {
    assert.equal((await postJson(`${base}/api/billing/checkout`)).status, 401)
    const already = await postJson(`${base}/api/billing/checkout`, bearer('pro@example.com'))
    assert.equal(already.status, 409)
    assert.equal((await already.json()).error, 'already_subscribed')
    assert.ok(!paygate.state.calls.some((c) => c.path === '/api/newebpay/subscribe'))
    paygate.state.down = true
    assert.equal((await postJson(`${base}/api/billing/checkout`, bearer('free@example.com'))).status, 502)
  } finally {
    server.close()
  }
})

test('checkout: 金流沒設定時 503', async () => {
  const { server, base } = await startApp({ publicUrl: '' })
  try {
    assert.equal((await postJson(`${base}/api/billing/checkout`, bearer('free@example.com'))).status, 503)
  } finally {
    server.close()
  }
})

test('checkout: 同一個人一分鐘內狂按會被擋', async () => {
  const { server, base } = await startApp()
  try {
    const headers = bearer('spam@example.com')
    const statuses = []
    for (let i = 0; i < 8; i += 1) statuses.push((await postJson(`${base}/api/billing/checkout`, headers)).status)
    assert.deepEqual(statuses.slice(0, 6), [200, 200, 200, 200, 200, 200])
    assert.deepEqual(statuses.slice(6), [429, 429])
  } finally {
    server.close()
  }
})

test('cancel: Pro 退訂拿到「用到哪天」;沒訂閱 404;沒登入 401', async () => {
  const paygate = fakePaygateServer({ subscribers: { 'pro@example.com': '2099-01-01' } })
  const { server, base } = await startApp({ paygate })
  try {
    const ok = await postJson(`${base}/api/billing/cancel`, bearer('pro@example.com'))
    assert.equal(ok.status, 200)
    assert.equal((await ok.json()).data.activeUntil, '2099-01-01')
    const none = await postJson(`${base}/api/billing/cancel`, bearer('free@example.com'))
    assert.equal(none.status, 404)
    assert.equal((await none.json()).error, 'no_subscription')
    assert.equal((await postJson(`${base}/api/billing/cancel`)).status, 401)
  } finally {
    server.close()
  }
})

// ---- 下載 ----

test('download: 訪客 401、免費會員 402、Pro 拿到兩分鐘有效的下載網址', async () => {
  const paygate = fakePaygateServer({ subscribers: { 'pro@example.com': '2099-01-01' } })
  const { server, base } = await startApp({ paygate })
  try {
    const url = `${base}/api/clips/${clipId('clip-0')}/download`
    assert.equal((await postJson(url)).status, 401)
    const free = await postJson(url, bearer('free@example.com'))
    assert.equal(free.status, 402)
    assert.equal((await free.json()).error, 'upgrade_required')
    const pro = await postJson(url, bearer('pro@example.com'))
    assert.equal(pro.status, 200)
    const ticket = (await pro.json()).data.url
    assert.ok(ticket.startsWith('/dl/'))
    assert.equal(TEST_TOKENS.open('dl', ticket.replace('/dl/', '')), 'clip-0')
    assert.equal(TEST_TOKENS.open('v', ticket.replace('/dl/', '')), null)
  } finally {
    server.close()
  }
})

test('download: 代號不對 404 — 不能拿 slug 或播放網址來換下載', async () => {
  const paygate = fakePaygateServer({ subscribers: { 'pro@example.com': '2099-01-01' } })
  const { server, base } = await startApp({ paygate })
  try {
    const play = TEST_TOKENS.seal('v', 'clip-0', { ttlMs: 60_000 })
    for (const bad of ['clip-0', play, 'x'.repeat(60)]) {
      assert.equal((await postJson(`${base}/api/clips/${bad}/download`, bearer('pro@example.com'))).status, 404)
    }
  } finally {
    server.close()
  }
})

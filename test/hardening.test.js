const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createApp } = require('../src/app')
const { createAuth } = require('../src/auth')
const { createPaygate } = require('../src/paygate')
const { TEST_TOKENS } = require('./helpers')

const playToken = (slug) => TEST_TOKENS.seal('v', slug, { ttlMs: 60_000 })

function startApp({ clipcafe, strictPlayback = false } = {}) {
  const app = createApp({
    clipcafe,
    auth: createAuth({ appId: 'app_test', secret: 's', jwks: { getKey: async () => null } }),
    tokens: TEST_TOKENS,
    strictPlayback,
    letmeuse: {}
  })
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` })
    })
  })
}

function streamingClipcafe() {
  const calls = []
  return {
    calls,
    search: async () => ({
      total: 1,
      results: [{ slug: 'clip-0', text: 'hi', duration: '<img src=x onerror=alert(1)>', season: '1"><script>', episode: null, movieYear: '2020' }]
    }),
    async stream(slug) {
      calls.push(slug)
      return { status: 200, headers: {}, body: new Response('mp4-bytes').body, abort() {} }
    }
  }
}

// ---- 搜尋 ----

test('search: 回應不准快取(登入後不能還拿到訪客時的結果)', async () => {
  const { server, base } = await startApp({ clipcafe: streamingClipcafe() })
  try {
    const res = await fetch(`${base}/api/search?q=hello`)
    assert.equal(res.headers.get('cache-control'), 'no-store')
  } finally {
    server.close()
  }
})

test('search: 片源塞進數字欄位的字串不會原樣流到前端', async () => {
  const { server, base } = await startApp({ clipcafe: streamingClipcafe() })
  try {
    const body = await (await fetch(`${base}/api/search?q=hello`)).json()
    const clip = body.data.results[0]
    assert.equal(clip.duration, 0)
    assert.equal(clip.season, 0)
    assert.equal(clip.episode, 0)
    assert.equal(clip.movieYear, 2020)
    assert.ok(!JSON.stringify(body).includes('<script>'))
  } finally {
    server.close()
  }
})

// ---- 播放端點 ----

test('/v: HEAD 回 405,不會去拉片源', async () => {
  const clipcafe = streamingClipcafe()
  const { server, base } = await startApp({ clipcafe })
  try {
    const res = await fetch(`${base}/v/${playToken('clip-0')}`, { method: 'HEAD' })
    assert.equal(res.status, 405)
    assert.equal(res.headers.get('allow'), 'GET')
    assert.equal(clipcafe.calls.length, 0)
  } finally {
    server.close()
  }
})

test('/v 預設模式:擋別站嵌入與直接開網址,沒帶標頭的放行', async () => {
  const { server, base } = await startApp({ clipcafe: streamingClipcafe() })
  try {
    const url = `${base}/v/${playToken('clip-0')}`
    const status = async (headers) => {
      const res = await fetch(url, { headers })
      await res.arrayBuffer()
      return res.status
    }
    assert.equal(await status({}), 200)
    assert.equal(await status({ 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Dest': 'video' }), 200)
    assert.equal(await status({ 'Sec-Fetch-Site': 'none', 'Sec-Fetch-Dest': 'video' }), 200)
    assert.equal(await status({ 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'video' }), 403)
    assert.equal(await status({ 'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Dest': 'video' }), 403)
    assert.equal(await status({ 'Sec-Fetch-Site': 'none', 'Sec-Fetch-Dest': 'document' }), 403)
    assert.equal(await status({ 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Dest': 'iframe' }), 403)
  } finally {
    server.close()
  }
})

test('/v 嚴格模式:沒帶瀏覽器標頭(照抄網址用工具抓)一律擋', async () => {
  const { server, base } = await startApp({ clipcafe: streamingClipcafe(), strictPlayback: true })
  try {
    const url = `${base}/v/${playToken('clip-0')}`
    assert.equal((await fetch(url)).status, 403)
    assert.equal((await fetch(url, { headers: { 'Sec-Fetch-Site': 'none', 'Sec-Fetch-Dest': 'video' } })).status, 403)
    const ok = await fetch(url, { headers: { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Dest': 'video' } })
    assert.equal(ok.status, 200)
    await ok.arrayBuffer()
  } finally {
    server.close()
  }
})

test('/v: 同一個 IP 同時最多 12 條影片連線,放掉之後名額回來', async () => {
  const releases = []
  const clipcafe = {
    search: async () => ({ total: 0, results: [] }),
    stream: () =>
      new Promise((resolve) => {
        releases.push(() => resolve({ status: 404, headers: {}, body: null, abort() {} }))
      })
  }
  const { server, base } = await startApp({ clipcafe })
  try {
    const url = `${base}/v/${playToken('clip-0')}`
    const held = Array.from({ length: 12 }, () => fetch(url))
    while (releases.length < 12) await new Promise((r) => setTimeout(r, 5))
    const extra = await fetch(url)
    assert.equal(extra.status, 429)
    assert.equal(extra.headers.get('retry-after'), '10')
    for (const release of releases) release()
    for (const res of await Promise.all(held)) assert.equal(res.status, 404)
    const after = fetch(url)
    while (releases.length < 13) await new Promise((r) => setTimeout(r, 5))
    releases[12]()
    assert.equal((await after).status, 404)
  } finally {
    server.close()
  }
})

// ---- PayGate 客戶端 ----

function paygateWith(respond, clock = { t: 1_000_000 }) {
  const calls = []
  const paygate = createPaygate({
    baseUrl: 'http://paygate.test',
    token: 't',
    now: () => clock.t,
    onError: () => {},
    fetchImpl: async (url) => {
      calls.push(String(url))
      return respond(String(url))
    }
  })
  return { paygate, calls, clock }
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status })

test('paygate: 回 200 但不是預期的 JSON 時當成失敗,不會把 Pro 記成免費', async () => {
  let mode = 'ok'
  const { paygate, clock } = paygateWith(() =>
    mode === 'ok' ? json({ active: true, end_date: '2099-01-01' }) : new Response('<html>gateway error</html>', { status: 200 })
  )
  assert.equal((await paygate.tierFor('pro@example.com')).tier, 'pro')
  mode = 'garbage'
  clock.t += 2 * 60_000
  assert.equal((await paygate.tierFor('pro@example.com')).tier, 'pro')
  mode = 'empty-object'
  clock.t += 60_000
  assert.equal((await paygate.tierFor('pro@example.com', { fresh: true })).tier, 'pro')
})

test('paygate: 掛掉期間 30 秒內不重複去等逾時', async () => {
  const { paygate, calls, clock } = paygateWith(() => {
    throw new Error('connect ECONNREFUSED')
  })
  assert.equal((await paygate.tierFor('a@example.com')).tier, 'free')
  assert.equal((await paygate.tierFor('a@example.com')).tier, 'free')
  assert.equal(calls.length, 1)
  clock.t += 31_000
  await paygate.tierFor('a@example.com')
  assert.equal(calls.length, 2)
  assert.equal(await paygate.plan(), null)
  assert.equal(await paygate.plan(), null)
  assert.equal(calls.filter((url) => url.includes('/api/plans')).length, 1)
})

test('paygate: 同一個人同時進來的查詢只問一次', async () => {
  let release
  const { paygate, calls } = paygateWith(
    () =>
      new Promise((resolve) => {
        release = () => resolve(json({ active: true, end_date: '2099-01-01' }))
      })
  )
  const both = Promise.all([paygate.tierFor('a@example.com'), paygate.tierFor('A@Example.com ')])
  while (!release) await new Promise((r) => setTimeout(r, 5))
  release()
  const [first, second] = await both
  assert.equal(first.tier, 'pro')
  assert.equal(second.tier, 'pro')
  assert.equal(calls.length, 1)
})

test('paygate: 付款頁網址不是 http(s) 就拒絕', async () => {
  const { paygate } = paygateWith(() => json({ success: true, checkout_url: 'javascript:alert(1)' }))
  await assert.rejects(paygate.checkout('a@example.com', 'https://site.example/?upgraded=1'))
})

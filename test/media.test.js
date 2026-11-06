const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createApp } = require('../src/app')
const { createAuth } = require('../src/auth')
const { createMediaTokens } = require('../src/media-tokens')
const { downloadName } = require('../src/media-routes')
const { TEST_TOKENS, clipId } = require('./helpers')

const SECRET = 'unit-test-secret-'.padEnd(40, 'y')

// ---- 簽章 ----

test('tokens: 穩定代號每次都一樣,看不出原本的 slug,而且解得回來', () => {
  const tokens = createMediaTokens({ secret: SECRET })
  const a = tokens.seal('id', 'piece-of-cake')
  assert.equal(a, tokens.seal('id', 'piece-of-cake'))
  assert.notEqual(a, tokens.seal('id', 'piece-of-cakes'))
  assert.ok(!a.includes('piece'))
  assert.ok(!Buffer.from(a, 'base64url').toString('latin1').includes('piece-of-cake'))
  assert.equal(tokens.open('id', a), 'piece-of-cake')
})

test('tokens: 播放網址每次不同、會過期', () => {
  let clock = 1_000_000
  const tokens = createMediaTokens({ secret: SECRET, now: () => clock })
  const a = tokens.seal('v', 'piece-of-cake', { ttlMs: 60_000 })
  assert.notEqual(a, tokens.seal('v', 'piece-of-cake', { ttlMs: 60_000 }))
  assert.equal(tokens.open('v', a), 'piece-of-cake')
  clock += 61_000
  assert.equal(tokens.open('v', a), null)
})

test('tokens: 用途互不通用 — 縮圖代號不能拿去播放或下載', () => {
  const tokens = createMediaTokens({ secret: SECRET })
  const id = tokens.seal('id', 'piece-of-cake')
  const play = tokens.seal('v', 'piece-of-cake', { ttlMs: 60_000 })
  assert.equal(tokens.open('v', id), null)
  assert.equal(tokens.open('dl', id), null)
  assert.equal(tokens.open('dl', play), null)
  assert.equal(tokens.open('id', play), null)
})

test('tokens: 竄改、亂填、別把金鑰簽的都驗不過', () => {
  const tokens = createMediaTokens({ secret: SECRET })
  const other = createMediaTokens({ secret: 'another-secret-'.padEnd(40, 'z') })
  const id = tokens.seal('id', 'piece-of-cake')
  const flipped = (id[0] === 'A' ? 'B' : 'A') + id.slice(1)
  for (const bad of [flipped, id.slice(0, -2), '', 'piece-of-cake', 'a'.repeat(500), '../etc', null, 42]) {
    assert.equal(tokens.open('id', bad), null)
  }
  assert.equal(other.open('id', id), null)
})

test('tokens: 金鑰太短直接拒絕啟動;過期規則不能用錯', () => {
  assert.throws(() => createMediaTokens({ secret: 'short' }))
  const tokens = createMediaTokens({ secret: SECRET })
  assert.throws(() => tokens.seal('id', 'x', { ttlMs: 1000 }))
  assert.throws(() => tokens.seal('v', 'x'))
})

test('downloadName: 只留英數,不讓檔名夾帶奇怪字元', () => {
  assert.equal(downloadName('Piece of cake!'), 'takeenglish-piece-of-cake.mp4')
  assert.equal(downloadName('"; rm -rf\r\n'), 'takeenglish-rm-rf.mp4')
  assert.equal(downloadName(''), 'takeenglish-clip.mp4')
  assert.equal(downloadName(undefined), 'takeenglish-clip.mp4')
  assert.ok(downloadName('a'.repeat(300)).length <= 80)
})

// ---- 路由 ----

function videoStream(text) {
  return new Response(text).body
}

function fakeClipcafe(overrides = {}) {
  const calls = []
  return {
    calls,
    search: async () => ({ total: 0, results: [] }),
    thumb: async () => ({ status: 404, body: null }),
    async subtitles(slug, lang) {
      calls.push({ kind: 'subs', slug, lang })
      return { status: 200, text: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhi\n' }
    },
    async stream(slug, range) {
      calls.push({ kind: 'stream', slug, range })
      return range
        ? { status: 206, headers: { 'content-range': 'bytes 0-3/9', 'content-length': '4' }, body: videoStream('mp4-'), abort() {} }
        : { status: 200, headers: { 'content-length': '9' }, body: videoStream('mp4-bytes'), abort() {} }
    },
    ...overrides
  }
}

function startApp(clipcafe = fakeClipcafe()) {
  const app = createApp({
    clipcafe,
    auth: createAuth({ appId: 'app_test', secret: 's', jwks: { getKey: async () => null } }),
    tokens: TEST_TOKENS,
    letmeuse: {}
  })
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({ clipcafe, server, base: `http://127.0.0.1:${server.address().port}` })
    })
  })
}

const playToken = (slug, ttlMs = 60_000) => TEST_TOKENS.seal('v', slug, { ttlMs })
const downloadToken = (slug, ttlMs = 60_000) => TEST_TOKENS.seal('dl', slug, { ttlMs })

test('GET /v/:token 串流影片,不快取到共用快取,別站不能嵌', async () => {
  const { server, base, clipcafe } = await startApp()
  try {
    const res = await fetch(`${base}/v/${playToken('piece-of-cake')}`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'video/mp4')
    assert.equal(res.headers.get('accept-ranges'), 'bytes')
    assert.equal(res.headers.get('cross-origin-resource-policy'), 'same-origin')
    assert.equal(res.headers.get('content-disposition'), 'inline')
    assert.ok(res.headers.get('cache-control').startsWith('private'))
    assert.equal(await res.text(), 'mp4-bytes')
    assert.deepEqual(clipcafe.calls, [{ kind: 'stream', slug: 'piece-of-cake', range: undefined }])
  } finally {
    server.close()
  }
})

test('GET /v/:token 支援 Range(拖進度條)', async () => {
  const { server, base, clipcafe } = await startApp()
  try {
    const res = await fetch(`${base}/v/${playToken('piece-of-cake')}`, { headers: { Range: 'bytes=0-3' } })
    assert.equal(res.status, 206)
    assert.equal(res.headers.get('content-range'), 'bytes 0-3/9')
    assert.equal(await res.text(), 'mp4-')
    assert.equal(clipcafe.calls[0].range, 'bytes=0-3')
  } finally {
    server.close()
  }
})

test('GET /v/:token 過期、亂填、拿別種代號來 → 403,不碰上游', async () => {
  const { server, base, clipcafe } = await startApp()
  try {
    const expired = TEST_TOKENS.seal('v', 'piece-of-cake', { ttlMs: -1000 })
    for (const bad of [expired, clipId('piece-of-cake'), downloadToken('piece-of-cake'), 'piece-of-cake', 'x'.repeat(60)]) {
      const res = await fetch(`${base}/v/${bad}`)
      assert.equal(res.status, 403, bad)
      assert.equal(res.headers.get('cache-control'), 'no-store')
    }
    assert.equal(clipcafe.calls.length, 0)
  } finally {
    server.close()
  }
})

test('GET /v/:token 擋掉別站嵌入與直接開網址', async () => {
  const { server, base, clipcafe } = await startApp()
  try {
    const url = `${base}/v/${playToken('piece-of-cake')}`
    const crossSite = await fetch(url, { headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'video' } })
    assert.equal(crossSite.status, 403)
    const addressBar = await fetch(url, { headers: { 'Sec-Fetch-Site': 'none', 'Sec-Fetch-Dest': 'document' } })
    assert.equal(addressBar.status, 403)
    assert.equal(clipcafe.calls.length, 0)
    const player = await fetch(url, { headers: { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Dest': 'video' } })
    assert.equal(player.status, 200)
    await player.text()
  } finally {
    server.close()
  }
})

test('GET /v/:token 上游沒這支片 → 404;上游忙 → 503;其他 → 502;連不上 → 502', async () => {
  for (const [upstreamStatus, expected] of [[404, 404], [503, 503], [500, 502]]) {
    const clipcafe = fakeClipcafe({
      stream: async () => ({ status: upstreamStatus, headers: {}, body: null, abort() {} })
    })
    const { server, base } = await startApp(clipcafe)
    try {
      const res = await fetch(`${base}/v/${playToken('piece-of-cake')}`)
      assert.equal(res.status, expected)
      assert.equal(res.headers.get('cache-control'), 'no-store')
    } finally {
      server.close()
    }
  }
  const down = fakeClipcafe({
    stream: async () => {
      throw new Error('connect ECONNREFUSED')
    }
  })
  const { server, base } = await startApp(down)
  try {
    assert.equal((await fetch(`${base}/v/${playToken('piece-of-cake')}`)).status, 502)
  } finally {
    server.close()
  }
})

test('GET /dl/:token 以附件送出、檔名乾淨、不快取', async () => {
  const { server, base } = await startApp()
  try {
    const res = await fetch(`${base}/dl/${downloadToken('piece-of-cake')}?name=${encodeURIComponent('Piece of "cake"')}`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-disposition'), 'attachment; filename="takeenglish-piece-of-cake.mp4"')
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.equal(await res.text(), 'mp4-bytes')
  } finally {
    server.close()
  }
})

test('GET /dl/:token 只收下載代號 — 播放網址不能拿來下載', async () => {
  const { server, base, clipcafe } = await startApp()
  try {
    for (const bad of [playToken('piece-of-cake'), clipId('piece-of-cake'), TEST_TOKENS.seal('dl', 'piece-of-cake', { ttlMs: -1 })]) {
      assert.equal((await fetch(`${base}/dl/${bad}`)).status, 403)
    }
    assert.equal(clipcafe.calls.length, 0)
  } finally {
    server.close()
  }
})

test('GET /sub/:id/:lang.vtt 回字幕;代號或語言不對 → 404', async () => {
  const { server, base, clipcafe } = await startApp()
  try {
    const res = await fetch(`${base}/sub/${clipId('piece-of-cake')}/en.vtt`)
    assert.equal(res.status, 200)
    assert.ok(res.headers.get('content-type').startsWith('text/vtt'))
    assert.ok((await res.text()).startsWith('WEBVTT'))
    assert.deepEqual(clipcafe.calls, [{ kind: 'subs', slug: 'piece-of-cake', lang: 'en' }])

    assert.equal((await fetch(`${base}/sub/piece-of-cake/en.vtt`)).status, 404)
    assert.equal((await fetch(`${base}/sub/${clipId('piece-of-cake')}/EN.vtt`)).status, 404)
    assert.equal((await fetch(`${base}/sub/${playToken('piece-of-cake')}/en.vtt`)).status, 404)
    assert.equal(clipcafe.calls.length, 1)
  } finally {
    server.close()
  }
})

test('GET /sub 上游沒字幕 → 404 不快取', async () => {
  const clipcafe = fakeClipcafe({ subtitles: async () => ({ status: 404, text: null }) })
  const { server, base } = await startApp(clipcafe)
  try {
    const res = await fetch(`${base}/sub/${clipId('piece-of-cake')}/en.vtt`)
    assert.equal(res.status, 404)
    assert.equal(res.headers.get('cache-control'), 'no-store')
  } finally {
    server.close()
  }
})

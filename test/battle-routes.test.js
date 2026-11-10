const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createApp } = require('../src/app')
const { createAuth } = require('../src/auth')
const { createJwksCache } = require('../src/jwks')
const { createSongLibrary } = require('../src/songs')
const { createLedger } = require('../src/ledger')
const { createBattles } = require('../src/battle')
const { createPaygate } = require('../src/paygate')
const { createTestKeys, makeEs256Token, fakeJwksFetch, futureExp, TEST_TOKENS } = require('./helpers')

const APP_ID = 'app_test'
const KEYS = createTestKeys('kid-1')
const PRO_EMAIL = 'pro@example.com'

const bearer = (email, name) => ({
  Authorization: `Bearer ${makeEs256Token({ sub: `u-${email}`, email, name, app: APP_ID, exp: futureExp() }, KEYS)}`
})

const LINES = Array.from({ length: 4 }, (_, i) => ({ start: i * 4, end: i * 4 + 3, text: `Line number ${i + 1}.` }))

function startApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'te-battle-songs-'))
  for (const id of ['one', 'two', 'three']) {
    fs.writeFileSync(
      path.join(dir, `${id}.json`),
      JSON.stringify({ id, title: id, artist: 'Nobody', youtubeId: 'UprcpdwuwCg', lines: LINES })
    )
  }
  const { fetchImpl } = fakeJwksFetch([KEYS.jwk])
  const app = createApp({
    clipcafe: { search: async () => ({ total: 0, results: [] }) },
    auth: createAuth({ appId: APP_ID, secret: 's', jwks: createJwksCache({ url: 'https://jwks.test', fetchImpl }) }),
    tokens: TEST_TOKENS,
    paygate: createPaygate({
      baseUrl: 'http://paygate.test',
      token: 't',
      onError: () => {},
      fetchImpl: async (url) =>
        new Response(JSON.stringify({ active: new URL(url).searchParams.get('email') === PRO_EMAIL }), { status: 200 })
    }),
    songs: createSongLibrary({ dir, onError: () => {} }),
    ledger: createLedger({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'te-battle-ledger-')) }),
    battles: createBattles({}),
    songImporter: null
  })
  const server = app.listen(0)
  return { server, base: `http://127.0.0.1:${server.address().port}` }
}

const post = async (base, url, headers = {}, body = {}) => {
  const res = await fetch(base + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })
  const parsed = await res.json().catch(() => ({}))
  return { status: res.status, body: parsed, data: parsed.data }
}

const get = async (base, url, headers = {}) => {
  const res = await fetch(base + url, { headers })
  const parsed = await res.json().catch(() => ({}))
  return { status: res.status, body: parsed, data: parsed.data }
}

// 真的讀一次 SSE:等到符合條件的那一筆狀態,或者逾時
async function nextState(base, code, token, matches, timeoutMs = 4000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${base}/api/battle/${code}/stream?t=${encodeURIComponent(token)}`, { signal: controller.signal })
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') || '', /text[/]event-stream/)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return null
      buffer += decoder.decode(value, { stream: true })
      const chunks = buffer.split('\n\n')
      buffer = chunks.pop() || ''
      for (const chunk of chunks) {
        const line = chunk.split('\n').find((row) => row.startsWith('data: '))
        if (!line) continue
        const state = JSON.parse(line.slice(6))
        if (matches(state)) return state
      }
    }
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

test('沒登入不能開房', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  assert.equal((await post(base, '/api/battle', {}, { songId: 'one' })).status, 401)
})

test('開房:回房號與自己的 token,並且花掉那首歌的 1 點(整首也跟著解鎖)', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  const res = await post(base, '/api/battle', bearer('a@example.com', 'Amy'), { songId: 'one' })
  assert.equal(res.status, 200)
  assert.match(res.data.code, /^[A-Z0-9]{6}$/)
  assert.ok(res.data.playerToken)
  assert.equal(res.data.state.players.length, 1)
  // 對戰要打完整首,所以那一點同時把這首歌解鎖(不然免費會員打到第 15 句就卡住)
  const song = await get(base, '/api/songs/one', bearer('a@example.com', 'Amy'))
  assert.equal(song.data.unlocked, true)
  assert.equal(song.data.lines.length, 4)
  assert.deepEqual(song.data.credits, { used: 1, limit: 2 })
})

test('不存在的歌不能開房', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  assert.equal((await post(base, '/api/battle', bearer('a@example.com', 'Amy'), { songId: 'nope' })).status, 404)
})

test('點數用完就不能再開新的對戰', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  await post(base, '/api/battle', bearer('a@example.com', 'Amy'), { songId: 'one' })
  await post(base, '/api/battle', bearer('a@example.com', 'Amy'), { songId: 'two' })
  const third = await post(base, '/api/battle', bearer('a@example.com', 'Amy'), { songId: 'three' })
  assert.equal(third.status, 402)
  assert.equal(third.body.error, 'no_credits')
})

test('Pro 不扣點數', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  for (const songId of ['one', 'two', 'three']) {
    assert.equal((await post(base, '/api/battle', bearer(PRO_EMAIL, 'Pat'), { songId })).status, 200)
  }
})

test('加入、開始、搶分:誰先打完那句,全場一起被推到下一句', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  const amy = bearer('a@example.com', 'Amy')
  const ben = bearer('b@example.com', 'Ben')
  const made = await post(base, '/api/battle', amy, { songId: 'one' })
  const code = made.data.code

  const joined = await post(base, `/api/battle/${code}/join`, ben)
  assert.equal(joined.status, 200)
  assert.equal(joined.data.state.players.length, 2)

  // 只有房主能開始
  assert.equal((await post(base, `/api/battle/${code}/start`, ben)).status, 403)
  assert.equal((await post(base, `/api/battle/${code}/start`, amy)).status, 200)

  // Amy 掛在 SSE 上等;Ben 打完第 0 句 → Amy 要收到 line 變 1
  const waiting = nextState(base, code, made.data.playerToken, (state) => state.line === 1)
  await new Promise((resolve) => setTimeout(resolve, 150))
  const reported = await post(base, `/api/battle/${code}/cleared`, ben, { line: 0 })
  assert.equal(reported.status, 200)
  assert.equal(reported.data.point, true)

  const state = await waiting
  assert.equal(state.line, 1)
  assert.equal(state.players.find((p) => p.name === 'Ben').points, 1)
  assert.equal(state.players.find((p) => p.name === 'Amy').points, 0)
})

test('不在房裡的人不能回報', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  const made = await post(base, '/api/battle', bearer('a@example.com', 'Amy'), { songId: 'one' })
  const res = await post(base, `/api/battle/${made.data.code}/cleared`, bearer('x@example.com', 'Xan'), { line: 0 })
  assert.equal(res.status, 403)
})

test('輪詢也看得到狀態(SSE 被中間的 proxy 擋掉時的退路)', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  const made = await post(base, '/api/battle', bearer('a@example.com', 'Amy'), { songId: 'one' })
  const res = await get(base, `/api/battle/${made.data.code}`, bearer('a@example.com', 'Amy'))
  assert.equal(res.status, 200)
  assert.equal(res.data.state.code, made.data.code)
  assert.equal(res.data.me, made.data.playerId)
})

test('房號不存在:加入與訂閱都是 404', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  assert.equal((await post(base, '/api/battle/ZZZZZZ/join', bearer('a@example.com', 'Amy'))).status, 404)
  const res = await fetch(`${base}/api/battle/ZZZZZZ/stream?t=nope`)
  assert.equal(res.status, 404)
  await res.text()
})

test('狀態不帶 owner、不帶 email', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  const made = await post(base, '/api/battle', bearer('a@example.com', 'Amy'), { songId: 'one' })
  await post(base, `/api/battle/${made.data.code}/join`, bearer('b@example.com', 'Ben'))
  const res = await get(base, `/api/battle/${made.data.code}`, bearer('a@example.com', 'Amy'))
  const raw = JSON.stringify(res.body)
  assert.equal(raw.includes('example.com'), false)
  assert.equal(raw.includes('te-u-'), false)
})

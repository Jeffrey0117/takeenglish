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
const { createPaygate } = require('../src/paygate')
const { createTestKeys, makeEs256Token, fakeJwksFetch, futureExp, TEST_TOKENS } = require('./helpers')

const APP_ID = 'app_test'
const KEYS = createTestKeys('kid-1')
const PRO_EMAIL = 'pro@example.com'
const PLUS_EMAIL = 'plus@example.com'

const bearer = (email) => ({
  Authorization: `Bearer ${makeEs256Token({ sub: `u-${email}`, email, app: APP_ID, exp: futureExp() }, KEYS)}`
})

// 20 句:免費會員只看得到 15 句,解鎖後 20 句
const LINES = Array.from({ length: 20 }, (_, i) => ({ start: i * 4, end: i * 4 + 3, text: `Line number ${i + 1}.` }))
const song = (id) => ({ id, title: id, artist: 'Nobody', youtubeId: 'UprcpdwuwCg', level: '', lines: LINES })

function startApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'te-credit-songs-'))
  for (const id of ['one', 'two', 'three']) fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(song(id)))
  const ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'te-credit-ledger-'))
  const { fetchImpl } = fakeJwksFetch([KEYS.jwk])
  const app = createApp({
    clipcafe: { search: async () => ({ total: 0, results: [] }) },
    auth: createAuth({ appId: APP_ID, secret: 's', jwks: createJwksCache({ url: 'https://jwks.test', fetchImpl }) }),
    tokens: TEST_TOKENS,
    paygate: createPaygate({
      baseUrl: 'http://paygate.test',
      token: 't',
      plusPlanId: 'takeenglish:plus:monthly',
      onError: () => {},
      fetchImpl: async (url) => {
        const email = new URL(url).searchParams.get('email')
        if (email === PRO_EMAIL) return new Response(JSON.stringify({ active: true, plan_id: 'takeenglish:pro:monthly' }), { status: 200 })
        if (email === PLUS_EMAIL) return new Response(JSON.stringify({ active: true, plan_id: 'takeenglish:plus:monthly' }), { status: 200 })
        return new Response(JSON.stringify({ active: false }), { status: 200 })
      }
    }),
    songs: createSongLibrary({ dir, onError: () => {} }),
    ledger: createLedger({ dir: ledgerDir }),
    songImporter: null
  })
  const server = app.listen(0)
  return { server, base: `http://127.0.0.1:${server.address().port}` }
}

const post = async (base, url, headers = {}) => {
  const res = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' })
  const parsed = await res.json().catch(() => ({}))
  return { status: res.status, body: parsed, data: parsed.data }
}
const get = async (base, url, headers = {}) => {
  const res = await fetch(base + url, { headers })
  const parsed = await res.json().catch(() => ({}))
  return { status: res.status, body: parsed, data: parsed.data }
}

test('訪客不能用 credit', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  assert.equal((await post(base, '/api/songs/one/unlock')).status, 401)
})

test('免費會員花 1 點解鎖整首,剩下的點數回報給前端', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  const before = await get(base, '/api/songs/one', bearer('a@example.com'))
  assert.equal(before.data.lines.length, 15)
  assert.deepEqual(before.data.credits, { used: 0, limit: 2 })

  const res = await post(base, '/api/songs/one/unlock', bearer('a@example.com'))
  assert.equal(res.status, 200)
  assert.equal(res.data.lines.length, 20)
  assert.equal(res.data.lockedLines, 0)
  assert.equal(res.data.unlocked, true)
  assert.deepEqual(res.data.credits, { used: 1, limit: 2 })
})

test('解鎖過的歌重新整理還是整首(不會再扣一點)', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  await post(base, '/api/songs/one/unlock', bearer('a@example.com'))
  const again = await get(base, '/api/songs/one', bearer('a@example.com'))
  assert.equal(again.data.lines.length, 20)
  assert.equal(again.data.unlocked, true)
  assert.deepEqual(again.data.credits, { used: 1, limit: 2 })
  // 同一首再按一次解鎖也不該扣第二點
  const twice = await post(base, '/api/songs/one/unlock', bearer('a@example.com'))
  assert.deepEqual(twice.data.credits, { used: 1, limit: 2 })
})

test('一天兩點,第三首擋下來並說清楚', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  assert.equal((await post(base, '/api/songs/one/unlock', bearer('a@example.com'))).status, 200)
  assert.equal((await post(base, '/api/songs/two/unlock', bearer('a@example.com'))).status, 200)
  const third = await post(base, '/api/songs/three/unlock', bearer('a@example.com'))
  assert.equal(third.status, 402)
  assert.equal(third.body.error, 'no_credits')
  assert.equal(third.body.limit, 2)
  // 擋下來之後那首歌還是只給 15 句
  assert.equal((await get(base, '/api/songs/three', bearer('a@example.com'))).data.lines.length, 15)
})

test('別人的 credit 不會被我花掉', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  await post(base, '/api/songs/one/unlock', bearer('a@example.com'))
  await post(base, '/api/songs/two/unlock', bearer('a@example.com'))
  assert.equal((await post(base, '/api/songs/one/unlock', bearer('b@example.com'))).status, 200)
})

test('Pro 本來就整首:解鎖是空操作,不扣點數', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  const res = await post(base, '/api/songs/one/unlock', bearer(PRO_EMAIL))
  assert.equal(res.status, 200)
  assert.equal(res.data.lines.length, 20)
  assert.deepEqual(res.data.credits, { used: 0, limit: null })
})

test('PayGate 回 Pro Plus 的方案代號 → tier 是 pro_plus,一樣整首', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  const res = await get(base, '/api/songs/one', bearer(PLUS_EMAIL))
  assert.equal(res.data.tier, 'pro_plus')
  assert.equal(res.data.lines.length, 20)
  assert.equal(res.data.lockedLines, 0)
})

test('不存在的歌不給解鎖,也不扣點數', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  assert.equal((await post(base, '/api/songs/nope/unlock', bearer('a@example.com'))).status, 404)
  assert.deepEqual((await get(base, '/api/songs/one', bearer('a@example.com'))).data.credits, { used: 0, limit: 2 })
})

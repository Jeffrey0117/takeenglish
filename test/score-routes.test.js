const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createApp } = require('../src/app')
const { createAuth } = require('../src/auth')
const { createJwksCache } = require('../src/jwks')
const { createSongLibrary, createUserSongs } = require('../src/songs')
const { createScores } = require('../src/scores')
const { createPaygate } = require('../src/paygate')
const { createTestKeys, makeEs256Token, fakeJwksFetch, futureExp, TEST_TOKENS } = require('./helpers')

const APP_ID = 'app_test'
const KEYS = createTestKeys('kid-1')

const bearer = (email, name) => ({
  Authorization: `Bearer ${makeEs256Token({ sub: `u-${email}`, email, name, app: APP_ID, exp: futureExp() }, KEYS)}`
})

const LINES = Array.from({ length: 20 }, (_, i) => ({ start: i * 4, end: i * 4 + 3, text: `Line number ${i + 1}.` }))
const SONG = { id: 'demo', title: 'Demo Song', artist: 'Nobody', youtubeId: 'UprcpdwuwCg', level: '', lines: LINES }
const RUN = { songId: 'demo', wpm: 70, accuracy: 95, cleared: 10, total: 20, peeked: 1, seconds: 90 }

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function startApp() {
  const songDir = tmp('te-sb-songs-')
  fs.writeFileSync(path.join(songDir, 'demo.json'), JSON.stringify(SONG))
  const mineDir = tmp('te-sb-mine-')
  const scoreDir = tmp('te-sb-scores-')
  const { fetchImpl } = fakeJwksFetch([KEYS.jwk])
  const app = createApp({
    clipcafe: { search: async () => ({ total: 0, results: [] }) },
    auth: createAuth({ appId: APP_ID, secret: 's', jwks: createJwksCache({ url: 'https://jwks.test', fetchImpl }) }),
    tokens: TEST_TOKENS,
    paygate: createPaygate({ baseUrl: 'http://paygate.test', token: 't', onError: () => {}, fetchImpl: async () => new Response(JSON.stringify({ active: false }), { status: 200 }) }),
    songs: createSongLibrary({ dir: songDir, onError: () => {} }),
    mySongs: createUserSongs({ dir: mineDir }),
    scores: createScores({ dir: scoreDir }),
    songImporter: null
  })
  const server = app.listen(0)
  return { server, base: `http://127.0.0.1:${server.address().port}`, mineDir, scoreDir }
}

const post = async (base, url, headers, body) => {
  const res = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const parsed = await res.json().catch(() => ({}))
  return { status: res.status, body: parsed, data: parsed.data }
}
const get = async (base, url, headers = {}) => {
  const res = await fetch(base + url, { headers })
  const parsed = await res.json().catch(() => ({}))
  return { status: res.status, body: parsed, data: parsed.data }
}

test('沒登入不能上傳成績', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  assert.equal((await post(base, '/api/type/scores', {}, RUN)).status, 401)
})

test('上傳成績:回自己的名次與排行榜', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  const res = await post(base, '/api/type/scores', bearer('a@example.com', 'Amy'), RUN)
  assert.equal(res.status, 200)
  assert.equal(res.data.recorded, true)
  assert.equal(res.data.rank, 1)
  assert.equal(res.data.run.points, Math.round(70 * 0.95 * 10))
  assert.equal(res.data.board[0].name, 'Amy')
})

test('歌名用伺服器自己的,不吃前端送的(排行榜不給人塞字)', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  const res = await post(base, '/api/type/scores', bearer('a@example.com', 'Amy'), { ...RUN, title: '<script>x</script>', artist: '假的' })
  assert.equal(res.data.run.title, 'Demo Song')
  assert.equal(res.data.run.artist, 'Nobody')
})

test('不存在的歌不收', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  assert.equal((await post(base, '/api/type/scores', bearer('a@example.com', 'Amy'), { ...RUN, songId: 'nope' })).status, 404)
})

test('數字不合理:回 200 但沒記下來(前端不用為此跳錯誤)', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  const res = await post(base, '/api/type/scores', bearer('a@example.com', 'Amy'), { ...RUN, wpm: 9999 })
  assert.equal(res.status, 200)
  assert.equal(res.data.recorded, false)
  assert.equal((await get(base, '/api/type/board?songId=demo')).data.items.length, 0)
})

test('我的成績只有我看得到,而且看得到每首最佳', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  await post(base, '/api/type/scores', bearer('a@example.com', 'Amy'), RUN)
  await post(base, '/api/type/scores', bearer('b@example.com', 'Ben'), { ...RUN, wpm: 50 })
  const mine = await get(base, '/api/type/scores', bearer('a@example.com', 'Amy'))
  assert.equal(mine.data.items.length, 1)
  assert.equal(mine.data.items[0].wpm, 70)
  assert.equal(mine.data.bests.demo.wpm, 70)
  assert.equal((await get(base, '/api/type/scores', {})).status, 401)
})

test('排行榜公開可讀,但不含 email、不含使用者代號', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  await post(base, '/api/type/scores', bearer('a@example.com', 'Amy'), RUN)
  const board = await get(base, '/api/type/board?songId=demo')
  assert.equal(board.status, 200)
  assert.equal(board.data.items[0].name, 'Amy')
  const raw = JSON.stringify(board.body)
  assert.equal(raw.includes('example.com'), false)
  assert.equal(raw.includes('u-a@'), false)
})

test('免費會員只拿到 15 句,就不能報 20 句的成績(句數照伺服器實際送出的夾擠)', async (t) => {
  const { server, base } = startApp()
  t.after(() => server.close())
  // 這首 20 句,免費會員只看得到 15 句 → cleared 不管報多少都當 15
  const res = await post(base, '/api/type/scores', bearer('a@example.com', 'Amy'), { ...RUN, cleared: 20, seconds: 120 })
  assert.equal(res.data.recorded, true)
  assert.equal(res.data.run.cleared, 15)
  assert.equal(res.data.run.points, Math.round(70 * 0.95 * 15))
})

test('自己貼的歌:進個人歷史,不進公開排行榜', async (t) => {
  const { server, base, mineDir } = startApp()
  t.after(() => server.close())
  const dir = path.join(mineDir, `te-${'u-a@example.com'.replace(/[^A-Za-z0-9_-]/g, '')}`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'mine.json'), JSON.stringify({ ...SONG, id: 'mine', title: 'My Song' }))
  const res = await post(base, '/api/type/scores', bearer('a@example.com', 'Amy'), { ...RUN, songId: 'mine', own: true })
  assert.equal(res.data.recorded, true)
  assert.equal(res.data.rank, null)
  assert.deepEqual(res.data.board, [])
  // 公開排行榜只認公開歌庫:私人歌曲在這個端點根本不存在
  assert.equal((await get(base, '/api/type/board?songId=mine')).status, 404)
  assert.equal((await get(base, '/api/type/scores', bearer('a@example.com', 'Amy'))).data.items[0].title, 'My Song')
})

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createApp } = require('../src/app')
const { createAuth } = require('../src/auth')
const { createJwksCache } = require('../src/jwks')
const { createSongLibrary } = require('../src/songs')
const { createPaygate } = require('../src/paygate')
const { createTestKeys, makeEs256Token, fakeJwksFetch, futureExp, TEST_TOKENS } = require('./helpers')

const APP_ID = 'app_test'
const KEYS = createTestKeys('kid-1')
const PRO_EMAIL = 'pro@example.com'

const bearer = (email) => ({
  Authorization: `Bearer ${makeEs256Token({ sub: `u-${email}`, email, app: APP_ID, exp: futureExp() }, KEYS)}`
})

// 20 句:訪客 0 句、免費會員 15 句、Pro 全部
const LINES = Array.from({ length: 20 }, (_, i) => ({
  start: i * 4,
  end: i * 4 + 3,
  text: `Line number ${i + 1}.`,
  zh: `第 ${i + 1} 句。`
}))

function withSongs(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'te-songs-'))
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body))
  }
  return dir
}

// 假的 PayGate:只有 PRO_EMAIL 是付費會員,其他登入的都是免費會員
function fakePaygate() {
  return createPaygate({
    baseUrl: 'http://paygate.test',
    token: 'paygate-token',
    onError: () => {},
    fetchImpl: async (url) => {
      const u = new URL(url)
      if (u.pathname !== '/api/subscription/check') return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
      const active = u.searchParams.get('email') === PRO_EMAIL
      return new Response(JSON.stringify(active ? { active: true, tier: 'pro' } : { active: false }), { status: 200 })
    }
  })
}

function startApp(dir) {
  const { fetchImpl } = fakeJwksFetch([KEYS.jwk])
  const app = createApp({
    clipcafe: { search: async () => ({ total: 0, results: [] }) },
    auth: createAuth({ appId: APP_ID, secret: 's', jwks: createJwksCache({ url: 'https://jwks.test', fetchImpl }) }),
    tokens: TEST_TOKENS,
    paygate: fakePaygate(),
    songs: createSongLibrary({ dir, onError: () => {} })
  })
  const server = app.listen(0)
  const base = `http://127.0.0.1:${server.address().port}`
  return { server, base }
}

async function get(base, path, headers = {}) {
  const res = await fetch(base + path, { headers })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body, data: body.data }
}

const SONG = { id: 'demo', title: 'Demo Song', artist: 'Nobody', youtubeId: 'UprcpdwuwCg', level: '中級', lines: LINES }

test('歌庫只收格式對的檔案', () => {
  const dir = withSongs({
    'good.json': SONG,
    'no-video.json': { title: 'x', lines: LINES },
    'bad-video.json': { title: 'x', youtubeId: 'https://evil.example/x', lines: LINES },
    'no-lines.json': { title: 'x', youtubeId: 'UprcpdwuwCg', lines: [] },
    'broken.json': '{ not json',
    'BAD ID.json': SONG,
    'notes.txt': 'ignored'
  })
  const songs = createSongLibrary({ dir, onError: () => {} })
  assert.deepEqual(
    songs.list().map((s) => s.id),
    ['good']
  )
  assert.equal(songs.get('no-video'), null)
  assert.equal(songs.get('../../etc/passwd'), null)
})

test('歌詞照開始時間排序,時間壞掉的句子丟掉', () => {
  const dir = withSongs({
    'mixed.json': {
      youtubeId: 'UprcpdwuwCg',
      title: 'Mixed',
      lines: [
        { start: 9, end: 12, text: 'second' },
        { start: 1, end: 4, text: 'first' },
        { start: 20, end: 15, text: 'backwards' },
        { start: 30, end: 33, text: '   ' },
        { start: 'x', end: 2, text: 'not a number' }
      ]
    }
  })
  const song = createSongLibrary({ dir, onError: () => {} }).get('mixed')
  assert.deepEqual(
    song.lines.map((line) => line.text),
    ['first', 'second']
  )
})

test('歌單人人看得到,封面是 YouTube 縮圖', async () => {
  const { server, base } = startApp(withSongs({ 'demo.json': SONG }))
  try {
    const { status, data } = await get(base, '/api/songs')
    assert.equal(status, 200)
    assert.equal(data.items.length, 1)
    assert.equal(data.items[0].lines, 20)
    assert.equal(data.items[0].duration, 79)
    assert.equal(data.items[0].thumb, 'https://i.ytimg.com/vi/UprcpdwuwCg/hqdefault.jpg')
  } finally {
    server.close()
  }
})

test('訪客:一句歌詞都拿不到,但看得到這首歌是什麼', async () => {
  const { server, base } = startApp(withSongs({ 'demo.json': SONG }))
  try {
    const { data } = await get(base, '/api/songs/demo')
    assert.equal(data.typing, false)
    assert.equal(data.signedIn, false)
    assert.deepEqual(data.lines, [])
    assert.equal(data.totalLines, 20)
    assert.equal(data.lockedLines, 20)
    assert.equal(data.lockedFrom, 0)
    assert.equal(data.youtubeId, 'UprcpdwuwCg')
  } finally {
    server.close()
  }
})

test('免費會員:前 15 句,第 16 句之後連內容都不送出去', async () => {
  const { server, base } = startApp(withSongs({ 'demo.json': SONG }))
  try {
    const { data } = await get(base, '/api/songs/demo', bearer('free@example.com'))
    assert.equal(data.tier, 'free')
    assert.equal(data.typing, true)
    assert.equal(data.lines.length, 15)
    assert.equal(data.lockedLines, 5)
    assert.equal(data.lockedFrom, LINES[15].start)
    assert.equal(JSON.stringify(data).includes('Line number 16'), false)
  } finally {
    server.close()
  }
})

// 歌詞常常一句的結束就是下一句的開始。牆要擺在「最後一句開放的句子唱完」,
// 不是「第一句鎖住的句子開始」— 不然播放器會在他還在打那句的時候就被攔下來
test('兩句首尾相接時,牆擺在最後一句開放的句子唱完之後', async () => {
  const backToBack = Array.from({ length: 20 }, (_, i) => ({ start: i * 4, end: (i + 1) * 4, text: `Line ${i + 1}.` }))
  const { server, base } = startApp(withSongs({ 'tight.json': { ...SONG, lines: backToBack } }))
  try {
    const { data } = await get(base, '/api/songs/tight', bearer('free@example.com'))
    assert.equal(data.lines.length, 15)
    assert.equal(backToBack[15].start, backToBack[14].end) // 前提:真的是首尾相接
    assert.equal(data.lockedFrom, backToBack[14].end)
    assert.ok(data.lockedFrom >= data.lines[14].end)
  } finally {
    server.close()
  }
})

test('Pro:整首歌都給,沒有牆', async () => {
  const { server, base } = startApp(withSongs({ 'demo.json': SONG }))
  try {
    const { data } = await get(base, '/api/songs/demo', bearer(PRO_EMAIL))
    assert.equal(data.tier, 'pro')
    assert.equal(data.lines.length, 20)
    assert.equal(data.lockedLines, 0)
    assert.equal(data.lockedFrom, null)
    assert.equal(data.lines[19].zh, '第 20 句。')
  } finally {
    server.close()
  }
})

test('歌詞是凍住的:present() 改不到歌庫裡的原件,不會污染後面的請求', () => {
  const songs = createSongLibrary({ dir: withSongs({ 'demo.json': SONG }), onError: () => {} })
  const line = songs.get('demo').lines[0]
  assert.throws(() => {
    'use strict'
    line.zh = 'tampered'
  }, TypeError)
  assert.equal(songs.get('demo').lines[0].zh, '第 1 句。')
})

test('偽造的 token 當訪客,不會因為帶了 Bearer 就放行', async () => {
  const { server, base } = startApp(withSongs({ 'demo.json': SONG }))
  try {
    const { data } = await get(base, '/api/songs/demo', { Authorization: 'Bearer not.a.token' })
    assert.equal(data.typing, false)
    assert.deepEqual(data.lines, [])
  } finally {
    server.close()
  }
})

test('沒有這首歌 / 代號亂寫:404,不回任何東西', async () => {
  const { server, base } = startApp(withSongs({ 'demo.json': SONG }))
  try {
    assert.equal((await get(base, '/api/songs/nope')).status, 404)
    assert.equal((await get(base, '/api/songs/..%2F..%2Fpackage.json')).status, 404)
  } finally {
    server.close()
  }
})

test('/type 送得出頁面', async () => {
  const { server, base } = startApp(withSongs({ 'demo.json': SONG }))
  try {
    const res = await fetch(`${base}/type`)
    assert.equal(res.status, 200)
    assert.match(await res.text(), /type\.js/)
  } finally {
    server.close()
  }
})

test('沒有歌的時候 /api/config 會說 songs: false', async () => {
  const { server, base } = startApp(withSongs({}))
  try {
    const { data } = await get(base, '/api/config')
    assert.equal(data.songs, false)
    assert.equal((await get(base, '/api/songs')).data.items.length, 0)
  } finally {
    server.close()
  }
})

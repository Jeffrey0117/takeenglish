const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createApp } = require('../src/app')
const { createAuth } = require('../src/auth')
const { createJwksCache } = require('../src/jwks')
const { createLessonSource } = require('../src/lessons')
const { createPaygate } = require('../src/paygate')
const { createTestKeys, makeEs256Token, fakeJwksFetch, futureExp, TEST_TOKENS } = require('./helpers')

const APP_ID = 'app_test'
const KEYS = createTestKeys('kid-1')
const MINE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const bearer = (email, sub) => ({
  Authorization: `Bearer ${makeEs256Token({ sub, email, app: APP_ID, exp: futureExp() }, KEYS)}`
})
const PRO = bearer('pro@example.com', 'usr_pro')
const FREE = bearer('free@example.com', 'usr_free')

// 假的引擎:記下每個請求,會員自己的影片只回給本人
function fakeEngine() {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url)
    const auth = (init.headers || {}).Authorization
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ method: init.method || 'GET', path: u.pathname, owner: u.searchParams.get('owner') || (body && body.owner), auth, body })
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status })
    if (u.pathname.startsWith('/api/internal/') && auth !== 'Bearer internal-key') return json({ detail: 'no' }, 401)
    if (u.pathname === '/api/internal/videos' && init.method === 'POST') {
      if (!/youtube/.test(body.url)) return json({ detail: 'unsupported_url' }, 400)
      if (body.url.includes('limit')) return json({ detail: 'monthly_limit' }, 429)
      return json({ success: true, video: { id: MINE, status: 'downloading' }, duplicate: false })
    }
    if (u.pathname === '/api/internal/videos') {
      return json({ videos: u.searchParams.get('owner') === 'te:usr_pro' ? [{ id: MINE, title: 'My clip', status: 'transcribing', thumbnail: 'mine.jpg' }] : [] })
    }
    if (u.pathname === `/api/internal/videos/${MINE}`) {
      if (u.searchParams.get('owner') !== 'te:usr_pro') return json({ detail: 'Video not found' }, 404)
      // 沒翻譯的逐段字幕(不用 AI):站台要併回完整句子
      return json({
        id: MINE, title: 'My clip', status: 'ready', filename: 'mine.mp4', thumbnail: 'mine.jpg',
        segments: [
          { start: 0, end: 1, en: 'I think we should', zh: '', vocabulary: [] },
          { start: 1.1, end: 2, en: 'go now.', zh: '', vocabulary: [] },
          ...Array.from({ length: 12 }, (_, i) => ({ start: 3 + i, end: 3.8 + i, en: `Line ${i + 1}.`, zh: '', vocabulary: [] }))
        ]
      })
    }
    if (u.pathname === '/videos/mine.mp4') return new Response('mine-bytes', { status: 200, headers: { 'content-type': 'video/mp4' } })
    return json({ detail: 'Not Found' }, 404)
  }
  return { calls, fetchImpl }
}

function startApp({ internalKey = 'internal-key' } = {}) {
  const engine = fakeEngine()
  const { fetchImpl } = fakeJwksFetch([KEYS.jwk])
  const app = createApp({
    clipcafe: { search: async () => ({ total: 0, results: [] }) },
    auth: createAuth({ appId: APP_ID, secret: 's', jwks: createJwksCache({ url: 'http://jwks.test', fetchImpl }) }),
    tokens: TEST_TOKENS,
    lessons: createLessonSource({ baseUrl: 'http://engine.test', internalKey, fetchImpl: engine.fetchImpl }),
    paygate: createPaygate({
      baseUrl: 'http://paygate.test',
      token: 't',
      onError: () => {},
      fetchImpl: async (url) => {
        const email = new URL(url).searchParams.get('email')
        return new Response(JSON.stringify(email === 'pro@example.com' ? { active: true, end_date: '2099-01-01' } : { active: false }), { status: 200 })
      }
    }),
    letmeuse: {}
  })
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, engine, base: `http://127.0.0.1:${server.address().port}` }))
  })
}

const post = (url, headers, body) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

test('貼連結加影片:訪客 401、免費會員 402(撞牆,不會打到引擎)、Pro 可以加', async () => {
  const { server, base, engine } = await startApp()
  try {
    const url = 'https://www.youtube.com/watch?v=abc'
    assert.equal((await post(`${base}/api/my-lessons`, {}, { url })).status, 401)
    const free = await post(`${base}/api/my-lessons`, FREE, { url })
    assert.equal(free.status, 402)
    assert.equal(engine.calls.filter((c) => c.method === 'POST').length, 0)

    const pro = await post(`${base}/api/my-lessons`, PRO, { url })
    assert.equal(pro.status, 200)
    assert.deepEqual((await pro.json()).data, { id: MINE, status: 'downloading', duplicate: false })
    const call = engine.calls.find((c) => c.method === 'POST')
    assert.deepEqual(call.body, { url, owner: 'te:usr_pro' })
    assert.equal(call.auth, 'Bearer internal-key')
  } finally {
    server.close()
  }
})

test('貼連結:不是 https、不支援的網址 400;引擎說本月上限 429', async () => {
  const { server, base } = await startApp()
  try {
    assert.equal((await post(`${base}/api/my-lessons`, PRO, { url: 'javascript:alert(1)' })).status, 400)
    assert.equal((await post(`${base}/api/my-lessons`, PRO, { url: 'https://vimeo.com/1' })).status, 400)
    const limit = await post(`${base}/api/my-lessons`, PRO, { url: 'https://youtube.com/limit' })
    assert.equal(limit.status, 429)
    assert.equal((await limit.json()).error, 'monthly_limit')
  } finally {
    server.close()
  }
})

test('我的影片清單:只看得到自己的,帶處理進度;縮圖走本站網址', async () => {
  const { server, base } = await startApp()
  try {
    assert.equal((await fetch(`${base}/api/my-lessons`)).status, 401)
    const pro = (await (await fetch(`${base}/api/my-lessons`, { headers: PRO })).json()).data
    assert.equal(pro.canAdd, true)
    assert.deepEqual(pro.items, [
      { id: MINE, title: 'My clip', channel: '', duration: null, status: 'transcribing', error: '', thumb: `/lesson-media/${MINE}/thumb.jpg` }
    ])
    const free = (await (await fetch(`${base}/api/my-lessons`, { headers: FREE })).json()).data
    assert.deepEqual(free, { canAdd: false, items: [] })
  } finally {
    server.close()
  }
})

test('自己的影片:逐字稿不鎖、沒翻譯的字幕併回完整句子;別人拿不到;影片可以播', async () => {
  const { server, base } = await startApp()
  try {
    const mine = (await (await fetch(`${base}/api/my-lessons/${MINE}`, { headers: PRO })).json()).data
    assert.equal(mine.own, true)
    assert.equal(mine.lockedLines, 0)
    assert.equal(mine.lockedFrom, null)
    assert.equal(mine.segments.length, 13)
    assert.deepEqual(mine.segments[0], { start: 0, end: 2, text: 'I think we should go now.', zh: '', vocab: [] })
    assert.equal(mine.video, `/lesson-media/${MINE}/video`)
    assert.ok(!JSON.stringify(mine).includes('mine.mp4'))

    assert.equal((await fetch(`${base}/api/my-lessons/${MINE}`, { headers: FREE })).status, 404)
    assert.equal((await fetch(`${base}/api/my-lessons/${MINE}`)).status, 401)
    const video = await fetch(`${base}/lesson-media/${MINE}/video`)
    assert.equal(video.status, 200)
    assert.equal(await video.text(), 'mine-bytes')
  } finally {
    server.close()
  }
})

test('沒設內部金鑰時,我的影片整區 503,公開影片照常', async () => {
  const { server, base } = await startApp({ internalKey: '' })
  try {
    assert.equal((await fetch(`${base}/api/my-lessons`, { headers: PRO })).status, 503)
    assert.equal((await post(`${base}/api/my-lessons`, PRO, { url: 'https://www.youtube.com/watch?v=abc' })).status, 503)
  } finally {
    server.close()
  }
})

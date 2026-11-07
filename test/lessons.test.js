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
const ID = '083b6ea5-3c98-45fc-b72b-7027cf1a9b0f'
const bearer = (email = 'free@example.com') => ({
  Authorization: `Bearer ${makeEs256Token({ sub: `u-${email}`, email, app: APP_ID, exp: futureExp() }, KEYS)}`
})
// 12 句:訪客看 5 句、免費會員看 10 句、Pro 全部
const EXTRA = Array.from({ length: 10 }, (_, i) => ({ start: 20 + i * 3, end: 22 + i * 3, en: `Extra line ${i + 1}.`, zh: `第 ${i + 1} 句。`, vocabulary: [] }))

// 假的影片引擎:列表、單支影片、影片檔、縮圖
function fakeEngine({ down = false } = {}) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url)
    calls.push({ path: u.pathname + u.search, range: (init.headers || {}).Range })
    if (down) throw new Error('ECONNREFUSED')
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status })
    if (u.pathname === '/api/public/videos') {
      return json({
        videos: [
          { id: ID, title: '大象的鼻子', channel: 'jawed', source: 'youtube', duration: 19, thumbnail: 'a.jpg', hasTranscript: true },
          { id: 'not-a-uuid', title: 'bad', hasTranscript: true },
          { id: '11111111-2222-3333-4444-555555555555', title: '沒字幕', hasTranscript: false }
        ]
      })
    }
    if (u.pathname === `/api/public/videos/${ID}/lesson`) {
      return json({
        id: ID,
        title: '大象的鼻子',
        channel: 'jawed',
        theme: '大象',
        duration: 19,
        filename: 'jNQXAC9IVRw.mp4',
        thumbnail: 'a.jpg',
        segments: [
          { start: 0.9, end: 3.4, en: 'Here we are, one of the elephants.', zh: '這裡有一隻大象。', vocabulary: [{ word: 'elephants', translation: '大象' }] },
          { start: 4.8, end: 13.7, en: 'They have really long fronts.', zh: '牠們的前面很長。', vocabulary: [] },
          ...EXTRA
        ],
        keyPoints: ['大象鼻子很長'],
        goldenQuotes: [{ en: 'That is pretty much it.', zh: '就是這樣。' }]
      })
    }
    if (u.pathname === '/videos/jNQXAC9IVRw.mp4') {
      return init.headers && init.headers.Range
        ? new Response('mp4-', { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-3/9', 'content-length': '4' } })
        : new Response('mp4-bytes', { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': '9' } })
    }
    if (u.pathname === '/thumbnails/a.jpg') return new Response('jpeg', { status: 200, headers: { 'content-type': 'image/jpeg' } })
    return json({ detail: 'Not Found' }, 404)
  }
  return { calls, fetchImpl }
}

function startApp(engine = fakeEngine()) {
  const { fetchImpl } = fakeJwksFetch([KEYS.jwk])
  const app = createApp({
    clipcafe: { search: async () => ({ total: 0, results: [] }) },
    auth: createAuth({ appId: APP_ID, secret: 's', jwks: createJwksCache({ url: 'http://jwks.test', fetchImpl }) }),
    tokens: TEST_TOKENS,
    lessons: createLessonSource({ baseUrl: 'http://engine.test', fetchImpl: engine.fetchImpl }),
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

test('lessons: 列表只放有字幕、代號合法的影片,縮圖走本站網址,不外露引擎的檔名', async () => {
  const { server, base } = await startApp()
  try {
    const body = await (await fetch(`${base}/api/lessons`)).json()
    assert.equal(body.data.total, 1)
    assert.deepEqual(body.data.items[0], {
      id: ID, title: '大象的鼻子', channel: 'jawed', source: 'youtube', category: '', duration: 19, thumb: `/lesson-media/${ID}/thumb.jpg`
    })
    assert.ok(!JSON.stringify(body).includes('a.jpg'))
  } finally {
    server.close()
  }
})

test('lessons: 訪客也看得到中文與重點片語;引擎的檔名不外露', async () => {
  const { server, base } = await startApp()
  try {
    const guest = (await (await fetch(`${base}/api/lessons/${ID}`)).json()).data
    assert.equal(guest.notes, true)
    assert.equal(guest.video, `/lesson-media/${ID}/video`)
    assert.deepEqual(guest.segments[0], {
      start: 0.9, end: 3.4, text: 'Here we are, one of the elephants.', zh: '這裡有一隻大象。', vocab: [{ word: 'elephants', zh: '大象' }]
    })
    assert.ok(!JSON.stringify(guest).includes('jNQXAC9IVRw'), 'engine file name must not leak')
  } finally {
    server.close()
  }
})

test('lessons: 影片轉送支援 Range;縮圖可快取;不存在或代號不對 404;HEAD 405', async () => {
  const { server, base, engine } = await startApp()
  try {
    const part = await fetch(`${base}/lesson-media/${ID}/video`, { headers: { Range: 'bytes=0-3' } })
    assert.equal(part.status, 206)
    assert.equal(part.headers.get('content-range'), 'bytes 0-3/9')
    assert.equal(part.headers.get('content-type'), 'video/mp4')
    assert.equal(await part.text(), 'mp4-')
    assert.equal(engine.calls.find((c) => c.path.startsWith('/videos/')).range, 'bytes=0-3')
    const thumb = await fetch(`${base}/lesson-media/${ID}/thumb.jpg`)
    assert.equal(thumb.status, 200)
    assert.equal(thumb.headers.get('cache-control'), 'public, max-age=86400')
    assert.equal((await fetch(`${base}/lesson-media/11111111-2222-3333-4444-555555555555/video`)).status, 404)
    assert.equal((await fetch(`${base}/lesson-media/..%2F..%2Fetc/video`)).status, 404)
    assert.equal((await fetch(`${base}/api/lessons/not-a-uuid`)).status, 404)
    assert.equal((await fetch(`${base}/lesson-media/${ID}/video`, { method: 'HEAD' })).status, 405)
  } finally {
    server.close()
  }
})

test('lessons: 引擎掛掉時回 502,沒設定引擎時 503;頁面本身照常', async () => {
  const down = await startApp(fakeEngine({ down: true }))
  try {
    assert.equal((await fetch(`${down.base}/api/lessons`)).status, 502)
    assert.equal((await fetch(`${down.base}/api/lessons/${ID}`)).status, 502)
    assert.equal((await fetch(`${down.base}/lessons`)).status, 200)
  } finally {
    down.server.close()
  }
  const { fetchImpl } = fakeJwksFetch([KEYS.jwk])
  const app = createApp({
    clipcafe: { search: async () => ({ total: 0, results: [] }) },
    auth: createAuth({ appId: APP_ID, secret: 's', jwks: createJwksCache({ url: 'http://jwks.test', fetchImpl }) }),
    tokens: TEST_TOKENS,
    letmeuse: {}
  })
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)) })
  try {
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/lessons`)).status, 503)
  } finally {
    server.close()
  }
})

test('lessons: 列表與單支影片都有快取,不會每個請求都打引擎', async () => {
  const { server, base, engine } = await startApp()
  try {
    await fetch(`${base}/api/lessons`)
    await fetch(`${base}/api/lessons?page=0`)
    await fetch(`${base}/api/lessons/${ID}`)
    await fetch(`${base}/api/lessons/${ID}`)
    assert.equal(engine.calls.filter((c) => c.path.startsWith('/api/public/videos?')).length, 1)
    assert.equal(engine.calls.filter((c) => c.path.endsWith('/lesson')).length, 1)
  } finally {
    server.close()
  }
})

test('lessons: 逐字稿只露一部分 — 訪客 5 句、免費會員 10 句、Pro 全部;鎖住的句子不送出去', async () => {
  const { server, base } = await startApp()
  try {
    const guest = (await (await fetch(`${base}/api/lessons/${ID}`)).json()).data
    assert.equal(guest.segments.length, 5)
    assert.equal(guest.totalLines, 12)
    assert.equal(guest.lockedLines, 7)
    assert.equal(guest.signedIn, false)
    // 第 6 句(第一句被鎖住的)開始的秒數,影片播到這裡就撞牆
    assert.equal(guest.lockedFrom, EXTRA[3].start)
    assert.ok(!JSON.stringify(guest).includes('Extra line 4.'), 'locked lines must not be sent')

    const free = (await (await fetch(`${base}/api/lessons/${ID}`, { headers: bearer() })).json()).data
    assert.equal(free.segments.length, 10)
    assert.equal(free.lockedLines, 2)
    assert.equal(free.modes, false)
    assert.equal(free.lockedFrom, EXTRA[8].start)
    // 非 Pro 的重點整理是預覽:只給第一個,其餘只說還有幾個
    assert.deepEqual(free.summary, {
      keyPoints: ['大象鼻子很長'],
      quotes: [{ en: 'That is pretty much it.', zh: '就是這樣。' }],
      preview: true,
      lockedPoints: 0,
      lockedQuotes: 0
    })

    const pro = (await (await fetch(`${base}/api/lessons/${ID}`, { headers: bearer('pro@example.com') })).json()).data
    assert.equal(pro.tier, 'pro')
    assert.equal(pro.segments.length, 12)
    assert.equal(pro.lockedLines, 0)
    assert.equal(pro.modes, true)
    assert.equal(pro.lockedFrom, null)
    assert.equal(pro.summary.preview, false)
  } finally {
    server.close()
  }
})

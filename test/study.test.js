const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createApp } = require('../src/app')
const { createAuth } = require('../src/auth')
const { createJwksCache } = require('../src/jwks')
const { createAnnotator } = require('../src/annotator')
const { createPaygate } = require('../src/paygate')
const { createPlans } = require('../src/plans')
const { createTranscriptLibrary } = require('../src/transcripts')
const { createDailyUsage } = require('../src/study-routes')
const { parseCues, groupCues, splitSentences } = require('../src/vtt')
const { createTestKeys, makeEs256Token, fakeJwksFetch, futureExp, TEST_TOKENS, clipId } = require('./helpers')

const APP_ID = 'app_test'
const KEYS = createTestKeys('kid-1')
const VTT = 'WEBVTT\n\n00:00:01.500 --> 00:00:03.402\n<i>Break a leg</i>\nout there!\n\n00:00:03.468 --> 00:00:05.237\nIt is a piece of cake.\n'
const bearer = (email) => ({
  Authorization: `Bearer ${makeEs256Token({ sub: `user-${email}`, email, app: APP_ID, exp: futureExp() }, KEYS)}`
})

// ---- 字幕解析 ----

test('vtt: WebVTT 與 SRT 都解得出時間與文字,標籤拿掉、多行併成一行', () => {
  assert.deepEqual(parseCues(VTT), [
    { start: 1.5, end: 3.402, text: 'Break a leg out there!' },
    { start: 3.468, end: 5.237, text: 'It is a piece of cake.' }
  ])
  const srt = '1\r\n00:01:02,500 --> 00:01:04,000\r\nHello there.\r\n\r\n2\r\n01:00:00,000 --> 01:00:01,250\r\n{\\an8}Second line\r\n\r\n3\r\nnot a cue\r\n'
  assert.deepEqual(parseCues(srt), [
    { start: 62.5, end: 64, text: 'Hello there.' },
    { start: 3600, end: 3601.25, text: 'Second line' }
  ])
  assert.deepEqual(parseCues('WEBVTT\n\n'), [])
  assert.deepEqual(parseCues(null), [])
})

test('vtt: 劇情介紹切成句子', () => {
  assert.deepEqual(splitSentences('Jake is in prison. "Is he okay?" Rosa asks! No ending'), [
    'Jake is in prison.',
    '"Is he okay?"',
    'Rosa asks!',
    'No ending'
  ])
  assert.deepEqual(splitSentences(''), [])
})

// ---- 標註引擎的客戶端 ----

// 假的標註引擎。engine.respond 可以在測試中途換掉;它回 null/undefined 就用預設的正常回應
function fakeEngine(respond) {
  const calls = []
  const engine = { calls, respond }
  engine.fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url: String(url), auth: init.headers.Authorization, sentences: body.sentences })
    const custom = engine.respond ? await engine.respond(body) : null
    return custom || new Response(JSON.stringify({
      success: true,
      items: body.sentences.map((sentence) => ({
        translation: `譯:${sentence}`,
        vocabulary: [
          { word: 'break a leg', translation: '祝好運' },
          { word: 'piece of cake', translation: '小事一樁' },
          { word: 'not in the sentence', translation: '不該出現' },
          { word: 'Break a Leg', translation: '重複的' }
        ]
      }))
    }), { status: 200 })
  }
  return engine
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

test('annotator: 回每句的中文與片語;只留原句裡真的有的片語,重複的去掉', async () => {
  const engine = fakeEngine()
  const annotator = createAnnotator({ url: 'http://engine.test/annotate', apiKey: 'k', cacheDir: tempDir('ann-'), fetchImpl: engine.fetchImpl })
  const items = await annotator.annotate('clip:x', ['Break a leg out there!', 'It is a piece of cake.'])
  assert.deepEqual(items, [
    { zh: '譯:Break a leg out there!', vocab: [{ word: 'break a leg', zh: '祝好運' }] },
    { zh: '譯:It is a piece of cake.', vocab: [{ word: 'piece of cake', zh: '小事一樁' }] }
  ])
  assert.equal(engine.calls[0].auth, 'Bearer k')
})

test('annotator: 算過的存檔,同一段不再花錢;原句變了才重算', async () => {
  const engine = fakeEngine()
  const cacheDir = tempDir('ann-')
  const first = createAnnotator({ url: 'http://engine.test/a', cacheDir, fetchImpl: engine.fetchImpl })
  await first.annotate('clip:x', ['Break a leg.'])
  await first.annotate('clip:x', ['Break a leg.'])
  assert.equal(engine.calls.length, 1)
  // 重啟之後(新的實例)從磁碟拿
  const second = createAnnotator({ url: 'http://engine.test/a', cacheDir, fetchImpl: engine.fetchImpl })
  await second.annotate('clip:x', ['Break a leg.'])
  assert.equal(engine.calls.length, 1)
  await second.annotate('clip:x', ['A different line.'])
  assert.equal(engine.calls.length, 2)
})

test('annotator: 同時進來的同一段只算一次;引擎回錯筆數或壞掉就丟錯、不存檔', async () => {
  let release
  const slow = fakeEngine(() => new Promise((resolve) => {
    release = () => resolve(new Response(JSON.stringify({ items: [{ translation: 'a', vocabulary: [] }] }), { status: 200 }))
  }))
  const annotator = createAnnotator({ url: 'http://engine.test/a', cacheDir: tempDir('ann-'), fetchImpl: slow.fetchImpl })
  const both = Promise.all([annotator.annotate('k', ['One.']), annotator.annotate('k', ['One.'])])
  while (!release) await new Promise((r) => setTimeout(r, 5))
  release()
  await both
  assert.equal(slow.calls.length, 1)

  const cacheDir = tempDir('ann-')
  for (const respond of [
    () => new Response(JSON.stringify({ items: [] }), { status: 200 }),
    () => new Response('boom', { status: 500 }),
    () => { throw new Error('ECONNREFUSED') }
  ]) {
    const bad = createAnnotator({ url: 'http://engine.test/a', cacheDir, fetchImpl: fakeEngine(respond).fetchImpl, onError: () => {} })
    await assert.rejects(bad.annotate('k2', ['One.']), (err) => err.code === 'failed')
  }
  assert.deepEqual(fs.readdirSync(cacheDir), [])
  await assert.rejects(createAnnotator().annotate('k', ['One.']), (err) => err.code === 'disabled')
})

test('annotator: 一天的新解析次數有上限(成本保險絲);算過的照樣給,隔天恢復', async () => {
  let clock = Date.parse('2026-11-06T10:00:00Z')
  const engine = fakeEngine()
  const annotator = createAnnotator({
    url: 'http://engine.test/a',
    cacheDir: tempDir('ann-'),
    fetchImpl: engine.fetchImpl,
    maxNewPerDay: 2,
    now: () => clock,
    onError: () => {}
  })
  await annotator.annotate('a', ['One.'])
  await annotator.annotate('b', ['Two.'])
  await assert.rejects(annotator.annotate('c', ['Three.']), (err) => err.code === 'busy')
  assert.equal(engine.calls.length, 2)
  assert.equal((await annotator.annotate('a', ['One.']))[0].zh, '譯:One.')
  clock += 24 * 60 * 60_000
  await annotator.annotate('c', ['Three.'])
  assert.equal(engine.calls.length, 3)
})

test('annotator: 少了任何一句中文的結果不收、不存檔;剛失敗的那一段一分鐘內不再重試', async () => {
  let clock = 1_000_000
  let mode = 'incomplete'
  const calls = []
  const fetchImpl = async (url, init) => {
    const { sentences } = JSON.parse(init.body)
    calls.push(sentences)
    const items = sentences.map((s, i) => ({ translation: mode === 'incomplete' && i === 1 ? '' : `譯:${s}`, vocabulary: [] }))
    return new Response(JSON.stringify({ items }), { status: 200 })
  }
  const cacheDir = tempDir('ann-')
  const annotator = createAnnotator({ url: 'http://engine.test/a', cacheDir, fetchImpl, now: () => clock, onError: () => {} })
  await assert.rejects(annotator.annotate('k', ['One.', 'Two.']), (err) => err.code === 'failed')
  assert.deepEqual(fs.readdirSync(cacheDir), [])
  mode = 'ok'
  await assert.rejects(annotator.annotate('k', ['One.', 'Two.']), (err) => err.code === 'failed')
  assert.equal(calls.length, 1, 'no second paid call during the cooldown')
  clock += 61_000
  assert.equal((await annotator.annotate('k', ['One.', 'Two.'])).length, 2)
  assert.equal(calls.length, 2)
  assert.equal(fs.readdirSync(cacheDir).length, 1)
})

test('annotator: 片語要是完整的字才算出現在句子裡(ten 不會配到 often)', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    items: [{ translation: '我常常遲到十分鐘', vocabulary: [{ word: 'ten', translation: '十' }, { word: 'often', translation: '常常' }, { word: 'lat', translation: '不該有' }] }]
  }), { status: 200 })
  const annotator = createAnnotator({ url: 'http://engine.test/a', cacheDir: tempDir('ann-'), fetchImpl })
  const [item] = await annotator.annotate('k', ['I am often late.'])
  assert.deepEqual(item.vocab, [{ word: 'often', zh: '常常' }])
})

test('vtt: 被切成幾行的一句話併回完整句子;停頓太久或太長就斷開', () => {
  const cues = [
    { start: 0, end: 1, text: 'I think we should' },
    { start: 1.1, end: 2, text: 'go now.' },
    { start: 2.5, end: 3, text: 'Really?' },
    { start: 3.2, end: 4, text: 'Well I was going to say' },
    { start: 9, end: 10, text: 'never mind' }
  ]
  assert.deepEqual(groupCues(cues), [
    { start: 0, end: 2, text: 'I think we should go now.' },
    { start: 2.5, end: 3, text: 'Really?' },
    { start: 3.2, end: 4, text: 'Well I was going to say' },
    { start: 9, end: 10, text: 'never mind' }
  ])
  const long = Array.from({ length: 10 }, (_, i) => ({ start: i, end: i + 0.9, text: 'word '.repeat(10).trim() }))
  assert.ok(groupCues(long).every((group) => group.text.length <= 240))
  assert.deepEqual(groupCues([]), [])
})

// ---- 額度 ----

test('plans: 逐句解析的額度 — 訪客沒有、免費會員每天 3 支、Pro 不限;看劇區前 3 集開放', () => {
  const plans = createPlans()
  assert.equal(plans.quota('guest', 'study'), 0)
  assert.equal(plans.quota('free', 'study'), 3)
  assert.equal(plans.quota('pro', 'study'), null)
  assert.equal(plans.quota('guest', 'studyEpisodes'), 3)
  assert.equal(plans.quota('pro', 'studyEpisodes'), null)
})

test('每日額度:同一支重複看不重複算,換日歸零', () => {
  let clock = Date.parse('2026-11-06T10:00:00Z')
  const usage = createDailyUsage({ now: () => clock })
  assert.deepEqual(usage.consume('u1', 'a', 2), { allowed: true, used: 1, limit: 2 })
  assert.deepEqual(usage.consume('u1', 'a', 2), { allowed: true, used: 1, limit: 2 })
  assert.deepEqual(usage.consume('u1', 'b', 2), { allowed: true, used: 2, limit: 2 })
  assert.deepEqual(usage.consume('u1', 'c', 2), { allowed: false, used: 2, limit: 2 })
  assert.equal(usage.consume('u2', 'c', 2).allowed, true)
  assert.deepEqual(usage.consume('u1', 'c', null), { allowed: true, used: 0, limit: null })
  clock += 24 * 60 * 60_000
  assert.equal(usage.consume('u1', 'c', 2).allowed, true)
})

// ---- 路由 ----

function startApp({ subscribers = {}, transcriptsDir = tempDir('tr-'), annotatorUrl = 'http://engine.test/a', subtitles } = {}) {
  const engine = fakeEngine()
  const { fetchImpl: jwksFetch } = fakeJwksFetch([KEYS.jwk])
  const paygateFetch = async (url) => {
    const u = new URL(url)
    const until = subscribers[`${u.searchParams.get('product')}:${u.searchParams.get('email')}`]
    return new Response(JSON.stringify(until ? { active: true, end_date: until } : { active: false }), { status: 200 })
  }
  const app = createApp({
    clipcafe: {
      search: async () => ({ total: 0, results: [] }),
      subtitles: subtitles || (async () => ({ status: 200, text: VTT }))
    },
    auth: createAuth({ appId: APP_ID, secret: 's', jwks: createJwksCache({ url: 'http://jwks.test', fetchImpl: jwksFetch }) }),
    tokens: TEST_TOKENS,
    paygate: createPaygate({ baseUrl: 'http://paygate.test', token: 't', alsoProducts: ['reelscript'], fetchImpl: paygateFetch, onError: () => {} }),
    annotator: createAnnotator({ url: annotatorUrl, cacheDir: tempDir('ann-'), fetchImpl: engine.fetchImpl, onError: () => {} }),
    transcripts: createTranscriptLibrary({ dir: transcriptsDir }),
    letmeuse: {}
  })
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({ server, engine, transcriptsDir, base: `http://127.0.0.1:${server.address().port}` })
    })
  })
}

test('片段解析:訪客 401;免費會員拿到逐句中文與片語,一天 3 支、第 4 支 402;重複看不扣', async () => {
  const { server, base, engine } = await startApp()
  try {
    const url = (slug) => `${base}/api/clips/${clipId(slug)}/study`
    assert.equal((await fetch(url('clip-a'))).status, 401)

    const headers = bearer('free@example.com')
    const first = await fetch(url('clip-a'), { headers })
    assert.equal(first.status, 200)
    assert.equal(first.headers.get('cache-control'), 'no-store')
    const body = await first.json()
    assert.deepEqual(body.data.cues[0], {
      start: 1.5, end: 3.402, text: 'Break a leg out there!', zh: '譯:Break a leg out there!', vocab: [{ word: 'break a leg', zh: '祝好運' }]
    })
    assert.deepEqual(body.data.quota, { limit: 3, used: 1 })
    assert.ok(!JSON.stringify(body).includes('clip-a'), 'source slug must not leak')

    assert.equal((await fetch(url('clip-a'), { headers })).status, 200)
    assert.equal((await fetch(url('clip-b'), { headers })).status, 200)
    assert.equal((await fetch(url('clip-c'), { headers })).status, 200)
    const fourth = await fetch(url('clip-d'), { headers })
    assert.equal(fourth.status, 402)
    assert.deepEqual(await fourth.json(), { success: false, error: 'upgrade_required', limit: 3, used: 3 })
    assert.equal((await fetch(url('clip-a'), { headers })).status, 200)
    assert.equal(engine.calls.length, 3, 'each clip is annotated once')
    assert.equal((await fetch(`${base}/api/clips/clip-a/study`, { headers })).status, 404)
  } finally {
    server.close()
  }
})

test('片段解析:Pro 不限支數;姊妹產品的訂閱也算 Pro;沒字幕 404 且不扣額度', async () => {
  const subscribers = { 'takeenglish:pro@example.com': '2099-01-01', 'reelscript:bundle@example.com': '2099-01-01' }
  const { server, base } = await startApp({ subscribers })
  try {
    for (const email of ['pro@example.com', 'bundle@example.com']) {
      for (const slug of ['a', 'b', 'c', 'd', 'e']) {
        const res = await fetch(`${base}/api/clips/${clipId(`clip-${slug}`)}/study`, { headers: bearer(email) })
        assert.equal(res.status, 200, `${email} ${slug}`)
        assert.deepEqual((await res.json()).data.quota, { limit: null, used: 0 })
      }
    }
    const me = await (await fetch(`${base}/api/me`, { headers: bearer('bundle@example.com') })).json()
    assert.equal(me.data.tier, 'pro')
  } finally {
    server.close()
  }
  const none = await startApp({ subtitles: async () => ({ status: 404, text: null }) })
  try {
    const headers = bearer('free@example.com')
    for (let i = 0; i < 5; i += 1) {
      const res = await fetch(`${none.base}/api/clips/${clipId(`silent-${i}`)}/study`, { headers })
      assert.equal(res.status, 404)
      assert.equal((await res.json()).error, 'no_subtitles')
    }
  } finally {
    none.server.close()
  }
})

test('劇情解析:前 3 集訪客也能看;第 4 集起訪客 401、免費會員 402、Pro 可看', async () => {
  const { server, base } = await startApp({ subscribers: { 'takeenglish:pro@example.com': '2099-01-01' } })
  try {
    const url = (ep) => `${base}/api/shows/brooklyn-nine-nine/seasons/5/episodes/${ep}/study`
    const open = await fetch(url(1))
    assert.equal(open.status, 200)
    const body = await open.json()
    assert.ok(body.data.sentences.length >= 2)
    assert.ok(body.data.sentences[0].text.startsWith('Jake and Rosa'))
    assert.ok(body.data.sentences[0].zh.startsWith('譯:'))
    assert.equal((await fetch(url(3))).status, 200)

    const guest = await fetch(url(4))
    assert.equal(guest.status, 401)
    assert.deepEqual(await guest.json(), { success: false, error: 'unauthorized', freeEpisodes: 3 })
    assert.equal((await fetch(url(4), { headers: bearer('free@example.com') })).status, 402)
    assert.equal((await fetch(url(4), { headers: bearer('pro@example.com') })).status, 200)
    assert.equal((await fetch(url(99))).status, 404)
    assert.equal((await fetch(`${base}/api/shows/nope/seasons/5/episodes/1/study`)).status, 404)
  } finally {
    server.close()
  }
})

test('整集台詞:沒匯入 404;匯入後分頁回逐句解析,季資料標出哪幾集有台詞', async () => {
  const dir = tempDir('tr-')
  const { server, base, engine } = await startApp({ transcriptsDir: dir })
  try {
    const url = `${base}/api/shows/brooklyn-nine-nine/seasons/5/episodes/2/transcript`
    assert.equal((await fetch(url)).status, 404)

    fs.mkdirSync(path.join(dir, 'brooklyn-nine-nine'), { recursive: true })
    const cues = Array.from({ length: 35 }, (_, i) => ({ start: i * 2, end: i * 2 + 1.5, text: `Line number ${i + 1}.` }))
    fs.writeFileSync(path.join(dir, 'brooklyn-nine-nine', 's05e02.json'), JSON.stringify({ cues }))

    const first = await (await fetch(url)).json()
    assert.equal(first.data.pages, 2)
    assert.equal(first.data.lines.length, 30)
    assert.deepEqual(first.data.lines[0], { start: 0, end: 1.5, text: 'Line number 1.', zh: '譯:Line number 1.', vocab: [] })
    const second = await (await fetch(`${url}?page=1`)).json()
    assert.equal(second.data.lines.length, 5)
    assert.equal(second.data.lines[4].text, 'Line number 35.')
    await fetch(url)
    assert.equal(engine.calls.length, 2, 'each page is annotated once')

    const season = await (await fetch(`${base}/api/shows/brooklyn-nine-nine/seasons/5`)).json()
    assert.deepEqual(season.data.episodes.filter((ep) => ep.hasTranscript).map((ep) => ep.number), [2])
  } finally {
    server.close()
  }
})

test('片段解析:引擎失敗時回 502,而且不算在使用者的每日額度裡', async () => {
  const { server, base, engine } = await startApp()
  try {
    const original = engine.fetchImpl
    let broken = true
    engine.respond = () => (broken ? new Response('boom', { status: 500 }) : null)
    const headers = bearer('free@example.com')
    for (const slug of ['x1', 'x2', 'x3', 'x4']) {
      assert.equal((await fetch(`${base}/api/clips/${clipId(slug)}/study`, { headers })).status, 502, slug)
    }
    broken = false
    // 四次失敗都沒扣額度,所以還是可以解析三支新的
    for (const slug of ['y1', 'y2', 'y3']) {
      const res = await fetch(`${base}/api/clips/${clipId(slug)}/study`, { headers })
      assert.equal(res.status, 200, slug)
    }
    assert.equal((await fetch(`${base}/api/clips/${clipId('y4')}/study`, { headers })).status, 402)
    assert.ok(original)
  } finally {
    server.close()
  }
})

test('姊妹產品的訂閱查不到時不影響本站判斷:照本站的結果走', async () => {
  const calls = []
  const paygate = createPaygate({
    baseUrl: 'http://paygate.test',
    token: 't',
    alsoProducts: ['reelscript'],
    onError: () => {},
    fetchImpl: async (url) => {
      const product = new URL(url).searchParams.get('product')
      calls.push(product)
      if (product === 'reelscript') throw new Error('sister lookup down')
      return new Response(JSON.stringify({ active: false }), { status: 200 })
    }
  })
  assert.equal((await paygate.tierFor('a@example.com')).tier, 'free')
  assert.deepEqual(calls, ['takeenglish', 'reelscript'])
  await paygate.tierFor('a@example.com')
  assert.equal(calls.length, 2, 'the answer is cached like any other')
})

test('沒接標註引擎時:解析一律 503,設定也說沒開', async () => {
  const { server, base } = await startApp({ annotatorUrl: '' })
  try {
    assert.equal((await fetch(`${base}/api/clips/${clipId('clip-a')}/study`, { headers: bearer('free@example.com') })).status, 503)
    assert.equal((await fetch(`${base}/api/shows/brooklyn-nine-nine/seasons/5/episodes/1/study`)).status, 503)
    const config = await (await fetch(`${base}/api/config`)).json()
    assert.equal(config.data.study, false)
  } finally {
    server.close()
  }
})

test('transcripts: 路徑只收合法的劇代號與整數,壞掉的檔案當成沒有', () => {
  const dir = tempDir('tr-')
  const library = createTranscriptLibrary({ dir })
  assert.equal(library.fileFor('../etc', 1, 1), null)
  assert.equal(library.fileFor('show', 1.5, 1), null)
  assert.ok(library.fileFor('show', 5, 1).endsWith(path.join('show', 's05e01.json')))
  fs.mkdirSync(path.join(dir, 'show'))
  fs.writeFileSync(path.join(dir, 'show', 's01e01.json'), '{ broken')
  assert.equal(library.has('show', 1, 1), true)
  assert.equal(library.get('show', 1, 1), null)
  assert.equal(library.get('show', 1, 2), null)
})

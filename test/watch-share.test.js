const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createApp } = require('../src/app')
const { createAuth } = require('../src/auth')
const { createShowLibrary } = require('../src/shows')
const { createNewsletter } = require('../src/newsletter')
const { cleanPhrase } = require('../src/share-page')
const wiki = require('../src/wiki-import')
const { TEST_TOKENS, clipId } = require('./helpers')

const WEBHOOK_SECRET = 'webhook-secret'

// ---- Wikipedia 匯入 ----

const EN_PAGE = `{{Infobox television season
| season_number = 5
| starring = {{Plainlist|
* [[Andy Samberg]]
}}
}}

The fifth season of ''[[Brooklyn Nine-Nine]]'' premiered on [[Fox Broadcasting Company|Fox]].<ref>cite</ref>

== Episodes ==
{{Episode list/sublist|Brooklyn Nine-Nine season 5
| EpisodeNumber = 91
| EpisodeNumber2 = 1
| Title = [[The Big House (Brooklyn Nine-Nine)|The Big House: Part 1]]
| DirectedBy = [[Tristram Shapeero]]
| WrittenBy = Luke Del Tredici
| OriginalAirDate = {{Start date|2017|9|26}}
| ProdCode = 501
| Viewers = 2.00<ref name="x">{{cite web|url=http://example.com/a|b|title=T}}</ref>
| ShortSummary = Jake and Rosa are in ''prison''. He smuggles "street soups" to a gang.
}}
{{Episode list/sublist|Brooklyn Nine-Nine season 5
| EpisodeNumber = 92
| EpisodeNumber2 = 2
| Title = Kicks
| OriginalAirDate = {{Start date|2017|10|10}}
| ProdCode = 503
| ShortSummary = Second one.
}}`

const ZH_PAGE = `{{Infobox television season
| season_name = 《荒唐分局》第五季
}}
《荒唐分局》第五季（{{lang|en|}}）由[[丹·戈爾]]開創。

== 集數 ==
{{Episode list/sublist|荒唐分局 (第五季)
| EpisodeNumber = 91
| EpisodeNumber2 = 1
| Title = 監獄生活Pt. 1{{efn-lr|[[Diva (電視網)|Diva]]譯名，[[Netflix]]翻譯為「監獄（一）」。}}
| AltTitle = The Big House Pt. 1
| DirectedBy = {{le|崔斯特姆·薛皮洛|Tristram Shapeero}}
| ShortSummary = 在-{傑克}-期待已久的探監日後，他被送回普通[[監獄]]。
<hr/>
客串：{{le|提姆·麥道斯|Tim Meadows}} 飾演 凱勒布
}}`

test('wiki: 把季頁面的模板轉成乾淨的中英文資料', () => {
  const data = wiki.buildSeason({
    show: { id: 'b99', title: { en: 'Brooklyn Nine-Nine', zh: '荒唐分局' } },
    season: 5,
    en: { title: 'Brooklyn Nine-Nine season 5', revision: 1, wikitext: EN_PAGE },
    zh: { title: '荒唐分局 (第五季)', revision: 2, wikitext: ZH_PAGE },
    fetchedAt: '2026-11-06'
  })
  assert.equal(data.episodes.length, 2)
  const [first, second] = data.episodes
  assert.deepEqual(first.title, { en: 'The Big House: Part 1', zh: '監獄生活Pt. 1', zhNetflix: '監獄（一）' })
  assert.equal(first.airDate, '2017-09-26')
  assert.equal(first.code, '501')
  assert.equal(first.summary.en, 'Jake and Rosa are in prison. He smuggles "street soups" to a gang.')
  assert.equal(first.summary.zh, '在傑克期待已久的探監日後，他被送回普通監獄。')
  assert.deepEqual(first.directedBy, { en: 'Tristram Shapeero', zh: '崔斯特姆·薛皮洛' })
  assert.deepEqual(second.title, { en: 'Kicks', zh: '', zhNetflix: '' })
  assert.equal(second.summary.zh, '')
  assert.equal(data.intro.en, 'The fifth season of Brooklyn Nine-Nine premiered on Fox.')
  assert.equal(data.intro.zh, '《荒唐分局》第五季由丹·戈爾開創。')
  assert.equal(data.source.license, 'CC BY-SA 4.0')
  assert.equal(data.source.en.url, 'https://en.wikipedia.org/wiki/Brooklyn_Nine-Nine_season_5')
  assert.ok(!/\{\{|\[\[|<ref|-\{/.test(JSON.stringify(data)))
})

test('wiki: 字詞轉換標記挑台灣用字', () => {
  assert.equal(wiki.cleanWikitext('-{zh-cn:网络;zh-tw:網路}-犯罪組'), '網路犯罪組')
  assert.equal(wiki.cleanWikitext('-{傑克}-與[[艾美·聖地牙哥|艾美]]'), '傑克與艾美')
})

test('匯入好的 Brooklyn Nine-Nine 第五季:22 集、中英文都齊、沒有殘留標記', () => {
  const file = path.join(__dirname, '..', 'data', 'shows', 'brooklyn-nine-nine', 'season-5.json')
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(data.episodes.length, 22)
  assert.deepEqual(data.episodes.map((ep) => ep.number), Array.from({ length: 22 }, (_, i) => i + 1))
  for (const ep of data.episodes) {
    assert.ok(ep.title.en && ep.title.zh, `episode ${ep.number} titles`)
    assert.ok(ep.summary.en.length > 40 && ep.summary.zh.length > 40, `episode ${ep.number} summaries`)
    assert.match(ep.airDate, /^20\d\d-\d\d-\d\d$/)
  }
  // 只看文字欄位本身(JSON 的結構符號本來就有 }} )
  const texts = [data.intro, ...data.episodes.flatMap((ep) => [ep.title, ep.summary, ep.directedBy, ep.writtenBy])]
    .flatMap((pair) => Object.values(pair))
    .join('\n')
  assert.ok(!/\{\{|\}\}|\[\[|\]\]|<ref|-\{|\}-|<[a-z]/i.test(texts))
  assert.ok(data.source.en.url.startsWith('https://en.wikipedia.org/wiki/'))
  assert.ok(data.source.zh.url.startsWith('https://zh.wikipedia.org/wiki/'))
})

// ---- 站台 ----

function sign(body) {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')
}

function startApp({ newsletter, shows, search, publicUrl = 'https://site.example' } = {}) {
  const calls = { search: [], thumb: [] }
  const app = createApp({
    clipcafe: {
      async search(params) {
        calls.search.push(params)
        return search ? search(params) : { total: 1, results: [{ slug: 'first-clip', text: 'hi' }] }
      },
      async thumb(slug, kind) {
        calls.thumb.push({ slug, kind })
        return { status: 200, body: Buffer.from('jpeg') }
      }
    },
    auth: createAuth({ appId: 'app_test', secret: WEBHOOK_SECRET, jwks: { getKey: async () => null } }),
    tokens: TEST_TOKENS,
    publicUrl,
    ...(newsletter ? { newsletter } : {}),
    ...(shows ? { shows } : {}),
    letmeuse: {}
  })
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({ server, calls, base: `http://127.0.0.1:${server.address().port}` })
    })
  })
}

test('看劇區 API:列出劇與季,取得一季的集數;不存在回 404', async () => {
  const { server, base } = await startApp()
  try {
    const list = await (await fetch(`${base}/api/shows`)).json()
    const b99 = list.data.shows.find((show) => show.id === 'brooklyn-nine-nine')
    assert.deepEqual(b99.title, { en: 'Brooklyn Nine-Nine', zh: '荒唐分局' })
    assert.deepEqual(b99.seasons, [
      { season: 5, episodes: 22, firstAired: '2017-09-26', lastAired: '2018-05-20', artwork: null }
    ])

    const season = await (await fetch(`${base}/api/shows/brooklyn-nine-nine/seasons/5`)).json()
    assert.equal(season.data.episodes.length, 22)
    assert.equal(season.data.episodes[0].title.en, 'The Big House: Part 1')

    for (const bad of ['brooklyn-nine-nine/seasons/9', 'nope/seasons/5', 'Bad_Id/seasons/5', 'brooklyn-nine-nine/seasons/x']) {
      assert.equal((await fetch(`${base}/api/shows/${bad}`)).status, 404, bad)
    }
    const page = await fetch(`${base}/watch`)
    assert.equal(page.status, 200)
    assert.ok((await page.text()).includes('watch.js'))
  } finally {
    server.close()
  }
})

test('看劇區封面:從片段裡挑這部劇、優先同一季的畫面;找不到或片源壞掉就沒有封面', async () => {
  const clips = [
    { slug: 'other-show-clip', movieTitle: 'Some Other Show', season: 5 },
    { slug: 'b99-season-1', movieTitle: 'Brooklyn Nine-Nine', season: 1 },
    { slug: 'b99-season-5', movieTitle: 'Brooklyn Nine-Nine', season: 5 }
  ]
  const found = await startApp({ search: async () => ({ total: 3, results: clips }) })
  try {
    const season = await (await fetch(`${found.base}/api/shows/brooklyn-nine-nine/seasons/5`)).json()
    const id = clipId('b99-season-5')
    assert.deepEqual(season.data.artwork, { card: `/thumb/${id}.jpg`, hero: `/og/${id}.jpg` })
    assert.ok(!JSON.stringify(season).includes('b99-season-5'), 'source slug must not leak')
    const list = await fetch(`${found.base}/api/shows`)
    assert.equal(list.headers.get('cache-control'), 'public, max-age=300')
    assert.deepEqual((await list.json()).data.shows[0].seasons[0].artwork, season.data.artwork)
    assert.equal(found.calls.search.length, 1, 'looked up once, then cached')
    assert.equal(found.calls.search[0].q, 'Brooklyn Nine-Nine')
  } finally {
    found.server.close()
  }

  for (const search of [async () => ({ total: 0, results: [] }), async () => { throw new Error('upstream down') }]) {
    const none = await startApp({ search })
    try {
      const res = await fetch(`${none.base}/api/shows/brooklyn-nine-nine/seasons/5`)
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('cache-control'), 'public, max-age=20')
      const body = await res.json()
      assert.equal(body.data.artwork, null)
      assert.equal(body.data.episodes.length, 22)
    } finally {
      none.server.close()
    }
  }
})

test('看劇區:資料夾裡有壞掉的檔案時跳過那一季,其他照常', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shows-'))
  fs.mkdirSync(path.join(dir, 'good-show'))
  fs.mkdirSync(path.join(dir, 'Bad Name'))
  fs.writeFileSync(path.join(dir, 'good-show', 'season-1.json'), JSON.stringify({ show: { id: 'good-show', title: { en: 'G', zh: '好' } }, season: 1, episodes: [{ number: 1, airDate: '2020-01-01' }] }))
  fs.writeFileSync(path.join(dir, 'good-show', 'season-2.json'), '{ not json')
  fs.writeFileSync(path.join(dir, 'good-show', 'notes.txt'), 'ignore me')
  const errors = []
  const shows = createShowLibrary({ dir, onError: (err) => errors.push(err.message) })
  assert.deepEqual(shows.list().map((s) => [s.id, s.seasons.map((x) => x.season)]), [['good-show', [1]]])
  assert.equal(shows.season('good-show', 2), null)
  assert.equal(errors.length, 1)
  assert.deepEqual(createShowLibrary({ dir: path.join(dir, 'missing') }).list(), [])
})

test('分享預覽:帶片語的首頁有自己的標題、網址和預覽圖', async () => {
  const { server, base, calls } = await startApp()
  try {
    const html = await (await fetch(`${base}/?q=break%20a%20leg`)).text()
    const id = clipId('first-clip')
    assert.ok(html.includes('<meta property="og:title" content="「break a leg」這句英文,影集都怎麼說?">'))
    assert.ok(html.includes('<title>「break a leg」這句英文,影集都怎麼說?｜takeENGLISH</title>'))
    assert.ok(html.includes('<meta property="og:url" content="https://site.example/?q=break%20a%20leg">'))
    assert.ok(html.includes(`<meta property="og:image" content="https://site.example/og/${id}.jpg">`))
    assert.ok(html.includes(`<meta name="twitter:image" content="https://site.example/og/${id}.jpg">`))
    assert.ok(html.includes('<meta property="og:image:width" content="1200">'))
    assert.ok(html.includes('app.js'), 'page body is still the normal app')
    assert.deepEqual(calls.search[0], { q: 'break a leg', size: 1, from: 0, slop: 0 })

    const plain = await (await fetch(`${base}/`)).text()
    assert.ok(plain.includes('content="takeENGLISH:這句英文,影集都怎麼說?"'))
    assert.equal(calls.search.length, 1)

    // 同一句(大小寫不同也算)再被抓一次,不會再去搜片源
    const again = await (await fetch(`${base}/?q=Break%20A%20Leg`)).text()
    assert.ok(again.includes(`/og/${id}.jpg`))
    assert.equal(calls.search.length, 1)

    // 物件形式的 q 不是片語,回一般首頁
    const odd = await (await fetch(`${base}/?q[a]=1`)).text()
    assert.ok(odd.includes('content="takeENGLISH:這句英文,影集都怎麼說?"'))
  } finally {
    server.close()
  }
})

test('分享預覽:片語裡的 HTML 與特殊符號不會變成標籤或被當成替換語法', async () => {
  const { server, base } = await startApp()
  try {
    const nasty = '"><script>alert(1)</script> $& $1 \'x\''
    const html = await (await fetch(`${base}/?q=${encodeURIComponent(nasty)}`)).text()
    assert.ok(!html.includes('<script>alert(1)'))
    assert.ok(html.includes('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; $&amp; $1 &#39;x&#39;'))
    assert.equal((html.match(/<title>/g) || []).length, 1)
    assert.equal((html.match(/property="og:title"/g) || []).length, 1)
  } finally {
    server.close()
  }
})

test('分享預覽:搜不到片段或上游壞掉時用全站預設圖,頁面照樣送出', async () => {
  for (const search of [async () => ({ total: 0, results: [] }), async () => { throw new Error('upstream down') }]) {
    const { server, base } = await startApp({ search })
    try {
      const res = await fetch(`${base}/?q=zzz`)
      assert.equal(res.status, 200)
      const html = await res.text()
      assert.ok(html.includes('「zzz」'))
      assert.ok(html.includes('/og.png"'))
    } finally {
      server.close()
    }
  }
})

test('cleanPhrase:控制字元拿掉、空白收成一格、過長截斷、空的回空字串', () => {
  assert.equal(cleanPhrase('  break\n\ta   leg  '), 'break a leg')
  assert.equal(cleanPhrase('a'.repeat(200)).length, 80)
  assert.equal(cleanPhrase(['first', 'second']), 'first')
  assert.equal(cleanPhrase('   '), '')
  assert.equal(cleanPhrase(undefined), '')
  assert.equal(cleanPhrase({ a: 1 }), '')
})

test('GET /og/:id.jpg 向上游要分享用的大圖;代號不對 404', async () => {
  const { server, base, calls } = await startApp()
  try {
    const res = await fetch(`${base}/og/${clipId('first-clip')}.jpg`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'image/jpeg')
    assert.match(res.headers.get('cache-control'), /max-age=31536000/)
    assert.deepEqual(calls.thumb, [{ slug: 'first-clip', kind: 'og' }])
    assert.equal((await fetch(`${base}/og/first-clip.jpg`)).status, 404)
    await fetch(`${base}/thumb/${clipId('first-clip')}.jpg`)
    assert.deepEqual(calls.thumb[1], { slug: 'first-clip', kind: 'thumb' })
  } finally {
    server.close()
  }
})

// ---- 電子報同步 ----

function fakeNewsletterServer(statuses = [200]) {
  const calls = []
  const queue = [...statuses]
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    const status = queue.length > 1 ? queue.shift() : queue[0]
    if (status === 'throw') throw new Error('connect ECONNREFUSED')
    return new Response('{}', { status })
  }
  return { calls, fetchImpl }
}

test('newsletter: 新會員送到訂閱端點,帶站別與來源', async () => {
  const { calls, fetchImpl } = fakeNewsletterServer()
  const newsletter = createNewsletter({ url: 'https://news.example/api/subscribe', siteId: 'english', fetchImpl })
  assert.equal(await newsletter.subscribe({ email: ' New@Gmail.com ', name: '  Amy  ' }), 'subscribed')
  assert.deepEqual(calls, [
    { url: 'https://news.example/api/subscribe', body: { email: 'new@gmail.com', site_id: 'english', source: 'takeenglish', name: 'Amy' } }
  ])
})

test('newsletter: 測試用網域與格式不對的不送;沒設定就停用', async () => {
  const { calls, fetchImpl } = fakeNewsletterServer()
  const newsletter = createNewsletter({ url: 'https://news.example/api/subscribe', siteId: 'english', fetchImpl })
  for (const email of ['e2e-1@example.com', 'x@sub.example.org', 'a@b.invalid', 'a@host.test', 'not-an-email', '', null]) {
    assert.equal(await newsletter.subscribe({ email }), 'skipped', String(email))
  }
  assert.equal(calls.length, 0)
  const off = createNewsletter({ fetchImpl })
  assert.equal(off.enabled, false)
  assert.equal(await off.subscribe({ email: 'a@gmail.com' }), 'disabled')
})

test('newsletter: 被限流或暫時壞掉會隔一段時間重試;對方說格式不對就不再試', async () => {
  const waits = []
  const sleep = async (ms) => { waits.push(ms) }
  const busy = fakeNewsletterServer([429, 'throw', 200])
  const retrying = createNewsletter({ url: 'https://n.example/s', siteId: 'english', fetchImpl: busy.fetchImpl, sleep, onError: () => {} })
  assert.equal(await retrying.subscribe({ email: 'a@gmail.com' }), 'subscribed')
  assert.equal(busy.calls.length, 3)
  assert.deepEqual(waits, [20_000, 70_000])

  const errors = []
  const rejected = fakeNewsletterServer([400])
  const giveUp = createNewsletter({ url: 'https://n.example/s', siteId: 'english', fetchImpl: rejected.fetchImpl, sleep, onError: (err) => errors.push(err.message) })
  assert.equal(await giveUp.subscribe({ email: 'someone@gmail.com' }), 'failed')
  assert.equal(rejected.calls.length, 1)
  assert.equal(errors.length, 1)
  assert.ok(!errors[0].includes('someone@'), 'log must not contain the full address')
})

test('webhook: 簽章正確的註冊事件會同步到電子報;簽章不對或其他事件不會', async () => {
  const subscribed = []
  const newsletter = { enabled: true, subscribe: async (who) => { subscribed.push(who); return 'subscribed' } }
  const { server, base } = await startApp({ newsletter })
  try {
    const send = (event, body, signature = sign(body)) =>
      fetch(`${base}/api/webhooks/letmeuse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-LetMeUse-Event': event, 'X-LetMeUse-Signature': signature },
        body
      })
    const registered = JSON.stringify({ event: 'user.registered', payload: { userId: 'u1', email: 'new@gmail.com', displayName: 'Amy' } })
    assert.equal((await send('user.registered', registered)).status, 200)
    assert.deepEqual(subscribed, [{ email: 'new@gmail.com', name: 'Amy' }])

    assert.equal((await send('user.registered', registered, 'f'.repeat(64))).status, 401)
    assert.equal((await send('user.login', JSON.stringify({ event: 'user.login', payload: { email: 'new@gmail.com' } }))).status, 200)
    assert.equal((await send('user.registered', 'not json at all')).status, 200)
    assert.equal((await send('user.registered', JSON.stringify({ payload: { userId: 'u2' } }))).status, 200)
    assert.equal(subscribed.length, 1)

    // 事件以簽過章的內容為準:標頭寫「註冊」但內容是登入通知 → 不訂閱
    const login = JSON.stringify({ event: 'user.login', payload: { userId: 'u3', email: 'replay@gmail.com' } })
    assert.equal((await send('user.registered', login)).status, 200)
    assert.equal(subscribed.length, 1)

    // 沒有內容的請求當簽章不對,不能讓伺服器出錯
    const empty = await fetch(`${base}/api/webhooks/letmeuse`, { method: 'POST', headers: { 'X-LetMeUse-Signature': 'f'.repeat(64) } })
    assert.equal(empty.status, 401)
  } finally {
    server.close()
  }
})

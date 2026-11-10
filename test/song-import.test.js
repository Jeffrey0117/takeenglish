const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  videoIdOf,
  cleanTitle,
  splitArtist,
  lyricText,
  tidy,
  deCaps,
  parseLrc,
  attachTranslations,
  createYtDlp,
  buildSong,
  importFromYouTube
} = require('../src/song-import')

test('各種 YouTube 網址都認得出代號,不是 YouTube 的回空字串', () => {
  assert.equal(videoIdOf('UprcpdwuwCg'), 'UprcpdwuwCg')
  assert.equal(videoIdOf('https://www.youtube.com/watch?v=UprcpdwuwCg&t=30s'), 'UprcpdwuwCg')
  assert.equal(videoIdOf('https://youtu.be/UprcpdwuwCg'), 'UprcpdwuwCg')
  assert.equal(videoIdOf('https://www.youtube.com/shorts/UprcpdwuwCg'), 'UprcpdwuwCg')
  assert.equal(videoIdOf('https://evil.example/watch?v=UprcpdwuwCg'), 'UprcpdwuwCg') // 代號照抓,網域不影響
  assert.equal(videoIdOf('https://vimeo.com/12345'), '')
  assert.equal(videoIdOf(''), '')
})

test('標題去掉宣傳標記,歌手從標題拆出來', () => {
  assert.equal(cleanTitle('twenty one pilots: Heathens (from Suicide Squad) [OFFICIAL VIDEO]'), 'twenty one pilots: Heathens')
  assert.equal(cleanTitle('Believer (Official Music Video)'), 'Believer')
  // 歌名本身的括號不能被吃掉
  assert.equal(cleanTitle('Say It Right (feat. Nelly)'), 'Say It Right (feat. Nelly)')
  assert.deepEqual(splitArtist('twenty one pilots: Heathens'), { artist: 'twenty one pilots', title: 'Heathens' })
  assert.deepEqual(splitArtist('Heathens'), { artist: '', title: 'Heathens' })
})

test('不是歌詞的行丟掉:音效描述、段落標記、只有音符', () => {
  assert.equal(lyricText('(plane whirring)'), '')
  assert.equal(lyricText('\u266a'), '')
  assert.equal(lyricText('[Chorus]'), '')
  assert.equal(lyricText('\u266a All my friends are heathens \u266a'), 'All my friends are heathens')
  // 句子中間插的 [Music] 要拿掉,句子本身留著
  assert.equal(lyricText('sweep you off your [Music] feet'), 'sweep you off your feet')
})

test('滾動式自動字幕的半句重複會併回一句', () => {
  const lines = tidy([
    { start: 0, end: 2, text: 'All my friends' },
    { start: 0.5, end: 3, text: 'All my friends are heathens' },
    { start: 4, end: 7, text: 'Take it slow' }
  ])
  assert.deepEqual(
    lines.map((l) => l.text),
    ['All my friends are heathens', 'Take it slow']
  )
  assert.equal(lines[0].start, 0) // 併進來的那句從最早的時間開始
})

// 自動字幕的另一種樣子:兩行視窗往上滾,這一句的尾巴會再出現在下一句的開頭。
// 不處理的話同一段歌詞要打兩三次(Shape of You 的自動字幕就是這樣)。
test('兩行滾動字幕:重疊的開頭剪掉,每段只留新的部分', () => {
  const lines = tidy([
    { start: 0, end: 5, text: "The club isn't the best place to find a lover, so the bar is where I go. Me and" },
    { start: 5, end: 10, text: 'lover, so the bar is where I go. Me and my friends at the table doing shots,' },
    { start: 10, end: 15, text: 'my friends at the table doing shots, tripping fast, and then we talk slow.' }
  ])
  assert.deepEqual(
    lines.map((l) => l.text),
    [
      "The club isn't the best place to find a lover, so the bar is where I go. Me and",
      'my friends at the table doing shots, tripping fast, and then we talk slow.'
    ]
  )
  // 整句歌詞只出現一次
  assert.equal(lines.filter((l) => l.text.includes('doing shots')).length, 1)
})

test('太短的前綴不算滾動字幕 — 副歌的 "Oh" 和 "Oh baby" 是兩句', () => {
  const lines = tidy([
    { start: 0, end: 2, text: 'Oh' },
    { start: 2, end: 4, text: 'Oh baby' }
  ])
  assert.equal(lines.length, 2)
})

test('整首大寫的字幕轉回正常大小寫(照著打不用一直按 Shift)', () => {
  const shouty = [
    { start: 0, end: 2, text: 'FIRST THINGS FIRST' },
    { start: 2, end: 4, text: "I'M GONNA SAY ALL THE WORDS INSIDE MY HEAD" }
  ]
  assert.deepEqual(
    deCaps(shouty).map((l) => l.text),
    ['First things first', "I'm gonna say all the words inside my head"]
  )
  // 本來就是正常大小寫的別亂動
  const normal = [{ start: 0, end: 2, text: 'All my friends are heathens' }]
  assert.deepEqual(deCaps(normal), normal)
})

test('LRC:一行掛兩個時間就是兩句,結束時間接到下一句', () => {
  const lines = parseLrc('[00:10.00][01:20.50]All my friends\n[00:14.00]Take it slow\n沒有時間的行\n')
  assert.deepEqual(
    lines.map((l) => [l.start, l.text]),
    [
      [10, 'All my friends'],
      [14, 'Take it slow'],
      [80.5, 'All my friends']
    ]
  )
  assert.equal(lines[0].end, 14)
})

test('中文字幕按時間重疊對回英文句', () => {
  const lines = [
    { start: 0, end: 4, text: 'All my friends' },
    { start: 10, end: 14, text: 'Take it slow' }
  ]
  const zh = [
    { start: 0.2, end: 3.8, text: '我的朋友' },
    { start: 50, end: 54, text: '對不上的' }
  ]
  const merged = attachTranslations(lines, zh)
  assert.equal(merged[0].zh, '我的朋友')
  assert.equal(merged[1].zh, '')
})

// 假的 yt-dlp:不會真的打 YouTube
function fakeYtDlp({ title = 'twenty one pilots: Heathens [OFFICIAL VIDEO]', channel = 'Fueled By Ramen', embeddable = true, en = 'ok', zh = null } = {}) {
  const calls = []
  return {
    calls,
    async meta() {
      calls.push('meta')
      return { title, channel, embeddable }
    },
    async subtitles(videoId, langs) {
      calls.push(`subs:${langs}`)
      if (langs.startsWith('zh')) {
        return zh || []
      }
      if (en === 'none') return []
      return [
        { start: 20.8, end: 25.4, text: '\u266a All my friends are heathens, take it slow \u266a' },
        { start: 25.4, end: 26.4, text: '(gentle music)' },
        { start: 26.4, end: 31.3, text: '\u266a Wait for them to ask you who you know \u266a' }
      ]
    }
  }
}

test('匯入一支:代號、歌名、歌手、乾淨的歌詞', async () => {
  const song = await importFromYouTube('https://youtu.be/UprcpdwuwCg', { ytdlp: fakeYtDlp() })
  assert.equal(song.id, 'heathens')
  assert.equal(song.title, 'Heathens')
  assert.equal(song.artist, 'twenty one pilots') // 不是頻道名(唱片公司)
  assert.equal(song.youtubeId, 'UprcpdwuwCg')
  assert.deepEqual(
    song.lines.map((l) => l.text),
    ['All my friends are heathens, take it slow', 'Wait for them to ask you who you know']
  )
})

test('不能嵌入的影片擋下來(在站上根本播不了)', async () => {
  await assert.rejects(
    () => importFromYouTube('UprcpdwuwCg', { ytdlp: fakeYtDlp({ embeddable: false }) }),
    (err) => err.code === 'not_embeddable'
  )
})

test('沒有英文字幕就說清楚,不要寫出一個空的檔案', async () => {
  await assert.rejects(
    () => importFromYouTube('UprcpdwuwCg', { ytdlp: fakeYtDlp({ en: 'none' }) }),
    (err) => err.code === 'no_subtitles'
  )
})

test('不是 YouTube 連結:連 yt-dlp 都不用跑', async () => {
  const ytdlp = fakeYtDlp()
  await assert.rejects(() => importFromYouTube('https://vimeo.com/12345', { ytdlp }), (err) => err.code === 'bad_url')
  assert.deepEqual(ytdlp.calls, [])
})

test('整份都是音效描述的話,清乾淨之後不給過', () => {
  assert.throws(
    () =>
      buildSong({
        videoId: 'UprcpdwuwCg',
        meta: { title: 'Noise', channel: 'x', embeddable: true },
        cues: [
          { start: 0, end: 2, text: '(wind)' },
          { start: 2, end: 4, text: '[Music]' }
        ]
      }),
    (err) => err.code === 'no_subtitles'
  )
})

test('yt-dlp 不在就講清楚是哪個路徑,不要丟一句看不懂的 ENOENT', async () => {
  const ytdlp = createYtDlp({
    bin: 'C:/nowhere/yt-dlp.exe',
    exec: (bin, args, opts, cb) => cb(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))
  })
  await assert.rejects(() => ytdlp.meta('UprcpdwuwCg'), (err) => err.code === 'ytdlp_missing' && /nowhere/.test(err.message))
})

test('YouTube 回 429 的時候給得出「稍後再試」,不是當成一般失敗', async () => {
  const ytdlp = createYtDlp({
    exec: (bin, args, opts, cb) => cb(new Error('boom'), '', 'ERROR: HTTP Error 429: Too Many Requests')
  })
  await assert.rejects(() => ytdlp.meta('UprcpdwuwCg'), (err) => err.code === 'rate_limited')
})

test('yt-dlp 一次只跑一支(同時打太多次 YouTube 會把自己鎖掉)', async () => {
  let running = 0
  let peak = 0
  const ytdlp = createYtDlp({
    exec: (bin, args, opts, cb) => {
      running += 1
      peak = Math.max(peak, running)
      setTimeout(() => {
        running -= 1
        cb(null, 'T|||C|||True', '')
      }, 10)
    }
  })
  await Promise.all([ytdlp.meta('UprcpdwuwCg'), ytdlp.meta('UprcpdwuwCg'), ytdlp.meta('UprcpdwuwCg')])
  assert.equal(peak, 1)
})

test('前一支失敗不會卡住後面排隊的', async () => {
  let first = true
  const ytdlp = createYtDlp({
    exec: (bin, args, opts, cb) => {
      if (first) {
        first = false
        return cb(new Error('boom'), '', 'nope')
      }
      return cb(null, 'T|||C|||True', '')
    }
  })
  await assert.rejects(() => ytdlp.meta('UprcpdwuwCg'))
  const meta = await ytdlp.meta('UprcpdwuwCg')
  assert.equal(meta.title, 'T')
})

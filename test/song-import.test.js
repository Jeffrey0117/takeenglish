const { test } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
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
  importFromYouTube,
  looksLikeProse,
  reflow,
  tooThin,
  subtitleDensity,
  pickBestTrack
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
function fakeYtDlp({ title = 'twenty one pilots: Heathens [OFFICIAL VIDEO]', channel = 'Fueled By Ramen', embeddable = true, en = 'ok', hasEnglish = null, zh = null } = {}) {
  const calls = []
  // 要夠像一首真的歌:太少句或太稀疏會被 tooThin 擋下來(那是刻意的)
  const CUES = [
    { start: 20.8, end: 25.4, text: '♪ All my friends are heathens, take it slow ♪' },
    { start: 25.4, end: 26.4, text: '(gentle music)' },
    { start: 26.4, end: 31.3, text: '♪ Wait for them to ask you who you know ♪' },
    { start: 31.3, end: 36.3, text: '♪ Please don’t make any sudden moves ♪' },
    { start: 36.7, end: 41.7, text: '♪ You don’t know the half of the abuse ♪' },
    { start: 42.5, end: 47.5, text: '♪ Welcome to the room of people ♪' }
  ]
  const meta = () => ({ title, channel, embeddable, hasEnglish: hasEnglish === null ? en !== 'none' : hasEnglish })
  return {
    calls,
    async fetchSong() {
      calls.push('fetchSong')
      return { meta: meta(), cues: en === 'none' ? [] : CUES, stderr: '' }
    },
    async meta() {
      calls.push('meta')
      return meta()
    },
    async subtitles(videoId, langs) {
      calls.push(`subs:${langs}`)
      if (langs.startsWith('zh')) return zh || []
      return en === 'none' ? [] : CUES
    }
  }
}

test('匯入一支:代號、歌名、歌手、乾淨的歌詞', async () => {
  const song = await importFromYouTube('https://youtu.be/UprcpdwuwCg', { ytdlp: fakeYtDlp() })
  assert.equal(song.id, 'heathens')
  assert.equal(song.title, 'Heathens')
  assert.equal(song.artist, 'twenty one pilots') // 不是頻道名(唱片公司)
  assert.equal(song.youtubeId, 'UprcpdwuwCg')
  assert.deepEqual(song.lines.map((l) => l.text), [
    'All my friends are heathens, take it slow',
    'Wait for them to ask you who you know',
    'Please don’t make any sudden moves',
    'You don’t know the half of the abuse',
    'Welcome to the room of people'
  ])
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

// ---- 斷句:自動字幕的斷點跟句子無關 ----

const PROSE = [
  { start: 0, end: 5, text: 'When your legs don’t work like they used to' },
  { start: 5, end: 10, text: 'before and I can’t sweep you off of your' },
  { start: 10, end: 15, text: 'feet. Will your mouth still remember the taste of my love?' },
  { start: 15, end: 20, text: 'Will your eyes still smile from your cheeks?' }
]

const LYRICS = [
  { start: 0, end: 4, text: 'All my friends are heathens, take it slow' },
  { start: 4, end: 8, text: 'Wait for them to ask you who you know' },
  { start: 8, end: 12, text: 'Please don’t make any sudden moves' },
  { start: 12, end: 16, text: 'You don’t know the half of the abuse' }
]

test('散文式的自動字幕認得出來,歌詞式的不會被誤判', () => {
  assert.equal(looksLikeProse(PROSE), true)
  assert.equal(looksLikeProse(LYRICS), false)
  assert.equal(looksLikeProse(PROSE.slice(0, 2)), false) // 行數太少不判斷
})

test('照句子重切:每一行都是完整的一句,不是半截話', () => {
  const lines = reflow(PROSE)
  assert.deepEqual(
    lines.map((l) => l.text),
    [
      'When your legs don’t work like they used to before and I can’t sweep you off of your feet.',
      'Will your mouth still remember the taste of my love?',
      'Will your eyes still smile from your cheeks?'
    ]
  )
})

test('重切之後時間還對得上影片', () => {
  const lines = reflow(PROSE)
  assert.equal(lines[0].start, 0) // 第一句從頭開始
  assert.ok(lines[lines.length - 1].end <= 20) // 不會超出原本的範圍
  for (let i = 1; i < lines.length; i += 1) {
    assert.ok(lines[i].start >= lines[i - 1].start, '時間要遞增')
    assert.ok(lines[i].end > lines[i].start)
  }
})

test('歌詞式的字幕不要動它 —— 重切會把一句一行黏成一大段', () => {
  assert.deepEqual(reflow(LYRICS), LYRICS)
})

test('一直沒有標點的長句會在長度上限斷開,不會變成一行三百字', () => {
  // 開頭放一長串沒有標點的 "na na na…"(副歌常有),後面接原本那段散文式字幕
  const runOn = { start: 0, end: 30, text: `${'na '.repeat(80).trim()}. Done` }
  const lines = reflow([runOn, ...PROSE])
  assert.ok(lines.length > 3, '那一長串要被切成好幾行')
  for (const line of lines) assert.ok(line.text.length <= 95, `這行太長:${line.text.length}`)
})

// ---- 被 YouTube 擋下來的時候,別講成「這支影片沒字幕」 ----

test('有英文字幕卻抓不到 → 說「沒抓到」,不是「沒有字幕」', async () => {
  // 使用者被這個騙了好幾次:一直換影片,其實是我們這邊抓不到
  await assert.rejects(
    () => importFromYouTube('UprcpdwuwCg', { ytdlp: fakeYtDlp({ en: 'none', hasEnglish: true }) }),
    (err) => err.code === 'subs_fetch_failed'
  )
})

test('真的沒有英文字幕才說沒有', async () => {
  await assert.rejects(
    () => importFromYouTube('UprcpdwuwCg', { ytdlp: fakeYtDlp({ en: 'none', hasEnglish: false }) }),
    (err) => err.code === 'no_subtitles'
  )
})

test('一支歌只打 YouTube 一輪(以前要兩輪,被擋的機率翻倍)', async () => {
  const ytdlp = fakeYtDlp()
  await importFromYouTube('UprcpdwuwCg', { ytdlp })
  assert.deepEqual(ytdlp.calls, ['fetchSong'])
})

// yt-dlp 把 429 印在 stderr 之後「正常結束」是常態 —— 只看離開碼就會誤判
test('429 印在 stderr 但離開碼是 0:照樣要當成被擋', async () => {
  const ytdlp = createYtDlp({
    exec: (bin, args, opts, cb) => cb(null, '', 'ERROR: Unable to download video subtitles: HTTP Error 429: Too Many Requests')
  })
  await assert.rejects(() => ytdlp.fetchSong('UprcpdwuwCg', 'en'), (err) => err.code === 'rate_limited')
})

test('被擋過之後進入冷卻:接下來直接回「還要等幾分鐘」,不再去打 YouTube', async () => {
  const clock = { t: 1_000_000 }
  let runs = 0
  const ytdlp = createYtDlp({
    now: () => clock.t,
    exec: (bin, args, opts, cb) => {
      runs += 1
      cb(null, '', 'HTTP Error 429: Too Many Requests')
    }
  })
  await assert.rejects(() => ytdlp.fetchSong('UprcpdwuwCg', 'en'), (err) => err.code === 'rate_limited')
  assert.equal(runs, 1)

  await assert.rejects(
    () => ytdlp.fetchSong('UprcpdwuwCg', 'en'),
    (err) => err.code === 'rate_limited' && /分鐘/.test(err.message)
  )
  assert.equal(runs, 1, '冷卻期間不該再打 YouTube')

  // 冷卻過了就能再試
  clock.t += 6 * 60_000
  assert.equal(ytdlp.blockedFor, 0)
  await assert.rejects(() => ytdlp.fetchSong('UprcpdwuwCg', 'en'))
  assert.equal(runs, 2)
})

test('--print 一定要配 --no-simulate,不然 yt-dlp 只印不寫檔,字幕永遠是空的', () => {
  let seen = []
  const ytdlp = createYtDlp({
    exec: (bin, args, opts, cb) => {
      seen = args
      cb(null, 'T|||C|||True|||vtt|||NA', '')
    }
  })
  return ytdlp.fetchSong('UprcpdwuwCg', 'en').then(() => {
    assert.ok(seen.includes('--print'))
    assert.ok(seen.includes('--no-simulate'), '少了 --no-simulate 就抓不到任何字幕')
    assert.ok(seen.includes('--skip-download'), '只要字幕,不要影片')
  })
})

// ---- 有字幕軌 ≠ 能練 ----

// 非英文歌常常也有一條 en 自動字幕軌,但裡面只是 YouTube 從韓文歌裡「聽」出來的
// 幾個零星英文字。使用者實際遇到的那首:四句話撐兩分鐘,內容是 "um"、"again"
const JUNK = [
  { start: 13.9, end: 43.8, text: 'why are you trying to be' },
  { start: 43.8, end: 64.2, text: 'i can take me' },
  { start: 98.8, end: 103.2, text: 'um' },
  { start: 113.4, end: 119.5, text: 'again' }
]

test('字幕太稀疏的擋下來,不要讓人拿到一首練不了的歌', () => {
  assert.equal(tooThin(JUNK), true)
  assert.ok(subtitleDensity(JUNK) < 1, `密度應該很低,實際 ${subtitleDensity(JUNK)}`)
  assert.throws(
    () =>
      buildSong({
        videoId: 'TYGu-DnX8kg',
        meta: { title: 'CAMO - Wifey', channel: 'CAMO', embeddable: true },
        cues: JUNK
      }),
    (err) => err.code === 'thin_subtitles'
  )
})

test('真的英文歌不會被這道門檻誤殺', () => {
  const real = [
    { start: 20.8, end: 25.4, text: 'All my friends are heathens, take it slow' },
    { start: 25.4, end: 30.1, text: 'Wait for them to ask you who you know' },
    { start: 30.1, end: 35.0, text: 'Please don’t make any sudden moves' },
    { start: 35.0, end: 40.2, text: 'You don’t know the half of the abuse' }
  ]
  assert.equal(tooThin(real), false)
  assert.ok(subtitleDensity(real) > 5)
})

test('句數太少也擋(兩三句撐不起一首歌)', () => {
  assert.equal(tooThin([{ start: 0, end: 2, text: 'Take it slow' }]), true)
})

test('擋下來的訊息要說得出「幾句、密度多少」,不然沒人知道為什麼', () => {
  assert.throws(
    () => buildSong({ videoId: 'TYGu-DnX8kg', meta: { title: 'x', channel: 'y', embeddable: true }, cues: JUNK }),
    (err) => /只有 4 句/.test(err.message) && /0\.4 個字元/.test(err.message)
  )
})

// ---- 同一支影片有好幾條「英文」字幕軌 ----

// 實測 CAMO - Wifey(韓文歌)同時有三條:
//   en-US  42 句,密度 15.55  ← 真的歌詞(使用者在 YouTube 上看到的就是這條)
//   en     18 句,密度 1.89   ← 幾乎都是 [Music]
//   en-orig 同上
// 原本是「挑資料夾裡第一個 .vtt」,等於讓檔名順序決定品質 —— 挑到廢的那條之後
// 還回報「這首不是英文歌」,把使用者引去怪影片。
const VTT = (cues) =>
  `WEBVTT\n\n${cues
    .map(([from, to, text], i) => `${i + 1}\n00:00:${String(from).padStart(2, '0')}.000 --> 00:00:${String(to).padStart(2, '0')}.000\n${text}\n`)
    .join('\n')}`

test('有好幾條英文軌時,挑內容最紮實的那條(不是檔名排最前面的)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'te-tracks-'))
  try {
    // 檔名順序上 en-US 不見得排第一,但它才是好的那條
    fs.writeFileSync(path.join(dir, 'sub.en.vtt'), VTT([[1, 20, '[Music]'], [20, 40, '[Music]'], [40, 59, 'oh']]))
    fs.writeFileSync(
      path.join(dir, 'sub.en-US.vtt'),
      VTT([
        [1, 5, 'Why you tryna be low'],
        [5, 9, 'I can take it slow'],
        [9, 14, 'We’ve been playin since I saw you at that party'],
        [14, 19, 'Whole lotta surfers on my tide but you’re my papi'],
        [19, 24, 'Didn’t know that you would ever see me crying']
      ])
    )
    const cues = pickBestTrack(dir)
    assert.equal(cues[0].text, 'Why you tryna be low')
    assert.ok(cues.length >= 5)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('全部都是廢軌就回空的(讓上層去說「真的沒有字幕」)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'te-tracks-'))
  try {
    fs.writeFileSync(path.join(dir, 'sub.en.vtt'), VTT([[1, 30, '[Music]'], [30, 59, '[Applause]']]))
    assert.deepEqual(pickBestTrack(dir), [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('中文字幕的清理:全形括號的音效描述、音符都不是歌詞', () => {
  assert.equal(lyricText('（歡快的音樂）'), '')
  assert.equal(lyricText('♪ 我一直想打電話 ♪'), '我一直想打電話')
})

test('匯入時順便要中文:對得上的句子帶 zh,抓不到中文也不影響匯入', async () => {
  const zh = [
    { start: 20.8, end: 25.4, text: '♪ 我的朋友都是異教徒 ♪' },
    { start: 25.4, end: 26.4, text: '（輕柔的音樂）' }
  ]
  const song = await importFromYouTube('https://youtu.be/UprcpdwuwCg', { ytdlp: fakeYtDlp({ zh }), zh: true })
  assert.equal(song.lines[0].zh, '我的朋友都是異教徒')
  assert.equal(song.lines[1].zh, '')
  const broken = fakeYtDlp()
  broken.subtitles = async () => {
    throw new Error('boom')
  }
  const plain = await importFromYouTube('https://youtu.be/UprcpdwuwCg', { ytdlp: broken, zh: true })
  assert.equal(plain.lines.length, song.lines.length)
})

// YouTube 的翻譯字幕特別容易 429。那只代表「中文抓不到」,不能連英文匯入一起停掉
test('中文被擋只記在中文自己的冷卻上:英文匯入照常,中文在冷卻內不再打 YouTube', async () => {
  let runs = 0
  const ytdlp = createYtDlp({
    exec: (bin, args, opts, cb) => {
      runs += 1
      cb(null, '', 'HTTP Error 429: Too Many Requests')
    }
  })
  await assert.rejects(() => ytdlp.translations('UprcpdwuwCg'), (err) => err.code === 'zh_rate_limited')
  assert.equal(ytdlp.blockedFor, 0)
  await assert.rejects(() => ytdlp.translations('UprcpdwuwCg'), (err) => err.code === 'zh_rate_limited')
  assert.equal(runs, 1)
})

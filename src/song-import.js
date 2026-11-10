const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { parseCues } = require('./vtt')

// 一支 YouTube 影片 → 可以拿來練打的逐句歌詞。
// CLI(scripts/import-song.js)和「會員自己貼連結」兩邊共用這一份。
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/
const LRC_LINE = /^\s*((?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+)\s*(.*)$/
const LRC_STAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g
const MIN_LINE_SECONDS = 0.6
const EN_LANGS = 'en-orig,en,en-US,en-GB'
// 被 YouTube 擋到之後先停手。繼續猛打只會被擋更久
const COOLDOWN_MS = 5 * 60_000
const RATE_LIMITED = /HTTP Error 429|Too Many Requests|Sign in to confirm/i
const ZH_LANGS = 'zh-Hant,zh-TW,zh-Hans,zh'
// YouTube 標題常帶一堆宣傳標記:[OFFICIAL VIDEO]、(Lyric Video)、(from 某某電影原聲帶)
const PROMO_BRACKET = /\s*\[[^\]]*\]/g
const PROMO_PAREN = /\s*\((?:[^)]*\b(?:official|lyric|lyrics|audio|video|visuali[sz]er|explicit|remaster|hd|4k|mv)\b[^)]*|from [^)]*)\)/gi

function importError(code, message) {
  return Object.assign(new Error(message), { code })
}

function videoIdOf(input) {
  const value = String(input || '').trim()
  if (YOUTUBE_ID_PATTERN.test(value)) return value
  const match = value.match(/(?:v=|\/shorts\/|\/embed\/|\/live\/|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  return match ? match[1] : ''
}

function cleanTitle(raw) {
  return String(raw || '')
    .replace(PROMO_BRACKET, '')
    .replace(PROMO_PAREN, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// 「twenty one pilots: Heathens」→ 歌手 + 歌名。頻道名常常是唱片公司,標題有寫就用標題的
function splitArtist(title) {
  const match = /^(.{2,60}?)\s*[:–—-]\s+(.{1,80})$/.exec(title)
  return match ? { artist: match[1].trim(), title: match[2].trim() } : { artist: '', title }
}

// 歌詞行的清理:♪ 打不出來、(汽笛聲) [Chorus] [Music] 這種不是歌詞。回空字串 = 這一句丟掉
function lyricText(text) {
  const cleaned = String(text || '')
    .replace(/[♪♫♩♬]/g, ' ')
    // 自動字幕會在句子中間插 [Music]、[Applause];方括號在歌詞裡幾乎不會出現,整組拿掉
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''
  // 整句都是括號裡的描述(音效、段落標記)
  if (/^\([^)]*\)$/.test(cleaned)) return ''
  return cleaned
}

const wordsOf = (text) => text.split(' ').filter(Boolean)

// YouTube 的自動字幕常常是「兩行滾動」:這一句的尾巴會再出現在下一句的開頭,
// 例如「…so the bar is where I go. Me and」接「lover, so the bar is where I go. Me and my friends…」。
// 照抄的話同一段要打兩三次。把重疊的開頭剪掉,每句只留真正新的部分。
// 至少要兩個字才算重疊 — 一個字的巧合太多(副歌的 "Oh" 後面接 "Oh baby" 是兩句真的歌詞)。
function trimOverlap(previousText, text) {
  const before = wordsOf(previousText)
  const after = wordsOf(text)
  for (let k = Math.min(before.length, after.length); k >= 2; k -= 1) {
    if (before.slice(before.length - k).join(' ').toLowerCase() === after.slice(0, k).join(' ').toLowerCase()) {
      return after.slice(k).join(' ')
    }
  }
  return text
}

// YouTube 自動字幕是滾動式的:同一句會先出現半句再出現整句,還會整句重複。
function tidy(cues) {
  const kept = []
  for (const raw of cues) {
    const text = lyricText(raw.text)
    if (!text) continue
    const previous = kept[kept.length - 1]
    if (!previous) {
      kept.push({ ...raw, text })
      continue
    }
    // 1. 這一句完整包含上一句(先出現半句再出現整句)→ 用比較完整的這句取代。
    //    太短的不算:副歌裡一句 "Oh" 後面接 "Oh baby" 是兩句真的歌詞
    if (text === previous.text || (previous.text.length >= 4 && text.startsWith(previous.text))) {
      kept[kept.length - 1] = { start: previous.start, end: Math.max(previous.end, raw.end), text }
      continue
    }
    // 2. 只是開頭跟上一句的尾巴重疊(兩行滾動)→ 把重疊的部分剪掉,只留新的
    const trimmed = trimOverlap(previous.text, text)
    if (!trimmed) continue
    kept.push({ ...raw, text: trimmed })
  }
  return kept
    .map((cue, i) => ({
      ...cue,
      // 字幕的結束時間常常只留一瞬間,至少撐到下一句開始(打字要有時間)
      end: Math.max(cue.end, Math.min(cue.start + MIN_LINE_SECONDS, kept[i + 1] ? kept[i + 1].start : Infinity))
    }))
    .filter((cue) => cue.end > cue.start)
}

// 自動字幕的斷點是「顯示用的兩行視窗」,跟句子無關 —— 一行常常是
// 「…take my hand. Well, me I fall in love with you」:前半是上一句的尾巴,
// 後半是下一句的開頭。照這樣練,每一行都是半截話。
//
// 但不是每首歌都要重切:正常的歌詞字幕一行就是一句歌詞(Heathens 那種),
// 重切反而會把它們黏成一大段。差別很明顯 —— 散文式的自動字幕會有大量
// 「句號出現在行中間」,歌詞字幕幾乎沒有標點。實測 Thinking Out Loud 是
// 33/49 行,Heathens 是 0/41。
const MID_SENTENCE = /[.!?]["')\]]*\s+\S/
const PROSE_RATIO = 0.25
const MAX_LINE_CHARS = 90

function looksLikeProse(lines) {
  if (lines.length < 4) return false
  const broken = lines.filter((line) => MID_SENTENCE.test(line.text)).length
  return broken / lines.length >= PROSE_RATIO
}

// 每個字配一段時間(一行的長度平均分給裡面的字),這樣重切之後還對得上影片
function wordStream(lines) {
  const words = []
  for (const line of lines) {
    const parts = line.text.split(/\s+/).filter(Boolean)
    if (parts.length === 0) continue
    const span = (line.end - line.start) / parts.length
    parts.forEach((word, i) => words.push({ word, start: line.start + i * span, end: line.start + (i + 1) * span }))
  }
  return words
}

// 照句尾標點重新分行;一直沒有標點就在長度上限處斷開
function regroup(words) {
  const lines = []
  let buffer = []
  const flush = () => {
    if (buffer.length === 0) return
    lines.push({
      start: buffer[0].start,
      end: buffer[buffer.length - 1].end,
      text: buffer.map((w) => w.word).join(' ')
    })
    buffer = []
  }
  for (const word of words) {
    buffer.push(word)
    const length = buffer.reduce((sum, w) => sum + w.word.length + 1, -1)
    if (/[.!?]["')\]]*$/.test(word.word) || length >= MAX_LINE_CHARS) flush()
  }
  flush()
  return lines
}

function reflow(lines) {
  return looksLikeProse(lines) ? regroup(wordStream(lines)) : lines
}

// 有些 MV 的字幕整首都是大寫(Believer 就是)。照著打要一直按 Shift,
// 練的是小指不是英文 — 超過七成是大寫就整首轉成正常大小寫。
function deCaps(lines) {
  const shouty = lines.filter((line) => /[A-Z]/.test(line.text) && line.text === line.text.toUpperCase())
  if (lines.length === 0 || shouty.length < lines.length * 0.7) return lines
  return lines.map((line) => {
    const lower = line.text.toLowerCase().replace(/\bi\b/g, 'I').replace(/\bi'/g, "I'")
    return { ...line, text: lower.charAt(0).toUpperCase() + lower.slice(1) }
  })
}

function slugify(text, fallback) {
  const slug = String(text || '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || fallback
}

// [00:12.34] 一行一句的 LRC。結束時間用下一句的開始,最後一句給 4 秒
function parseLrc(source) {
  const lines = []
  for (const raw of String(source).split(/\r?\n/)) {
    const match = LRC_LINE.exec(raw)
    if (!match) continue
    const text = match[2].trim()
    if (!text) continue
    // 一行可以掛好幾個時間(副歌重複),每個都算一句
    for (const [, m, s, ms] of match[1].matchAll(LRC_STAMP)) {
      lines.push({ start: Number(m) * 60 + Number(s) + Number((ms || '0').padEnd(3, '0')) / 1000, text })
    }
  }
  lines.sort((a, b) => a.start - b.start)
  return lines.map((line, i) => ({
    start: line.start,
    end: lines[i + 1] ? lines[i + 1].start : line.start + 4,
    text: line.text
  }))
}

function parseLyrics(source, file = '') {
  return file.toLowerCase().endsWith('.lrc') ? parseLrc(source) : parseCues(source)
}

// 中文字幕對回英文句:取時間重疊最多的那一句
function attachTranslations(lines, zhCues) {
  if (!zhCues || zhCues.length === 0) return lines
  return lines.map((line) => {
    let best = null
    let bestOverlap = 0
    for (const cue of zhCues) {
      const overlap = Math.min(line.end, cue.end) - Math.max(line.start, cue.start)
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        best = cue
      }
    }
    return { ...line, zh: best && bestOverlap > 0.2 ? best.text : '' }
  })
}

// yt-dlp 介面。exec 可以換掉,測試不必真的打 YouTube。
// ⚠️ 一次只跑一支:同時打太多次 YouTube 會回 429,之後每一支都抓不到字幕。
function createYtDlp({
  bin = process.env.YTDLP_PATH || 'yt-dlp',
  timeoutMs = 90_000,
  exec = execFile,
  now = Date.now
} = {}) {
  let queue = Promise.resolve()
  // 被 YouTube 擋過之後的冷卻。繼續猛打只會被擋更久,而且每次都要等 yt-dlp 跑完才知道
  let blockedUntil = 0

  function runNow(args) {
    return new Promise((resolve, reject) => {
      exec(bin, args, { encoding: 'utf8', windowsHide: true, timeout: timeoutMs, maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
        const out = String(stdout || '')
        const detail = String(stderr || '')
        // ⚠️ yt-dlp 抓不到字幕時不一定是非零離開 —— 它會把 429 印在 stderr 然後正常結束。
        // 只看離開碼的話,我們會把「被擋下來」講成「這支影片沒有字幕」(使用者被這個騙了好幾次)
        if (RATE_LIMITED.test(detail) || (err && RATE_LIMITED.test(String(err.message || '')))) {
          blockedUntil = now() + COOLDOWN_MS
          return reject(importError('rate_limited', 'YouTube 暫時擋下請求'))
        }
        if (!err) return resolve({ stdout: out, stderr: detail })
        if (err.code === 'ENOENT') return reject(importError('ytdlp_missing', `找不到 yt-dlp(${bin})`))
        return reject(importError('ytdlp_failed', (detail || err.message).slice(0, 400)))
      })
    })
  }

  // 排隊,前一支失敗不影響下一支
  function run(args) {
    const left = blockedUntil - now()
    if (left > 0) {
      const minutes = Math.ceil(left / 60_000)
      return Promise.reject(importError('rate_limited', `YouTube 還在擋,大約 ${minutes} 分鐘後再試`))
    }
    const result = queue.then(() => runNow(args))
    queue = result.then(
      () => {},
      () => {}
    )
    return result
  }

  const watchUrl = (videoId) => `https://www.youtube.com/watch?v=${videoId}`

  // metadata 和字幕一次問完。
  // 分成兩次呼叫等於每匯入一首就打 YouTube 兩輪,被擋的機率直接翻倍 —— 而被擋之後
  // 連「這支到底有沒有字幕」都查不到,只能給使用者一個看起來像它沒字幕的錯誤。
  async function fetchSong(videoId, langs) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'te-song-'))
    try {
      const { stdout, stderr } = await run([
        '--skip-download',
        '--write-subs',
        '--write-auto-subs',
        '--sub-langs',
        langs,
        '--sub-format',
        'vtt',
        '--no-warnings',
        // ⚠️ --print 會讓 yt-dlp 進入 simulate(只印不寫檔),字幕就永遠抓不到。
        // 這個組合一定要補 --no-simulate
        '--no-simulate',
        // 慢一點打,被擋的機率低很多
        '--sleep-requests',
        '1',
        // 同一趟把影片資訊印出來,順便問「有沒有英文字幕」—— 這樣才分得出
        // 「這支真的沒有」和「有但我們沒抓到」
        '--print',
        '%(title)s|||%(channel)s|||%(playable_in_embed)s|||%(automatic_captions.en.0.ext)s|||%(subtitles.en.0.ext)s',
        '-o',
        path.join(dir, 'sub'),
        '--',
        watchUrl(videoId)
      ])
      const [title, channel, embeddable, autoEn, manualEn] = stdout.trim().split('|||')
      const file = fs.readdirSync(dir).find((name) => name.endsWith('.vtt'))
      return {
        meta: {
          title: title || '',
          channel: channel || '',
          embeddable: embeddable !== 'False',
          // NA = yt-dlp 說這支沒有這個語言的字幕
          hasEnglish: (autoEn && autoEn !== 'NA') || (manualEn && manualEn !== 'NA')
        },
        cues: file ? parseCues(fs.readFileSync(path.join(dir, file), 'utf8')) : [],
        stderr
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  return {
    bin,
    fetchSong,
    get blockedFor() {
      return Math.max(blockedUntil - now(), 0)
    },
    // 中文字幕是額外要的,維持獨立一次(預設不開)
    async subtitles(videoId, langs) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'te-song-'))
      try {
        await run([
          '--skip-download',
          '--write-subs',
          '--write-auto-subs',
          '--sub-langs',
          langs,
          '--sub-format',
          'vtt',
          '--no-warnings',
          '-o',
          path.join(dir, 'sub'),
          '--',
          watchUrl(videoId)
        ])
        const file = fs.readdirSync(dir).find((name) => name.endsWith('.vtt'))
        return file ? parseCues(fs.readFileSync(path.join(dir, file), 'utf8')) : []
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    },
    async meta(videoId) {
      const { meta } = await fetchSong(videoId, EN_LANGS)
      return meta
    }
  }
}

// 原始字幕 → 可以存檔的一首歌。丟出來的錯誤都帶 code,呼叫端好翻成人看得懂的話。
function buildSong({ videoId, meta = {}, cues, zhCues = [], id: wantedId = '', title: wantedTitle = '', artist: wantedArtist = '', level = '' }) {
  if (!YOUTUBE_ID_PATTERN.test(videoId)) throw importError('bad_url', '這不是 YouTube 影片連結')
  if (meta.embeddable === false) throw importError('not_embeddable', '這支影片不能嵌入播放')
  const parsed = splitArtist(cleanTitle(meta.title))
  const title = wantedTitle || parsed.title
  if (!title) throw importError('no_title', '拿不到影片標題')
  const artist = wantedArtist || parsed.artist || (meta.channel || '').trim()
  const lines = attachTranslations(deCaps(reflow(tidy(cues || []))), tidy(zhCues || []))
  if (lines.length === 0) throw importError('no_subtitles', '這支影片沒有可以用的英文字幕')
  return {
    id: slugify(wantedId || title, `yt-${videoId.toLowerCase().replace(/[^a-z0-9]/g, '')}`),
    title,
    artist,
    youtubeId: videoId,
    level,
    lines
  }
}

// 從 YouTube 抓一支回來(會跑 yt-dlp,要花幾秒到幾十秒)
async function importFromYouTube(url, { ytdlp = createYtDlp(), zh = false, level = '' } = {}) {
  const videoId = videoIdOf(url)
  if (!videoId) throw importError('bad_url', '這不是 YouTube 影片連結')
  // 一次把影片資訊和字幕都拿回來
  const { meta, cues } = await ytdlp.fetchSong(videoId, EN_LANGS)
  if (!meta.embeddable) throw importError('not_embeddable', '這支影片不能嵌入播放')
  if (cues.length === 0) {
    // 分清楚是哪一種。以前兩種都說「沒有英文字幕」,使用者就以為是影片的問題,
    // 換一支、再換一支,其實是我們這邊抓不到
    if (meta.hasEnglish) throw importError('subs_fetch_failed', '這支影片有英文字幕,但這次沒抓到 — 稍後再試一次')
    throw importError('no_subtitles', '這支影片沒有英文字幕')
  }
  const zhCues = zh ? await ytdlp.subtitles(videoId, ZH_LANGS).catch(() => []) : []
  return buildSong({ videoId, meta, cues, zhCues, level })
}

module.exports = {
  EN_LANGS,
  ZH_LANGS,
  YOUTUBE_ID_PATTERN,
  videoIdOf,
  cleanTitle,
  splitArtist,
  looksLikeProse,
  reflow,
  lyricText,
  tidy,
  deCaps,
  slugify,
  parseLrc,
  parseLyrics,
  attachTranslations,
  createYtDlp,
  buildSong,
  importFromYouTube,
  importError
}

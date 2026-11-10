#!/usr/bin/env node
// 匯入一首「聽歌練英打」的歌:YouTube 連結 + 逐句歌詞 → data/songs/<id>.json
//
// 用法:
//   node scripts/import-song.js <YouTube 連結或代號> [選項]
//
// 選項:
//   --id <slug>        檔名與網址用的代號,省略就從標題生一個
//   --title "<歌名>"    省略就用 YouTube 的標題
//   --artist "<歌手>"   省略就用 YouTube 的頻道名
//   --level "<標籤>"    難度標籤(初級/中級…),純粹顯示用
//   --lyrics <檔案>     .lrc / .srt / .vtt 的歌詞檔;省略就用 yt-dlp 去抓英文字幕
//   --zh <檔案|auto>    中文翻譯:給檔案,或 auto 讓 yt-dlp 去抓中文字幕
//
// 例:
//   node scripts/import-song.js https://youtu.be/UprcpdwuwCg --level 中級
//   node scripts/import-song.js UprcpdwuwCg --lyrics ./heathens.lrc --title Heathens --artist "twenty one pilots"
//
// 沒給歌詞檔時要有 yt-dlp(自動字幕品質看影片,匯完建議開 data/songs/<id>.json 看一下)。

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { parseCues } = require('../src/vtt')
const { SONG_ID_PATTERN } = require('../src/songs')

const ROOT = path.join(__dirname, '..')
const SONGS_DIR = path.join(ROOT, 'data', 'songs')
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/
const LRC_LINE = /^\s*((?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+)\s*(.*)$/
const LRC_STAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g
const MIN_LINE_SECONDS = 0.6

function die(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

// --flag value 的簡單解析;第一個不是 --flag 的就是影片
function parseArgs(argv) {
  const options = {}
  let video = ''
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      options[arg.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[(i += 1)] : 'true'
    } else if (!video) {
      video = arg
    }
  }
  return { video, options }
}

function videoIdOf(input) {
  const value = String(input || '').trim()
  if (YOUTUBE_ID_PATTERN.test(value)) return value
  const match = value.match(/(?:v=|\/shorts\/|\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  return match ? match[1] : ''
}

// YouTube 標題常帶一堆宣傳標記:[OFFICIAL VIDEO]、(Lyric Video)、(from 某某電影原聲帶)
const PROMO_BRACKET = /\s*\[[^\]]*\]/g
const PROMO_PAREN = /\s*\((?:[^)]*\b(?:official|lyric|lyrics|audio|video|visuali[sz]er|explicit|remaster|hd|4k|mv)\b[^)]*|from [^)]*)\)/gi

function cleanTitle(raw) {
  return String(raw || '')
    .replace(PROMO_BRACKET, '')
    .replace(PROMO_PAREN, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// 「twenty one pilots: Heathens」→ 歌手 + 歌名。頻道名常常是唱片公司,有這個就用這個
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

// 有些 MV 的字幕整首都是大寫(Believer 就是)。照著打要一直按 Shift,
// 練的是小指不是英文 — 超過七成是大寫就整首轉成正常大小寫。
function deCaps(lines) {
  const shouty = lines.filter((line) => /[A-Z]/.test(line.text) && line.text === line.text.toUpperCase())
  if (shouty.length < lines.length * 0.7) return lines
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

function ytDlp(args) {
  try {
    return execFileSync('yt-dlp', args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    die(`yt-dlp 失敗(沒裝就用 --lyrics 給字幕檔):${err.message}`)
    return ''
  }
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

function parseLyricFile(file) {
  const source = fs.readFileSync(file, 'utf8')
  const cues = file.toLowerCase().endsWith('.lrc') ? parseLrc(source) : parseCues(source)
  if (cues.length === 0) die(`${file} 裡沒有讀到任何一句(支援 .lrc / .srt / .vtt)`)
  return cues
}

// YouTube 自動字幕是滾動式的:同一句會先出現半句再出現整句,還會整句重複。
// 這裡把「前一句是後一句的開頭」和完全重複的那些收掉,剩下真正的一句一行。
function tidy(cues) {
  const kept = []
  for (const raw of cues) {
    const text = lyricText(raw.text)
    if (!text) continue
    const cue = { ...raw, text }
    const previous = kept[kept.length - 1]
    // 只有「前一句是後一句的開頭」才算滾動字幕的半句。太短的不算:
    // 副歌裡一句 "Oh" 後面接 "Oh baby" 是兩句真的歌詞,併掉會連時間都被拉回去
    const rolling = previous && (cue.text === previous.text || (previous.text.length >= 4 && cue.text.startsWith(previous.text)))
    if (rolling) {
      kept[kept.length - 1] = { start: previous.start, end: Math.max(previous.end, cue.end), text: cue.text }
      continue
    }
    kept.push({ ...cue })
  }
  return kept
    .map((cue, i) => ({
      ...cue,
      // 字幕的結束時間常常只留一瞬間,至少撐到下一句開始(打字要有時間)
      end: Math.max(cue.end, Math.min(cue.start + MIN_LINE_SECONDS, kept[i + 1] ? kept[i + 1].start : Infinity))
    }))
    .filter((cue) => cue.end > cue.start)
}

// yt-dlp 抓字幕:下載到暫存資料夾,挑第一個讀得到的檔
function fetchSubtitles(videoId, langs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'te-song-'))
  try {
    ytDlp([
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
      `https://www.youtube.com/watch?v=${videoId}`
    ])
    const file = fs.readdirSync(dir).find((name) => name.endsWith('.vtt'))
    return file ? parseCues(fs.readFileSync(path.join(dir, file), 'utf8')) : []
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// 中文字幕對回英文句:取時間重疊最多的那一句
function attachTranslations(lines, zhCues) {
  if (zhCues.length === 0) return lines
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

function main() {
  const { video, options } = parseArgs(process.argv.slice(2))
  const youtubeId = videoIdOf(video)
  if (!youtubeId) {
    process.stderr.write('usage: import-song.js <youtube url or id> [--id slug] [--title "…"] [--artist "…"] [--lyrics file] [--zh file|auto]\n')
    process.exit(2)
  }

  let title = options.title || ''
  let artist = options.artist || ''
  const printed = ytDlp([
    '--no-warnings',
    '--print',
    '%(title)s|||%(channel)s|||%(playable_in_embed)s',
    '--',
    `https://www.youtube.com/watch?v=${youtubeId}`
  ])
  const [ytTitle, ytChannel, embeddable] = printed.trim().split('|||')
  const parsed = splitArtist(cleanTitle(ytTitle))
  title = title || parsed.title
  // 標題裡寫了歌手就用它:頻道名常常是唱片公司(Fueled By Ramen),不是歌手
  artist = artist || parsed.artist || (ytChannel || '').trim()
  if (!title) die('拿不到標題,用 --title 指定')
  // 不能嵌入的影片在站上只會顯示一個「去 YouTube 看」的連結,練不了 — 不如現在就擋下來
  if (embeddable === 'False') die(`這支影片不能嵌入播放(playable_in_embed=False),換一支:${youtubeId}`)

  // 代號要過得了伺服器那一關,不然檔案寫出來了、開機時卻被無聲跳過
  // (日文歌名 slug 會空掉,而 YouTube 代號可能有底線或以 - 開頭)
  const id = slugify(options.id || title, `yt-${youtubeId.toLowerCase().replace(/[^a-z0-9]/g, '')}`)
  if (!SONG_ID_PATTERN.test(id)) die(`代號 "${id}" 伺服器不收(只能 a-z0-9 和 -,開頭不能是 -):用 --id 指定`)
  const target = path.join(SONGS_DIR, `${id}.json`)
  if (fs.existsSync(target) && options.force !== 'true') die(`${target} 已經有了,要覆蓋請加 --force`)

  // 只要英文那幾個 track。寫 en.* 會連 en-fr(法文自動翻成英文)那種都抓下來
  const cues = options.lyrics ? parseLyricFile(options.lyrics) : fetchSubtitles(youtubeId, 'en-orig,en,en-US,en-GB')
  if (cues.length === 0) die('沒有拿到英文歌詞 — 這支影片可能沒有字幕,改用 --lyrics 給 .lrc/.srt 檔')
  let lines = deCaps(tidy(cues))
  // 全部被當成音效/段落標記濾掉的話,寫出去也只是一個開機會被丟掉的檔案
  if (lines.length === 0) die('清理之後一句都不剩(整份都是音效或段落標記?)— 改用 --lyrics 給真的歌詞檔')

  if (options.zh) {
    const zhCues = options.zh === 'auto' ? fetchSubtitles(youtubeId, 'zh-Hant,zh-TW,zh-Hans,zh') : parseLyricFile(options.zh)
    lines = attachTranslations(lines, tidy(zhCues))
  }

  fs.mkdirSync(SONGS_DIR, { recursive: true })
  fs.writeFileSync(target,`${JSON.stringify({ id, title, artist, youtubeId, level: options.level || '', lines }, null, 2)}\n`)
  process.stdout.write(`wrote ${target}\n`)
  process.stdout.write(`${title} — ${artist}: ${lines.length} 句,第一句 "${lines[0].text}"\n`)
  process.stdout.write(`練習網址:/type?id=${id}\n`)
}

main()

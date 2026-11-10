#!/usr/bin/env node
// 匯入一首「聽歌練英打」的歌到公開歌庫:YouTube 連結 + 逐句歌詞 → data/songs/<id>.json
//
// 會員自己貼連結加的歌不走這裡(那條走 POST /api/my-songs,存在 data/songs/users/)。
// 兩邊的清理邏輯是同一份:src/song-import.js。
//
// 用法:
//   node scripts/import-song.js <YouTube 連結或代號> [選項]
//
// 選項:
//   --id <slug>        檔名與網址用的代號,省略就從標題生一個
//   --title "<歌名>"    省略就用 YouTube 的標題(會去掉 [OFFICIAL VIDEO] 這類宣傳標記)
//   --artist "<歌手>"   省略就用標題裡的歌手,再不然用頻道名
//   --level "<標籤>"    難度標籤(初級/中級…),純粹顯示用
//   --lyrics <檔案>     .lrc / .srt / .vtt 的歌詞檔;省略就用 yt-dlp 去抓英文字幕
//   --zh <檔案|auto>    中文翻譯:給檔案,或 auto 讓 yt-dlp 去抓中文字幕
//   --force            覆蓋同代號的歌
//
// 例:
//   node scripts/import-song.js https://youtu.be/UprcpdwuwCg --level 中級
//   node scripts/import-song.js UprcpdwuwCg --lyrics ./heathens.lrc --artist "twenty one pilots"
//
// 沒給歌詞檔時要有 yt-dlp(`YTDLP_PATH` 可以指定完整路徑)。
// 匯完建議開 data/songs/<id>.json 看一下:自動字幕的斷句品質看影片。

const fs = require('node:fs')
const path = require('node:path')
const { SONG_ID_PATTERN } = require('../src/songs')
const { videoIdOf, parseLyrics, createYtDlp, buildSong, EN_LANGS, ZH_LANGS } = require('../src/song-import')

const SONGS_DIR = path.join(__dirname, '..', 'data', 'songs')

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

function readLyricFile(file) {
  const cues = parseLyrics(fs.readFileSync(file, 'utf8'), file)
  if (cues.length === 0) die(`${file} 裡沒有讀到任何一句(支援 .lrc / .srt / .vtt)`)
  return cues
}

async function main() {
  const { video, options } = parseArgs(process.argv.slice(2))
  const videoId = videoIdOf(video)
  if (!videoId) {
    process.stderr.write('usage: import-song.js <youtube url or id> [--id slug] [--title "…"] [--artist "…"] [--lyrics file] [--zh file|auto] [--force]\n')
    process.exit(2)
  }

  const ytdlp = createYtDlp()
  // 字幕自己給的時候仍然要問一次 meta:標題、頻道、還有「這支能不能嵌入」
  const meta = await ytdlp.meta(videoId).catch((err) => {
    if (err.code === 'ytdlp_missing' && options.title && options.lyrics) return { title: options.title, channel: '', embeddable: true }
    die(`yt-dlp 失敗:${err.message}`)
  })

  const cues = options.lyrics ? readLyricFile(options.lyrics) : await ytdlp.subtitles(videoId, EN_LANGS).catch((err) => die(`抓字幕失敗:${err.message}`))
  const zhCues = !options.zh
    ? []
    : options.zh === 'auto'
      ? await ytdlp.subtitles(videoId, ZH_LANGS).catch(() => [])
      : readLyricFile(options.zh)

  let song
  try {
    song = buildSong({
      videoId,
      meta,
      cues,
      zhCues,
      id: options.id || '',
      title: options.title || '',
      artist: options.artist || '',
      level: options.level || ''
    })
  } catch (err) {
    // 不能嵌入的影片在站上只會顯示一個「去 YouTube 看」的連結,練不了 — 現在就擋下來
    die(`${err.message}(${err.code})`)
  }

  // 代號要過得了伺服器那一關,不然檔案寫出來了、開機時卻被無聲跳過
  if (!SONG_ID_PATTERN.test(song.id)) die(`代號 "${song.id}" 伺服器不收(只能 a-z0-9 和 -,開頭不能是 -):用 --id 指定`)
  const target = path.join(SONGS_DIR, `${song.id}.json`)
  if (fs.existsSync(target) && options.force !== 'true') die(`${target} 已經有了,要覆蓋請加 --force`)

  fs.mkdirSync(SONGS_DIR, { recursive: true })
  fs.writeFileSync(target, `${JSON.stringify(song, null, 2)}\n`)
  process.stdout.write(`wrote ${target}\n`)
  process.stdout.write(`${song.title} — ${song.artist}: ${song.lines.length} 句,第一句 "${song.lines[0].text}"\n`)
  process.stdout.write(`練習網址:/type?id=${song.id}\n`)
}

main().catch((err) => die(err.stack || err.message))

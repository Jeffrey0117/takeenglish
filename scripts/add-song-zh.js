#!/usr/bin/env node
// 幫已經匯入的歌補上中文字幕(YouTube 的繁體中文字幕,多半是自動翻譯)。
// 新加的歌匯入時就會順便抓,這支是給「以前加的」用的。
//
// 用法:
//   node scripts/add-song-zh.js --all            公開歌庫 + 所有會員自己加的歌
//   node scripts/add-song-zh.js <檔案> [<檔案>…]   指定幾首
//   加 --force 連已經有中文的也重抓
//
// 公開歌庫是開機讀進記憶體的,補完要重啟才看得到;會員自己加的歌每次重讀,馬上生效。
// 一首一首慢慢抓:打太快 YouTube 會擋(429),一被擋就整批停下來。

const fs = require('node:fs')
const path = require('node:path')
const { createYtDlp, attachTranslations, tidy } = require('../src/song-import')

const SONGS_DIR = path.join(__dirname, '..', 'data', 'songs')
const PAUSE_MS = 4000

function jsonFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => path.join(dir, name))
  } catch {
    return []
  }
}

function allSongFiles() {
  const usersDir = path.join(SONGS_DIR, 'users')
  let owners = []
  try {
    owners = fs.readdirSync(usersDir)
  } catch {
    owners = []
  }
  return [...jsonFiles(SONGS_DIR), ...owners.flatMap((owner) => jsonFiles(path.join(usersDir, owner)))]
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const files = args.includes('--all') ? allSongFiles() : args.filter((arg) => !arg.startsWith('--'))
  if (files.length === 0) {
    process.stderr.write('usage: add-song-zh.js --all | <song.json> [...] [--force]\n')
    process.exit(2)
  }

  const ytdlp = createYtDlp()
  let fetched = 0
  for (const file of files) {
    const song = JSON.parse(fs.readFileSync(file, 'utf8'))
    const lines = Array.isArray(song.lines) ? song.lines : []
    if (!force && lines.some((line) => line.zh)) {
      process.stdout.write(`skip  ${file}(已經有中文)\n`)
      continue
    }
    if (fetched > 0) await wait(PAUSE_MS)
    fetched += 1
    let cues = []
    try {
      cues = tidy(await ytdlp.translations(song.youtubeId))
    } catch (err) {
      process.stderr.write(`fail  ${file}:${err.message}\n`)
      // 被擋了就別再打,剩下的下次再跑
      if (err.code === "zh_rate_limited" || err.code === "rate_limited") process.exit(1)
      continue
    }
    if (cues.length === 0) {
      process.stdout.write(`none  ${file}(這支沒有中文字幕)\n`)
      continue
    }
    const merged = attachTranslations(lines, cues)
    const hit = merged.filter((line) => line.zh).length
    fs.writeFileSync(file, `${JSON.stringify({ ...song, lines: merged }, null, 2)}\n`)
    process.stdout.write(`wrote ${file}:${hit}/${merged.length} 句有中文\n`)
  }
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`)
  process.exit(1)
})

#!/usr/bin/env node
// 匯入一集的整集台詞(.srt 或 .vtt 字幕檔),看劇區那一集就會出現「整集台詞」。
//
// 用法:
//   node scripts/import-episode-subtitles.js <show-id> <季> <集> <字幕檔路徑>
// 例:
//   node scripts/import-episode-subtitles.js brooklyn-nine-nine 5 1 ./b99-s05e01.srt
//
// 輸出到 data/transcripts/<show-id>/s05e01.json。這個資料夾不進版控(字幕是別人的著作),
// 所以要在跑站的那台主機上執行;不用重新部署,匯入完重新整理頁面就有。

const fs = require('node:fs')
const path = require('node:path')
const { parseCues } = require('../src/vtt')
const { createTranscriptLibrary } = require('../src/transcripts')
const { createShowLibrary } = require('../src/shows')

const ROOT = path.join(__dirname, '..')

function main() {
  const [showId, seasonArg, episodeArg, file] = process.argv.slice(2)
  const season = Number.parseInt(seasonArg, 10)
  const episode = Number.parseInt(episodeArg, 10)
  const library = createTranscriptLibrary({ dir: path.join(ROOT, 'data', 'transcripts') })
  const target = library.fileFor(showId || '', season, episode)
  if (!target || !file) {
    process.stderr.write('usage: import-episode-subtitles.js <show-id> <season> <episode> <subtitle file>\n')
    process.exit(2)
  }
  const shows = createShowLibrary({ dir: path.join(ROOT, 'data', 'shows') })
  const known = shows.season(showId, season)
  if (!known || !known.episodes.some((ep) => ep.number === episode)) {
    process.stderr.write(`no such episode in the watch area: ${showId} season ${season} episode ${episode}\n`)
    process.stderr.write('import the season first with scripts/import-wiki-season.js\n')
    process.exit(1)
  }

  const cues = parseCues(fs.readFileSync(file, 'utf8'))
  if (cues.length === 0) {
    process.stderr.write(`no subtitle lines found in ${file} (expected .srt or .vtt)\n`)
    process.exit(1)
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify({ show: showId, season, episode, cues }))
  process.stdout.write(`wrote ${target}\n`)
  process.stdout.write(`lines: ${cues.length}; first: "${cues[0].text}"\n`)
}

main()

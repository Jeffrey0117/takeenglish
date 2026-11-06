const fs = require('node:fs')
const path = require('node:path')

const SHOW_ID_PATTERN = /^[a-z0-9-]{1,80}$/
const SEASON_FILE_PATTERN = /^season-(\d{1,3})\.json$/

// 看劇區的資料:data/shows/<劇>/season-<季>.json(由 scripts/import-wiki-season.js 產生)。
// 啟動時讀進記憶體;檔案壞掉的那一季跳過並記一筆,不要讓整個站起不來。
function createShowLibrary({
  dir,
  onError = (err) => process.stderr.write(`[shows] ${err.message}\n`)
} = {}) {
  const shows = new Map()

  if (dir && fs.existsSync(dir)) {
    for (const showId of fs.readdirSync(dir).sort()) {
      const showDir = path.join(dir, showId)
      let files
      try {
        if (!SHOW_ID_PATTERN.test(showId) || !fs.statSync(showDir).isDirectory()) continue
        files = fs.readdirSync(showDir).sort()
      } catch (err) {
        onError(new Error(`${showId}: ${err.message}`))
        continue
      }
      for (const file of files) {
        const match = SEASON_FILE_PATTERN.exec(file)
        if (!match) continue
        try {
          const data = JSON.parse(fs.readFileSync(path.join(showDir, file), 'utf8'))
          const valid =
            data.show &&
            data.show.title &&
            Array.isArray(data.episodes) &&
            data.episodes.every((ep) => ep && typeof ep === 'object')
          if (!valid) throw new Error('missing show title or episodes')
          const entry = shows.get(showId) || { id: showId, title: data.show.title, seasons: new Map() }
          entry.seasons.set(Number(match[1]), data)
          shows.set(showId, entry)
        } catch (err) {
          onError(new Error(`${showId}/${file}: ${err.message}`))
        }
      }
    }
  }

  // 首頁用:每部劇有哪幾季、各幾集、哪年播
  function list() {
    return [...shows.values()].map((show) => ({
      id: show.id,
      title: show.title,
      seasons: [...show.seasons.entries()]
        .sort(([a], [b]) => a - b)
        .map(([season, data]) => ({
          season,
          episodes: data.episodes.length,
          firstAired: data.episodes[0] ? data.episodes[0].airDate : '',
          lastAired: data.episodes.length ? data.episodes[data.episodes.length - 1].airDate : ''
        }))
    }))
  }

  function season(showId, number) {
    const show = shows.get(showId)
    return (show && show.seasons.get(number)) || null
  }

  return { list, season }
}

module.exports = { createShowLibrary }

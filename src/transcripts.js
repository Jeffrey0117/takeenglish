const fs = require('node:fs')
const path = require('node:path')

const SHOW_ID_PATTERN = /^[a-z0-9-]{1,80}$/
const MAX_CACHED = 20

function pad(value) {
  return String(value).padStart(2, '0')
}

// 整集台詞(scripts/import-episode-subtitles.js 匯入的)。
// 放在 data/transcripts/<劇>/s05e01.json,這個資料夾不進版控:字幕檔是別人的著作,只留在主機上。
function createTranscriptLibrary({ dir } = {}) {
  const cache = new Map()

  function fileFor(showId, season, episode) {
    if (!dir || !SHOW_ID_PATTERN.test(showId) || !Number.isInteger(season) || !Number.isInteger(episode)) return null
    return path.join(dir, showId, `s${pad(season)}e${pad(episode)}.json`)
  }

  function has(showId, season, episode) {
    const file = fileFor(showId, season, episode)
    return Boolean(file) && fs.existsSync(file)
  }

  // 回 [{ start, end, text }] 或 null
  function get(showId, season, episode) {
    const file = fileFor(showId, season, episode)
    if (!file) return null
    let mtime
    try {
      mtime = fs.statSync(file).mtimeMs
    } catch {
      return null
    }
    const hit = cache.get(file)
    if (hit && hit.mtime === mtime) return hit.cues
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'))
      const cues = (Array.isArray(data.cues) ? data.cues : []).filter(
        (cue) => cue && typeof cue.text === 'string' && Number.isFinite(cue.start) && Number.isFinite(cue.end)
      )
      cache.delete(file)
      if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value)
      cache.set(file, { mtime, cues })
      return cues
    } catch {
      return null
    }
  }

  return { has, get, fileFor }
}

module.exports = { createTranscriptLibrary }

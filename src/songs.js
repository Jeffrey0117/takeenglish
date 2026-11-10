const fs = require('node:fs')
const path = require('node:path')

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/
// YouTube 影片代號固定 11 碼。只認這個格式,不然等於讓資料檔決定 iframe 的網址
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/
const MAX_LINES = 400
const MAX_TEXT = 200

function fail(res, status, error) {
  res.set('Cache-Control', 'no-store')
  return res.status(status).json({ success: false, error })
}

function text(value, max = MAX_TEXT) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

// 一首歌的逐句歌詞 → 站台要的樣子。時間壞掉、空白的句子直接丟掉,照開始時間排序。
function normalizeLines(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((line) => ({
      start: Number(line && line.start),
      end: Number(line && line.end),
      text: text(line && line.text),
      zh: text(line && line.zh)
    }))
    .filter((line) => Number.isFinite(line.start) && Number.isFinite(line.end) && line.end > line.start && line.text)
    .sort((a, b) => a.start - b.start)
    .slice(0, MAX_LINES)
    // 歌庫是開機讀進來的共用資料,每個請求拿到的是同一批物件。
    // 凍起來,哪天有人想在 present() 裡改一句(像 lessons 清空 zh 那樣),會當場炸而不是污染全站
    .map((line) => Object.freeze(line))
}

function normalizeSong(raw, id) {
  if (!raw || typeof raw !== 'object') return null
  if (!ID_PATTERN.test(id)) return null
  const youtubeId = typeof raw.youtubeId === 'string' ? raw.youtubeId : ''
  if (!YOUTUBE_ID_PATTERN.test(youtubeId)) return null
  const lines = normalizeLines(raw.lines)
  if (lines.length === 0) return null
  return {
    id,
    title: text(raw.title) || id,
    artist: text(raw.artist),
    youtubeId,
    // 難度只是給人看的標籤,沒這個值就不顯示
    level: text(raw.level, 20),
    lines
  }
}

// 聽歌練英打的歌庫:data/songs/<id>.json。跟看劇區一樣開機時讀進記憶體,
// 壞掉的那一首跳過並記一筆,不要讓整個站起不來。
function createSongLibrary({
  dir,
  onError = (err) => process.stderr.write(`[songs] ${err.message}\n`)
} = {}) {
  const songs = new Map()

  if (dir && fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir).sort()) {
      if (!file.endsWith('.json')) continue
      const id = file.slice(0, -5)
      try {
        const song = normalizeSong(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')), id)
        if (!song) throw new Error('missing youtubeId / lines, or bad id')
        songs.set(id, song)
      } catch (err) {
        onError(new Error(`${file}: ${err.message}`))
      }
    }
  }

  // 歌庫封面直接用 YouTube 的縮圖:影片本來就是從 YouTube 嵌進來的,沒什麼好藏的
  function summary(song) {
    return {
      id: song.id,
      title: song.title,
      artist: song.artist,
      level: song.level,
      lines: song.lines.length,
      duration: Math.round(song.lines[song.lines.length - 1].end),
      thumb: `https://i.ytimg.com/vi/${song.youtubeId}/hqdefault.jpg`
    }
  }

  return {
    get enabled() {
      return songs.size > 0
    },
    list: () => [...songs.values()].map(summary),
    get: (id) => (ID_PATTERN.test(String(id || '')) ? songs.get(id) || null : null),
    count: () => songs.size
  }
}

// 誰能練由 plans 決定:typing = 進不進得去(訪客不行),typingLines = 這首歌開放幾句。
// 鎖住的句子連內容都不送出去 — 跟搜尋結果一樣,F12 看不到多的。
function mountSongRoutes(app, { songs, viewer, plans, limiter, clientIp }) {
  function tooMany(req, res, bucket, max) {
    if (limiter.check(`${bucket}:${clientIp(req)}`, max).allowed) return false
    res.set('Retry-After', '30')
    fail(res, 429, 'too_many_requests')
    return true
  }

  function present(song, user, tier) {
    const typing = plans.can(tier, 'typing')
    const limit = typing ? plans.quota(tier, 'typingLines') : 0
    // null = 不限,數字 = 前幾句,其他(例如未知的等級讓 paywall-kit 回 false)一律一句都不給
    const visible = limit === null ? song.lines : typeof limit === 'number' ? song.lines.slice(0, limit) : []
    const lastVisible = visible[visible.length - 1]
    return {
      id: song.id,
      title: song.title,
      artist: song.artist,
      youtubeId: song.youtubeId,
      level: song.level,
      tier,
      signedIn: Boolean(user),
      typing,
      totalLines: song.lines.length,
      lockedLines: song.lines.length - visible.length,
      // 影片播到這裡就是牆。取「最後一句開放的句子唱完」而不是「第一句鎖住的句子開始」—
      // 歌詞兩句常常首尾相接(end === 下一句 start),用後者的話牆會在他還在打最後那句時就蓋上來
      lockedFrom: visible.length < song.lines.length
        ? Math.max(song.lines[visible.length].start, lastVisible ? lastVisible.end : 0)
        : null,
      lines: visible
    }
  }

  app.get('/api/songs', (req, res) => {
    if (tooMany(req, res, 'songs', 120)) return
    res.set('Cache-Control', 'public, max-age=300')
    return res.json({ success: true, data: { items: songs.list() } })
  })

  app.get('/api/songs/:id', async (req, res) => {
    if (tooMany(req, res, 'songs', 120)) return
    const song = songs.get(req.params.id)
    if (!song) return fail(res, 404, 'song_not_found')
    const { user, tier } = await viewer(req)
    res.set('Cache-Control', 'no-store')
    return res.json({ success: true, data: present(song, user, tier) })
  })
}

module.exports = { createSongLibrary, mountSongRoutes, SONG_ID_PATTERN: ID_PATTERN }

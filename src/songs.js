const fs = require('node:fs')
const path = require('node:path')
const { blanksForLines } = require('./song-blanks')

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

// 會員自己貼連結加的歌:data/songs/users/<owner>/<id>.json。
// 跟公開歌庫分開放,一來不會互相蓋到,二來誰加的就只有誰看得到。
const OWNER_PATTERN = /^te-[A-Za-z0-9_-]{1,80}$/
const MAX_PER_USER = 50

function createUserSongs({ dir } = {}) {
  const ok = (owner, id) => Boolean(dir) && OWNER_PATTERN.test(owner) && ID_PATTERN.test(id)
  const folder = (owner) => path.join(dir, owner)
  const fileFor = (owner, id) => path.join(folder(owner), `${id}.json`)

  function read(owner, id) {
    if (!ok(owner, id)) return null
    try {
      return normalizeSong(JSON.parse(fs.readFileSync(fileFor(owner, id), 'utf8')), id)
    } catch {
      return null
    }
  }

  function list(owner) {
    if (!dir || !OWNER_PATTERN.test(owner)) return []
    let files = []
    try {
      files = fs.readdirSync(folder(owner)).filter((name) => name.endsWith('.json')).sort()
    } catch {
      return []
    }
    return files.map((name) => read(owner, name.slice(0, -5))).filter(Boolean)
  }

  return {
    get enabled() {
      return Boolean(dir)
    },
    list,
    get: read,
    count: (owner) => list(owner).length,
    has: (owner, id) => Boolean(read(owner, id)),
    // 同一首重複加就覆蓋(重新抓一次字幕是合理的意圖),回存好的那首
    save(owner, song) {
      if (!ok(owner, song.id)) return null
      fs.mkdirSync(folder(owner), { recursive: true })
      fs.writeFileSync(fileFor(owner, song.id), `${JSON.stringify(song, null, 2)}\n`)
      return read(owner, song.id)
    },
    remove(owner, id) {
      if (!ok(owner, id)) return false
      try {
        fs.unlinkSync(fileFor(owner, id))
        return true
      } catch {
        return false
      }
    },
    full: MAX_PER_USER
  }
}

// 誰能練由 plans 決定:typing = 進不進得去(訪客不行),typingLines = 這首歌開放幾句。
// 鎖住的句子連內容都不送出去 — 跟搜尋結果一樣,F12 看不到多的。
function mountSongRoutes(app, { songs, viewer, plans, limiter, clientIp, mySongs = createUserSongs(), importer = null, usage = null, dictionary = null }) {
  // 挖空候選算一次就好(同一個 song 物件會重複拿到);會員自己的歌每次重讀,就每次算
  const blankCache = new WeakMap()
  function blanksOf(song) {
    if (!blankCache.has(song)) blankCache.set(song, blanksForLines(song.lines, dictionary))
    return blankCache.get(song)
  }
  function tooMany(req, res, bucket, max) {
    if (limiter.check(`${bucket}:${clientIp(req)}`, max).allowed) return false
    res.set('Retry-After', '30')
    fail(res, 429, 'too_many_requests')
    return true
  }

  // own = 會員自己貼連結加進來的歌。他自己的東西不切句數(牆擺在「一天能加幾支」,
  // 不是「自己加的歌只能練一半」—— 跟影片學習的「我的影片」同一個規矩)
  function present(song, user, tier, own = false) {
    const typing = plans.can(tier, 'typing')
    const limit = own ? null : typing ? plans.quota(tier, 'typingLines') : 0
    // null = 不限,數字 = 前幾句,其他(例如未知的等級讓 paywall-kit 回 false)一律一句都不給
    const visible = limit === null ? song.lines : typeof limit === 'number' ? song.lines.slice(0, limit) : []
    const lastVisible = visible[visible.length - 1]
    // 每一句附上「挖哪幾個字」的候選位置(難的排前面),前端決定要用幾個
    const candidates = blanksOf(song)
    return {
      id: song.id,
      title: song.title,
      artist: song.artist,
      youtubeId: song.youtubeId,
      level: song.level,
      tier,
      signedIn: Boolean(user),
      typing: own ? true : typing,
      own,
      totalLines: song.lines.length,
      lockedLines: song.lines.length - visible.length,
      // 影片播到這裡就是牆。取「最後一句開放的句子唱完」而不是「第一句鎖住的句子開始」—
      // 歌詞兩句常常首尾相接(end === 下一句 start),用後者的話牆會在他還在打最後那句時就蓋上來
      lockedFrom: visible.length < song.lines.length
        ? Math.max(song.lines[visible.length].start, lastVisible ? lastVisible.end : 0)
        : null,
      lines: visible.map((line, index) => ({ ...line, blanks: candidates[index] || [] }))
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

  // ---- 會員自己貼 YouTube 連結加的歌 ----

  // 一個人一把鑰匙。用 sub(LetMeUse 的使用者代號)而不是 email:換了信箱還是同一個人
  const ownerOf = (user) => `te-${String(user.sub || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)}`

  const canImport = () => Boolean(importer && mySongs.enabled)

  function summaryOf(song) {
    return {
      id: song.id,
      title: song.title,
      artist: song.artist,
      level: song.level,
      lines: song.lines.length,
      duration: Math.round(song.lines[song.lines.length - 1].end),
      thumb: `https://i.ytimg.com/vi/${song.youtubeId}/hqdefault.jpg`,
      own: true
    }
  }

  app.get('/api/my-songs', async (req, res) => {
    if (!canImport()) return fail(res, 503, 'import_unavailable')
    const { user, tier } = await viewer(req)
    if (!user) return fail(res, 401, 'unauthorized')
    if (tooMany(req, res, 'my-songs', 120)) return
    const limit = plans.quota(tier, 'songUpload')
    const owner = ownerOf(user)
    const quota = usage ? usage.check(user.sub, '', limit) : { used: 0, limit }
    res.set('Cache-Control', 'no-store')
    return res.json({
      success: true,
      data: {
        canAdd: limit === null || limit > 0,
        used: quota.used,
        limit,
        items: mySongs.list(owner).map(summaryOf)
      }
    })
  })

  app.post('/api/my-songs', async (req, res) => {
    if (!canImport()) return fail(res, 503, 'import_unavailable')
    const { user, tier } = await viewer(req)
    if (!user) return fail(res, 401, 'unauthorized')
    const limit = plans.quota(tier, 'songUpload')
    // 這個等級根本不能加(訪客/未知等級):402,不是 429
    if (limit !== null && limit <= 0) return fail(res, 402, 'upgrade_required')
    // 跑 yt-dlp 要花錢(時間)也會被 YouTube 盯,限得比讀取嚴格得多
    if (tooMany(req, res, 'my-songs-add', 10)) return

    const url = typeof (req.body && req.body.url) === 'string' ? req.body.url.trim() : ''
    if (!url || url.length > 500) return fail(res, 400, 'bad_url')

    const owner = ownerOf(user)
    if (mySongs.count(owner) >= mySongs.full) return fail(res, 409, 'library_full')

    // 先看額度夠不夠(真的加成功才扣)
    const ticket = usage ? usage.check(user.sub, url, limit) : { allowed: true, used: 0, limit }
    if (!ticket.allowed) {
      res.set('Cache-Control', 'no-store')
      return res.status(429).json({ success: false, error: 'daily_limit', limit: ticket.limit })
    }

    let song
    try {
      song = await importer(url)
    } catch (err) {
      const known = ['bad_url', 'not_embeddable', 'no_subtitles', 'thin_subtitles', 'subs_fetch_failed', 'rate_limited', 'no_title']
      if (known.includes(err.code)) {
        res.set('Cache-Control', 'no-store')
        // 被擋/抓失敗是我們這邊的問題,不是使用者貼錯 → 503,而且把還要等多久帶回去
        const ours = err.code === 'rate_limited' || err.code === 'subs_fetch_failed'
        return res.status(ours ? 503 : 400).json({ success: false, error: err.code, detail: err.message })
      }
      process.stderr.write(`[songs] import failed: ${err.code || ''} ${err.message}\n`)
      return fail(res, 502, 'import_failed')
    }

    const saved = mySongs.save(owner, song)
    if (!saved) return fail(res, 500, 'save_failed')
    if (usage) usage.consume(user.sub, url, limit)
    res.set('Cache-Control', 'no-store')
    return res.json({ success: true, data: summaryOf(saved) })
  })

  app.get('/api/my-songs/:id', async (req, res) => {
    if (!canImport()) return fail(res, 503, 'import_unavailable')
    const { user, tier } = await viewer(req)
    if (!user) return fail(res, 401, 'unauthorized')
    if (tooMany(req, res, 'songs', 120)) return
    const song = mySongs.get(ownerOf(user), req.params.id)
    if (!song) return fail(res, 404, 'song_not_found')
    res.set('Cache-Control', 'no-store')
    return res.json({ success: true, data: present(song, user, tier, true) })
  })

  app.post('/api/my-songs/:id/delete', async (req, res) => {
    if (!canImport()) return fail(res, 503, 'import_unavailable')
    const { user } = await viewer(req)
    if (!user) return fail(res, 401, 'unauthorized')
    if (tooMany(req, res, 'my-songs', 120)) return
    if (!mySongs.remove(ownerOf(user), req.params.id)) return fail(res, 404, 'song_not_found')
    res.set('Cache-Control', 'no-store')
    return res.json({ success: true, data: { removed: req.params.id } })
  })
}

module.exports = { createSongLibrary, createUserSongs, mountSongRoutes, SONG_ID_PATTERN: ID_PATTERN }

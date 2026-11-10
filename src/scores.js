const fs = require('node:fs')
const path = require('node:path')

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/
const OWNER_PATTERN = /^te-[A-Za-z0-9_-]{1,80}$/
const MAX_HISTORY = 200
const BOARD_SIZE = 50
// 成績是前端送上來的,所以上限不是「世界紀錄」而是「超過這個數字就當它在亂報」
const MAX_WPM = 220
const MAX_LINES = 400
const MAX_SECONDS = 3 * 3600
// 一句最少要花這麼久 —— 整輪時間比這個還短就是沒在打字
const MIN_SECONDS_PER_LINE = 0.8
const MIN_CLEARED = 3

function text(value, max) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// 排行榜上要顯示的名字。email 絕對不能整個露出來 —— 那是排行榜最容易外洩個資的地方。
//
// ⚠️ 不能只看 email 欄位:LetMeUse 的 Google / GitHub 登入在對方沒有顯示名稱時,
// 會直接把 displayName 設成信箱(oauth.ts 的 `data.name ?? data.email`),而密碼註冊的
// 「顯示名稱」是自由輸入,很多人就填信箱。所以暱稱裡有 @ 就一律當信箱遮掉。
// 截斷要放在判斷之後 —— 先截的話長信箱會被切成沒有 @ 的 local part 直接露出去
function displayName({ name = '', email = '' } = {}) {
  const nick = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : ''
  if (nick && !nick.includes('@')) return nick.slice(0, 24)
  const local = text(nick.includes('@') ? nick : email, 64).split('@')[0]
  if (local.length >= 2) return `${local.slice(0, 2)}***`
  if (local.length === 1) return `${local}***`
  return '匿名'
}

// 分數:速度 × 精準 × 打了多少。只比 WPM 的話,打 3 句就跑的人會贏打完整首的人
function pointsOf({ wpm, accuracy, cleared }) {
  return Math.round(wpm * (accuracy / 100) * cleared)
}

// 前端送來的東西 → 可以存的一筆。不合理就回 null(整筆不收)
function normalizeRun(raw, now) {
  if (!raw || typeof raw !== 'object') return null
  const songId = text(raw.songId, 80)
  if (!ID_PATTERN.test(songId)) return null
  const wpm = num(raw.wpm)
  const accuracy = num(raw.accuracy)
  const cleared = num(raw.cleared)
  const total = num(raw.total)
  const seconds = num(raw.seconds)
  const peeked = num(raw.peeked) || 0
  if (wpm === null || accuracy === null || cleared === null || total === null || seconds === null) return null
  if (wpm <= 0 || wpm > MAX_WPM) return null
  if (accuracy < 0 || accuracy > 100) return null
  if (!Number.isInteger(cleared) || cleared < MIN_CLEARED) return null
  if (!Number.isInteger(total) || total < cleared || total > MAX_LINES) return null
  if (seconds < cleared * MIN_SECONDS_PER_LINE || seconds > MAX_SECONDS) return null
  if (peeked < 0 || peeked > total) return null
  const run = {
    songId,
    own: raw.own === true,
    title: text(raw.title, 120) || songId,
    artist: text(raw.artist, 120),
    wpm: Math.round(wpm),
    accuracy: Math.round(accuracy),
    cleared,
    total,
    peeked: Math.round(peeked),
    seconds: Math.round(seconds),
    at: new Date(now()).toISOString()
  }
  return { ...run, points: pointsOf(run) }
}

// 一輪一輪的成績:個人歷史放 users/<owner>.json,每首歌的排行榜放 songs/<id>.json。
// 跟歌庫一樣是純檔案 —— 不需要資料庫,部署不會刪未追蹤的檔案,所以上線後還在。
function createScores({
  dir,
  now = Date.now,
  maxHistory = MAX_HISTORY,
  boardSize = BOARD_SIZE,
  onError = (err) => process.stderr.write(`[scores] ${err.message}\n`)
} = {}) {
  const userFile = (owner) => path.join(dir, 'users', `${owner}.json`)
  const songFile = (songId) => path.join(dir, 'songs', `${songId}.json`)

  function readJson(file, fallback) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      return parsed && typeof parsed === 'object' ? parsed : fallback
    } catch {
      // 檔案不在、或壞掉(寫到一半斷電)→ 當成沒有成績。這不該讓頁面掛掉
      return fallback
    }
  }

  // 先寫暫存再 rename:中途掛掉不會留下半個 JSON 把使用者的歷史弄壞
  // ⚠️ 單一程序才成立:add() 全程同步,所以讀-改-寫在這個行程裡是原子的。
  // PM2 改成 cluster 模式的話,排行榜更新會變成覆蓋式競爭(暫存檔名也只用 pid 區分)
  function writeJson(file, value) {
    // 檔名都已經過 ID/OWNER 正規式,這一行是最後一道保險:寫出去的位置一定在 dir 底下
    if (!path.resolve(file).startsWith(path.resolve(dir))) throw new Error('refusing to write outside the scores dir')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
    fs.renameSync(tmp, file)
  }

  // 只收長得像一筆成績的元素:檔案被手改壞的時候,bests() 不該因為一個 null 就 500
  const sane = (list) => (Array.isArray(list) ? list : []).filter((row) => row && typeof row === 'object')

  const runsOf = (owner) => sane(readJson(userFile(owner), { runs: [] }).runs)
  const rowsOf = (songId) => sane(readJson(songFile(songId), { rows: [] }).rows)

  // 分數高的在前;同分比正確率,再同就比誰先打到的
  const better = (a, b) => b.points - a.points || b.accuracy - a.accuracy || String(a.at).localeCompare(String(b.at))

  function board(songId, limit = boardSize) {
    if (!ID_PATTERN.test(String(songId))) return []
    return rowsOf(songId)
      .slice()
      .sort(better)
      .slice(0, limit)
      // owner 是內部用來「一個人只占一列」的鍵,不對外
      .map(({ owner, ...row }) => row)
  }

  function add(owner, raw, who = {}) {
    if (!dir || !OWNER_PATTERN.test(String(owner))) return { recorded: false }
    const run = normalizeRun(raw, now)
    if (!run) return { recorded: false }

    // 磁碟寫不進去(ENOSPC、權限、Windows 上防毒剛好咬著檔案)→ 回「沒記下來」,
    // 不要讓整個端點 500。成績存不上是小事,成績面板壞掉才是大事
    try {
      writeJson(userFile(owner), { runs: [run, ...runsOf(owner)].slice(0, maxHistory) })
    } catch (err) {
      onError(new Error(`write history failed: ${err.message}`))
      return { recorded: false }
    }

    // 自己貼連結加的歌不進公開榜:那首歌只有他有,榜上只會是他自己跟自己比
    if (run.own) return { recorded: true, run, rank: null }

    const name = displayName(who)
    const mine = { owner, name, wpm: run.wpm, accuracy: run.accuracy, cleared: run.cleared, total: run.total, points: run.points, at: run.at }
    const existing = rowsOf(run.songId)
    const previous = existing.find((row) => row.owner === owner)
    // 一個人只占一列:只有打得比自己以前好才換掉那一列
    const row = previous && previous.points >= mine.points ? { ...previous, name } : mine
    const rows = [...existing.filter((entry) => entry.owner !== owner), row].sort(better).slice(0, boardSize)
    try {
      writeJson(songFile(run.songId), { rows })
    } catch (err) {
      // 個人歷史已經寫進去了,所以這一輪算有記錄,只是沒上榜
      onError(new Error(`write board failed: ${err.message}`))
      return { recorded: true, run, rank: null }
    }
    const index = rows.findIndex((entry) => entry.owner === owner)
    return { recorded: true, run, rank: index === -1 ? null : index + 1 }
  }

  function history(owner, limit = maxHistory) {
    if (!dir || !OWNER_PATTERN.test(String(owner))) return []
    return runsOf(owner).slice(0, limit)
  }

  // 每首歌我自己的最佳:songId → 那一輪
  function bests(owner) {
    const out = {}
    for (const run of history(owner)) {
      const current = out[run.songId]
      if (!current || run.points > current.points) out[run.songId] = run
    }
    return out
  }

  return { add, history, bests, board, displayName, pointsOf }
}

module.exports = { createScores, displayName, pointsOf }

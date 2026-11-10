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

// 排行榜上要顯示的名字。email 絕對不能整個露出來 —— 那是排行榜最容易外洩個資的地方
function displayName({ name = '', email = '' } = {}) {
  const nick = text(name, 24)
  if (nick) return nick
  const local = text(email, 64).split('@')[0]
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
function createScores({ dir, now = Date.now, maxHistory = MAX_HISTORY, boardSize = BOARD_SIZE } = {}) {
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
  function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
    fs.renameSync(tmp, file)
  }

  const runsOf = (owner) => {
    const data = readJson(userFile(owner), { runs: [] })
    return Array.isArray(data.runs) ? data.runs : []
  }

  const rowsOf = (songId) => {
    const data = readJson(songFile(songId), { rows: [] })
    return Array.isArray(data.rows) ? data.rows : []
  }

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

    writeJson(userFile(owner), { runs: [run, ...runsOf(owner)].slice(0, maxHistory) })

    // 自己貼連結加的歌不進公開榜:那首歌只有他有,榜上只會是他自己跟自己比
    if (run.own) return { recorded: true, run, rank: null }

    const name = displayName(who)
    const mine = { owner, name, wpm: run.wpm, accuracy: run.accuracy, cleared: run.cleared, total: run.total, points: run.points, at: run.at }
    const kept = rowsOf(run.songId).filter((row) => row.owner !== owner)
    const previous = rowsOf(run.songId).find((row) => row.owner === owner)
    // 一個人只占一列:只有打得比自己以前好才換掉那一列
    const row = previous && previous.points >= mine.points ? { ...previous, name } : mine
    const rows = [...kept, row].sort(better).slice(0, boardSize)
    writeJson(songFile(run.songId), { rows })
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

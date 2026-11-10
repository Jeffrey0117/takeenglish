const crypto = require('node:crypto')

// 房號給人用嘴巴念、用手打的,所以去掉長得像的 I/O/0/1
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6
const MAX_ROOMS = 200
const MAX_PLAYERS = 6
const IDLE_MS = 10 * 60_000
const MAX_NAME = 24

function randomCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH)
  let out = ''
  for (const byte of bytes) out += CODE_ALPHABET[byte % CODE_ALPHABET.length]
  return out
}

function text(value, max) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

// 同一支 MV 的對戰房。
//
// 規則就是使用者說的那一句:「誰先打完這一句,另一個人就被推到下一句」——
// 全場共用同一個句子指標,第一個回報打完的人得 1 分,然後所有人一起跳。
// 沒打完的人那一句就沒分,所以這是搶分,不是各跑各的。
//
// 房間只放記憶體:一場幾分鐘,重啟就散掉是可以接受的(成績另外存)。
function createBattles({
  now = Date.now,
  maxRooms = MAX_ROOMS,
  maxPlayers = MAX_PLAYERS,
  idleMs = IDLE_MS,
  makeCode = randomCode
} = {}) {
  const rooms = new Map()

  const touch = (room) => {
    room.touchedAt = now()
  }

  // 公開的樣子:owner(te-<sub>)絕對不出去,那是別人也看得到的畫面
  function view(room) {
    const players = [...room.players.entries()]
      .map(([id, player]) => ({ id, name: player.name, points: player.points, host: id === room.hostId }))
      // 分數高的在前;同分保持加入順序(Array.prototype.sort 是穩定的)
      .sort((a, b) => b.points - a.points)
    return {
      code: room.code,
      songId: room.songId,
      total: room.total,
      line: room.line,
      started: room.started,
      over: room.over,
      players
    }
  }

  function publish(room) {
    const state = view(room)
    for (const listener of room.listeners) {
      try {
        listener(state)
      } catch {
        /* 一個訂閱者壞掉不該影響其他人 */
      }
    }
  }

  function sweep() {
    const limit = now() - idleMs
    for (const [code, room] of rooms) {
      if (room.touchedAt <= limit) rooms.delete(code)
    }
  }

  function freeCode() {
    for (let tries = 0; tries < 20; tries += 1) {
      const code = makeCode()
      if (!rooms.has(code)) return code
    }
    return null
  }

  function addPlayer(room, { owner, name }) {
    // 同一個人重新連線(換網路、重新整理)拿回原本的位置,不要變成兩個玩家
    for (const [id, player] of room.players) {
      if (player.owner === owner) {
        player.name = text(name, MAX_NAME) || player.name
        touch(room)
        return { playerId: id, playerToken: player.token }
      }
    }
    if (room.players.size >= maxPlayers) return { error: 'room_full' }
    const playerId = crypto.randomBytes(6).toString('base64url')
    const token = crypto.randomBytes(18).toString('base64url')
    room.players.set(playerId, {
      owner,
      name: text(name, MAX_NAME) || '玩家',
      points: 0,
      token,
      cleared: new Set()
    })
    touch(room)
    return { playerId, playerToken: token }
  }

  function create({ songId, total, owner, name }) {
    if (!songId || !Number.isInteger(total) || total <= 0) return { error: 'bad_room' }
    if (!owner) return { error: 'bad_room' }
    if (rooms.size >= maxRooms) sweep()
    if (rooms.size >= maxRooms) return { error: 'too_many_rooms' }
    const code = freeCode()
    if (!code) return { error: 'too_many_rooms' }
    const room = {
      code,
      songId,
      total,
      line: 0,
      started: false,
      over: false,
      hostId: null,
      players: new Map(),
      listeners: new Set(),
      createdAt: now(),
      touchedAt: now()
    }
    rooms.set(code, room)
    const seat = addPlayer(room, { owner, name })
    room.hostId = seat.playerId
    return { code, playerId: seat.playerId, playerToken: seat.playerToken, state: view(room) }
  }

  function join(code, { owner, name }) {
    const room = rooms.get(String(code).toUpperCase())
    if (!room) return { error: 'room_not_found' }
    if (room.over) return { error: 'room_over' }
    const seat = addPlayer(room, { owner, name })
    if (seat.error) return seat
    publish(room)
    return { code: room.code, playerId: seat.playerId, playerToken: seat.playerToken, state: view(room) }
  }

  function start(code, playerId) {
    const room = rooms.get(String(code).toUpperCase())
    if (!room) return { error: 'room_not_found' }
    if (room.hostId !== playerId) return { error: 'not_host' }
    if (room.players.size < 2) return { error: 'need_players' }
    if (room.started) return { state: view(room) }
    room.started = true
    room.line = 0
    touch(room)
    publish(room)
    return { state: view(room) }
  }

  // 打完這一句了。第一個送到的人得分,然後全場一起往下一句
  function cleared(code, playerId, line) {
    const room = rooms.get(String(code).toUpperCase())
    if (!room) return { error: 'room_not_found' }
    const player = room.players.get(playerId)
    if (!player) return { error: 'not_in_room' }
    if (!room.started) return { error: 'not_started' }
    if (room.over) return { error: 'room_over' }
    // 慢的人回報的是已經過去的句子:不得分,更不能把全場往回拉
    if (line !== room.line || player.cleared.has(line)) return { point: false, advanced: false, state: view(room) }
    player.cleared.add(line)
    player.points += 1
    room.line += 1
    if (room.line >= room.total) {
      room.over = true
      room.started = false
    }
    touch(room)
    publish(room)
    return { point: true, advanced: true, state: view(room) }
  }

  function leave(code, playerId) {
    const room = rooms.get(String(code).toUpperCase())
    if (!room) return { error: 'room_not_found' }
    room.players.delete(playerId)
    if (room.players.size === 0) {
      rooms.delete(room.code)
      return { state: null }
    }
    // 房主走了就換下一個人當 —— 不然沒人能按開始
    if (room.hostId === playerId) room.hostId = room.players.keys().next().value
    touch(room)
    publish(room)
    return { state: view(room) }
  }

  // 這個人在這間房是哪個玩家。POST 來的請求帶的是 JWT(所以只知道 owner),
  // 要先換成房內的 playerId 才能記分
  function whoIs(code, owner) {
    const room = rooms.get(String(code).toUpperCase())
    if (!room || !owner) return null
    for (const [id, player] of room.players) {
      if (player.owner === owner) return id
    }
    return null
  }

  // SSE 用這個訂閱。token 只在這一間房有效,所以可以放在網址上(JWT 不行)
  function byToken(code, token) {
    const room = rooms.get(String(code).toUpperCase())
    if (!room || !token) return null
    for (const [id, player] of room.players) {
      if (player.token === token) return id
    }
    return null
  }

  function subscribe(code, listener) {
    const room = rooms.get(String(code).toUpperCase())
    if (!room) return () => {}
    room.listeners.add(listener)
    return () => room.listeners.delete(listener)
  }

  function state(code) {
    const room = rooms.get(String(code).toUpperCase())
    return room ? view(room) : null
  }

  return { create, join, start, cleared, leave, byToken, whoIs, subscribe, state, sweep, get size() { return rooms.size } }
}

module.exports = { createBattles }

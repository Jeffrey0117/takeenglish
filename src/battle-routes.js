const { displayName } = require('./scores')

const CODE_PATTERN = /^[A-Za-z0-9]{6}$/
// 錯誤代號 → HTTP 狀態。房間相關的錯誤都是「現在的狀況不對」,不是伺服器壞了
const STATUS = {
  room_not_found: 404,
  room_over: 409,
  room_full: 409,
  too_many_rooms: 503,
  not_host: 403,
  not_in_room: 403,
  need_players: 409,
  not_started: 409,
  bad_room: 400
}

function fail(res, status, error) {
  res.set('Cache-Control', 'no-store')
  return res.status(status).json({ success: false, error })
}

const sendState = (res, payload) => {
  res.set('Cache-Control', 'no-store')
  return res.json({ success: true, data: payload })
}

// 同一支 MV 的即時對戰。
//
// 玩法:全場共用同一個句子指標。誰先打完這一句就得 1 分,然後所有人一起被推到
// 下一句 —— 慢的人那一句就沒分。狀態變化用 SSE 推給所有人。
//
// 為什麼 SSE 的網址上帶的是 playerToken 而不是登入 token:瀏覽器的 EventSource
// 沒辦法帶 Authorization 標頭,而把 JWT 放在網址上會被記進各種 log。playerToken
// 只在這一間房有效、離開就作廢,放在網址上是安全的。
//
// 對戰要打完整首,所以進場花的那 1 點 credit 用的 item 跟「解鎖整首」同一個
// (song:<id>)—— 不然免費會員打到第 15 句就卡住,而且同一首同一天不會被扣兩次。
function mountBattleRoutes(app, { viewer, songs, battles, plans, ledger, limiter, clientIp, ownerOf }) {
  function tooMany(req, res, bucket, max, key) {
    if (limiter.check(`${bucket}:${key || clientIp(req)}`, max).allowed) return false
    res.set('Retry-After', '10')
    fail(res, 429, 'too_many_requests')
    return true
  }

  // 登入 + 這個等級能不能練打。回 null 表示已經回過錯誤了
  async function player(req, res) {
    const { user, tier } = await viewer(req)
    if (!user) {
      fail(res, 401, 'unauthorized')
      return null
    }
    if (!plans.can(tier, 'typing')) {
      fail(res, 402, 'upgrade_required')
      return null
    }
    return { user, tier, owner: ownerOf(user), name: displayName({ name: user.name, email: user.email }) }
  }

  function codeOf(req, res) {
    const code = String(req.params.code || '').toUpperCase()
    if (!CODE_PATTERN.test(code)) {
      fail(res, 404, 'room_not_found')
      return null
    }
    return code
  }

  const failRoom = (res, error) => fail(res, STATUS[error] || 400, error)

  // 進場要花 1 點(付費會員不限)。同一首同一天只扣一次,而且那一點也把整首解鎖
  function payFor(songId, owner, tier) {
    const limit = plans.quota(tier, 'typingCredits')
    if (!ledger) return { allowed: true }
    return ledger.spend(owner, 'credits', `song:${songId}`, limit)
  }

  app.post('/api/battle', async (req, res) => {
    const me = await player(req, res)
    if (!me) return
    if (tooMany(req, res, 'battle-new', 10, me.owner)) return
    const songId = typeof (req.body && req.body.songId) === 'string' ? req.body.songId : ''
    // 只有公開歌庫的歌能對戰 —— 自己貼連結加的歌別人根本沒有
    const song = songs.get(songId)
    if (!song) return fail(res, 404, 'song_not_found')
    const ticket = payFor(song.id, me.owner, me.tier)
    if (!ticket.allowed) {
      res.set('Cache-Control', 'no-store')
      return res.status(402).json({ success: false, error: 'no_credits', used: ticket.used, limit: ticket.limit })
    }
    const made = battles.create({ songId: song.id, total: song.lines.length, owner: me.owner, name: me.name })
    if (made.error) return failRoom(res, made.error)
    return sendState(res, { code: made.code, playerId: made.playerId, playerToken: made.playerToken, state: made.state })
  })

  app.post('/api/battle/:code/join', async (req, res) => {
    const me = await player(req, res)
    if (!me) return
    const code = codeOf(req, res)
    if (!code) return
    if (tooMany(req, res, 'battle-join', 20, me.owner)) return
    const current = battles.state(code)
    if (!current) return fail(res, 404, 'room_not_found')
    const ticket = payFor(current.songId, me.owner, me.tier)
    if (!ticket.allowed) {
      res.set('Cache-Control', 'no-store')
      return res.status(402).json({ success: false, error: 'no_credits', used: ticket.used, limit: ticket.limit })
    }
    const joined = battles.join(code, { owner: me.owner, name: me.name })
    if (joined.error) return failRoom(res, joined.error)
    return sendState(res, {
      code,
      songId: current.songId,
      playerId: joined.playerId,
      playerToken: joined.playerToken,
      state: joined.state
    })
  })

  app.post('/api/battle/:code/start', async (req, res) => {
    const me = await player(req, res)
    if (!me) return
    const code = codeOf(req, res)
    if (!code) return
    if (tooMany(req, res, 'battle-act', 60, me.owner)) return
    const playerId = battles.whoIs(code, me.owner)
    if (!playerId) return fail(res, 403, 'not_in_room')
    const result = battles.start(code, playerId)
    if (result.error) return failRoom(res, result.error)
    return sendState(res, { state: result.state })
  })

  // 打完這一句了。第一個送到的人得分,然後全場一起跳到下一句
  app.post('/api/battle/:code/cleared', async (req, res) => {
    const me = await player(req, res)
    if (!me) return
    const code = codeOf(req, res)
    if (!code) return
    // 一句一次,打得快的人一分鐘也不會超過幾十句;這個上限只是防腳本
    if (tooMany(req, res, 'battle-cleared', 600, me.owner)) return
    const line = Number(req.body && req.body.line)
    if (!Number.isInteger(line) || line < 0) return fail(res, 400, 'bad_line')
    const playerId = battles.whoIs(code, me.owner)
    if (!playerId) return fail(res, 403, 'not_in_room')
    const result = battles.cleared(code, playerId, line)
    if (result.error) return failRoom(res, result.error)
    return sendState(res, { point: result.point, advanced: result.advanced, state: result.state })
  })

  app.post('/api/battle/:code/leave', async (req, res) => {
    const me = await player(req, res)
    if (!me) return
    const code = codeOf(req, res)
    if (!code) return
    if (tooMany(req, res, 'battle-act', 60, me.owner)) return
    const playerId = battles.whoIs(code, me.owner)
    if (!playerId) return sendState(res, { state: null })
    const result = battles.leave(code, playerId)
    return sendState(res, { state: result.state || null })
  })

  // 輪詢用:SSE 被中間的 proxy 擋掉時前端會退回來打這一支
  app.get('/api/battle/:code', async (req, res) => {
    const me = await player(req, res)
    if (!me) return
    const code = codeOf(req, res)
    if (!code) return
    if (tooMany(req, res, 'battle-poll', 300, me.owner)) return
    const state = battles.state(code)
    if (!state) return fail(res, 404, 'room_not_found')
    return sendState(res, { state, me: battles.whoIs(code, me.owner) })
  })

  app.get('/api/battle/:code/stream', (req, res) => {
    const code = codeOf(req, res)
    if (!code) return
    const token = typeof req.query.t === 'string' ? req.query.t : ''
    // 認的是房內的 token,不是登入 token(EventSource 帶不了標頭)
    const playerId = battles.byToken(code, token)
    if (!playerId) return fail(res, 404, 'room_not_found')
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform + X-Accel-Buffering:中間的 proxy(Cloudflare/nginx)不要把串流緩衝起來,
      // 緩衝起來的話「同時被推到下一句」就會變成一次收到好幾筆
      'Cache-Control': 'no-cache, no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    if (typeof res.flushHeaders === 'function') res.flushHeaders()
    let alive = true
    const send = (state) => {
      if (!alive) return
      try {
        res.write(`data: ${JSON.stringify(state)}\n\n`)
      } catch {
        alive = false
      }
    }
    send(battles.state(code))
    const stop = battles.subscribe(code, send)
    // 沒事也要定期說句話,不然閒置連線會被中間的設備收掉
    const ping = setInterval(() => {
      if (!alive) return
      try {
        res.write(`: ping\n\n`)
      } catch {
        alive = false
      }
    }, 20_000)
    const close = () => {
      alive = false
      clearInterval(ping)
      stop()
    }
    req.on('close', close)
    req.on('aborted', close)
    res.on('error', close)
  })
}

module.exports = { mountBattleRoutes }

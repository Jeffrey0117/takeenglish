const BOARD_SIZE = 20
const HISTORY_SIZE = 50

function fail(res, status, error) {
  res.set('Cache-Control', 'no-store')
  return res.status(status).json({ success: false, error })
}

// 練完一輪的成績:個人歷史 + 每首歌的排行榜。
//
// ⚠️ 成績是前端算的,所以這裡只做兩件事:(1) 數字合理性由 scores.normalizeRun 夾擠,
// (2) 歌名、句數一律用伺服器自己的資料覆蓋掉前端送的 —— 不然排行榜等於讓人自己寫字。
// 真的要防作弊得把打字判定搬到後端逐鍵驗,那是另一個專案(spec 已寫明不做)。
function mountScoreRoutes(app, { viewer, songs, mySongs, scores, limiter, clientIp, ownerOf }) {
  function tooMany(req, res, bucket, max) {
    if (limiter.check(`${bucket}:${clientIp(req)}`, max).allowed) return false
    res.set('Retry-After', '30')
    fail(res, 429, 'too_many_requests')
    return true
  }

  app.post('/api/type/scores', async (req, res) => {
    const { user } = await viewer(req)
    if (!user) return fail(res, 401, 'unauthorized')
    if (tooMany(req, res, 'type-scores', 60)) return
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const own = body.own === true
    const owner = ownerOf(user)
    const songId = typeof body.songId === 'string' ? body.songId : ''
    const song = own ? mySongs.get(owner, songId) : songs.get(songId)
    if (!song) return fail(res, 404, 'song_not_found')
    const result = scores.add(
      owner,
      {
        ...body,
        songId: song.id,
        own,
        // 歌名、作者、總句數都以伺服器為準
        title: song.title,
        artist: song.artist,
        total: song.lines.length
      },
      { name: user.name, email: user.email }
    )
    res.set('Cache-Control', 'no-store')
    return res.json({
      success: true,
      data: {
        recorded: result.recorded,
        run: result.run || null,
        rank: result.rank === undefined ? null : result.rank,
        board: own ? [] : scores.board(song.id, BOARD_SIZE)
      }
    })
  })

  app.get('/api/type/scores', async (req, res) => {
    const { user } = await viewer(req)
    if (!user) return fail(res, 401, 'unauthorized')
    if (tooMany(req, res, 'type-scores', 60)) return
    const owner = ownerOf(user)
    res.set('Cache-Control', 'no-store')
    return res.json({ success: true, data: { items: scores.history(owner, HISTORY_SIZE), bests: scores.bests(owner) } })
  })

  // 排行榜公開可讀(歌曲頁要給還沒登入的人看到「有人在練」),但名字已經去識別化
  app.get('/api/type/board', (req, res) => {
    if (tooMany(req, res, 'type-board', 120)) return
    const songId = typeof req.query.songId === 'string' ? req.query.songId : ''
    if (!songs.get(songId)) return fail(res, 404, 'song_not_found')
    res.set('Cache-Control', 'no-store')
    return res.json({ success: true, data: { items: scores.board(songId, BOARD_SIZE) } })
  })
}

module.exports = { mountScoreRoutes }

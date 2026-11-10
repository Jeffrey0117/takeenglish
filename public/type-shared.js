// 聽歌練英打 — 共用的文案與工具。歌單頁(type-list.js)和練習頁(type-song.js)都靠這一份。
// 這些檔案沒有打包步驟,所以用 window.teType 當命名空間(跟 teStudy / teWall / teBattle 同一套做法)。
(function () {
  // 資料來自 /api/songs,鎖住的句子後端根本不會送過來。
  const TEXT = {
    heading: '聽歌練英打',
    sub: '挑一首歌,跟著 MV 一句一句打。打完才繼續播 — 練手速,也把歌詞聽進去。',
    badge: '會員專屬',
    empty: '歌庫還在準備中',
    error: '載入失敗,重新整理再試一次',
    notFound: '找不到這首歌',
    back: '← 所有歌曲',
    lines: (n) => `${n} 句`,
    progress: (n, total) => `${n} / ${total}`,
    // 播放器
    playerBlocked: '這支 MV 不能嵌入播放,換一首試試',
    playerFailed: '播放器載入不起來,檢查網路或擋廣告的外掛',
    // 控制列
    play: '播放',
    pause: '暫停',
    again: '重聽這句',
    prev: '上一句',
    next: '下一句',
    speed: (rate) => `${rate}x`,
    blankCount: (n) => (n === 'auto' ? '自動挖空' : n === 0 ? '全挖空' : `挖 ${n} 字`),
    zh: '中文',
    lyrics: '看歌詞',
    autoPause: '句末暫停',
    cover: '遮住畫面',
    coverNote: '畫面遮住了 — 只用耳朵聽',
    coverHint: '很多 MV 直接把歌詞印在畫面上,想純聽寫就遮起來',
    restart: '從頭開始',
    // 打字區
    hint: '整句都要打,點點的字要用聽的 · Enter 看答案 · ↓ 下一句 · ↑ 上一句 · Shift+Enter 重聽',
    waiting: '打完這一句,影片就繼續播(聽不出來按 Enter)',
    revealed: '這就是答案 — 照著打一次(這句不計分),或按 ↓ 跳下一句',
    correct: '對了!',
    startHint: '按播放開始。整句都要打,點點的那幾個字要用聽的',
    // 成績
    wpm: 'WPM',
    accuracy: '正確率',
    cleared: '完成',
    resultTitle: '這首練完了',
    resultTime: (s) => `${Math.floor(s / 60)} 分 ${String(Math.round(s % 60)).padStart(2, '0')} 秒`,
    resultPeeked: (n) => `${n} 句看了答案`,
    misses: '最常打錯',
    retry: '再練一次',
    otherSongs: '換一首',
    // 對戰
    battle: '對戰',
    battleGuest: '登入後可以跟朋友對戰同一首歌',
    // credit
    creditUnlock: (left) => `用 1 點解鎖整首(今天還有 ${left} 點)`,
    creditNone: '今天的點數用完了 — 明天再來,或升級 Pro 整首不限',
    creditWorking: '解鎖中…',
    creditFailed: '解鎖失敗,再試一次',
    creditLeft: (left) => `今天還有 ${left} 點`,
    // 成績與排行榜
    boardTitle: '排行榜',
    boardEmpty: '還沒有人留下成績 — 你可以是第一個',
    scoreUploading: '上傳成績…',
    scorePoints: (n) => `這一輪 ${n} 分`,
    scoreRank: (n) => `這首第 ${n} 名`,
    scoreSkipped: '這一輪沒記成績',
    scoreNeedLines: (n) => `打完 ${n} 句以上才會記成績`,
    scoreGuest: '登入後才會記成績、上排行榜',
    scoreOffline: '成績沒存上(網路斷了?)',
    historyTitle: '我的成績',
    historyEmpty: '還沒有成績 — 練完一首就會出現在這裡',
    historyBest: (n) => `最佳 ${n} 分`,
    // 會員牆
    gateTitle: '聽歌練英打是會員專屬',
    gateBody: '免費登入就可以開始練,每首歌先練 15 句;升級 Pro 整首歌不限。',
    gateLogin: '免費登入開始練',
    lockedLines: (n) => `後面還有 ${n} 句`,
    unlock: '解鎖整首',
    wallTitle: '練完整首歌',
    wallPoints: ['每首歌從頭打到尾', '影片學習完整逐字稿', '單句重複、慢速、聽寫不受限', '片語搜尋看全部結果'],
    wallGuestHint: '先免費登入,可以先練 15 句',
    // 自己貼 YouTube 連結
    mine: '我的歌',
    mineHint: '貼上 YouTube 連結,自動抓字幕變成練習;自己加的歌整首都能練。',
    minePlaceholder: 'https://www.youtube.com/watch?v=…',
    mineAdd: '加入',
    mineAdding: '抓字幕中…(可能要十幾秒)',
    mineEmpty: '還沒有自己加的歌',
    mineLogin: '登入後可以貼自己的 YouTube 連結',
    mineQuota: (used, limit) => (limit === null ? '不限' : `今天還可以加 ${Math.max(limit - used, 0)} 支`),
    mineRemove: '移除',
    mineRemoveConfirm: (title) => `把「${title}」從我的歌移除?`,
    mineErrors: {
      bad_url: '這不是 YouTube 影片連結',
      not_embeddable: '這支影片不給嵌入播放,練不了 — 換一支',
      no_subtitles: '這支影片沒有英文字幕(很多官方 MV 都沒有)— 找同一首歌的 lyrics 影片通常有',
      thin_subtitles: '這首的英文字幕太零散,練不了 — YouTube 只從非英文歌裡聽出幾個字。換英文歌試試',
      subs_fetch_failed: '這支有字幕,但這次沒抓到 — 等一下再按一次就好,不用換影片',
      rate_limited: 'YouTube 暫時擋下請求,過幾分鐘再試',
      daily_limit: '今天加的額度用完了',
      library_full: '我的歌放滿了,先移除幾首',
      upgrade_required: '這是會員功能',
      unauthorized: '請先登入',
      import_unavailable: '這台伺服器沒有開放自己加歌',
      default: '加入失敗,稍後再試'
    },
    minutes: (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
  }

  const $ = (sel) => document.querySelector(sel)
  const params = new URLSearchParams(location.search)
  const { el } = window.teStudy


  // 頁面訊息。第一次 render 之後 #type-status 就被換掉了,不能假設它還在
  function status(message) {
    const node = $('#type-status')
    if (node) node.textContent = message
    else $('#type-main').replaceChildren(el('p', 'watch-status', message))
  }

  async function getJson(url) {
    await window.teSession.ready
    const token = window.teSession.getToken()
    const res = await fetch(url, { cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {} })
    const body = await res.json().catch(() => ({}))
    return { status: res.status, ok: res.ok && body.success === true, data: body.data }
  }

  async function postJson(url, body) {
    await window.teSession.ready
    const token = window.teSession.getToken()
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body)
    })
    const parsed = await res.json().catch(() => ({}))
    return { status: res.status, ok: res.ok && parsed.success === true, data: parsed.data }
  }

  // 排行榜的一列一列。名字是伺服器去識別化過的(暱稱或遮起來的信箱),這裡照用
  function boardTable(items, myRank = null) {
    const table = el('div', 'type-board-list')
    items.forEach((row, index) => {
      const line = el('div', 'type-board-row')
      if (myRank && index + 1 === myRank) line.classList.add('me')
      line.append(
        el('span', 'type-board-rank', String(index + 1)),
        el('span', 'type-board-name', row.name),
        el('b', 'type-board-points', String(row.points)),
        el('span', 'type-board-meta', `${row.wpm} WPM · ${row.accuracy}% · ${row.cleared}/${row.total}`)
      )
      table.append(line)
    })
    return table
  }

  // 今天還剩幾點;null = 不限(付費會員)
  function creditsLeft(song) {
    const credits = song.credits || null
    if (!credits || credits.limit === null) return null
    return Math.max(credits.limit - credits.used, 0)
  }

  // 花 1 點把這一首整首打開。成功就重新整理 —— 伺服器那邊記著「今天解鎖過這首」,
  // 重新載入就會把整首送下來,不用在播放中途重建整個練習狀態
  async function spendCredit(button, note) {
    const id = params.get('id') || ''
    button.disabled = true
    note.textContent = TEXT.creditWorking
    const res = await postJson(`/api/songs/${encodeURIComponent(id)}/unlock`, {}).catch(() => null)
    if (res && res.ok) return location.reload()
    button.disabled = false
    note.textContent = res && res.status === 402 ? TEXT.creditNone : TEXT.creditFailed
  }

  // 右欄底下的排行榜:進來就看得到別人打到幾分。
  // 訪客也要看得到 —— 那是「這裡有人在玩」最直接的證據,也是登入的理由
  // (自己貼連結加的歌沒有公開榜,別人根本沒那首)
  function sideBoard(side, song) {
    if (song.own) return
    const panel = el('section', 'type-side-board')
    const body = el('div', 'type-side-board-body')
    panel.append(el('h2', 'row-title', TEXT.boardTitle), body)
    side.append(panel)
    getJson(`/api/type/board?songId=${encodeURIComponent(song.id)}`)
      .then((res) => {
        if (!res.ok || !res.data) return panel.remove()
        const items = Array.isArray(res.data.items) ? res.data.items : []
        body.replaceChildren(items.length ? boardTable(items.slice(0, 10)) : el('p', 'lesson-sub', TEXT.boardEmpty))
      })
      .catch(() => panel.remove())
  }

  function showWall(song) {
    const left = creditsLeft(song)
    window.teWall.show({
      // 公開歌庫的歌、還有點數、今天還沒解鎖過這首 → 給他一條不用付錢的路
      extra:
        song.signedIn && !song.own && !song.unlocked && left !== null && left > 0
          ? { label: TEXT.creditUnlock(left), onClick: spendCredit }
          : null,
      signedIn: song.signedIn,
      title: TEXT.wallTitle,
      points: TEXT.wallPoints,
      count: song.lockedLines ? TEXT.lockedLines(song.lockedLines) : '',
      guestHint: TEXT.wallGuestHint
    })
  }

  // 三個數字:WPM、正確率、完成幾句。每敲一個鍵就更新,所以是改字不是重畫
  function createStats(score, total) {
    const node = el('div', 'type-stats')
    const values = []
    for (const label of [TEXT.wpm, TEXT.accuracy, TEXT.cleared]) {
      const stat = el('div', 'type-stat')
      const value = el('b', '', '0')
      stat.append(value, el('span', '', label))
      values.push(value)
      node.append(stat)
    }
    function update(cleared) {
      values[0].textContent = String(score.wpm())
      values[1].textContent = `${score.accuracy()}%`
      values[2].textContent = `${cleared}/${total}`
    }
    update(0)
    return { node, update }
  }

  // 登入/登出之後等級變了,重新載入才拿得到新的句數
  function watchSignIn() {
    const identity = (user) => (user ? user.id || user.sub || user.email || 'signed-in' : null)
    const loadedAs = identity(window.teSession.user())
    window.teSession.onChange((user) => {
      if (identity(user) !== loadedAs) location.reload()
    })
  }

  window.teType = {
    TEXT,
    createStats,
    $,
    el,
    params,
    status,
    getJson,
    postJson,
    boardTable,
    creditsLeft,
    spendCredit,
    sideBoard,
    showWall,
    watchSignIn
  }
})()

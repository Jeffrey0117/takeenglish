// 我的帳號:我是誰、哪個等級、練打的總成績、每首最佳、我的歌、練習紀錄。
// 沒有自己的後端 —— 全部用現成的三支:/api/me、/api/type/scores、/api/my-songs。
(function () {
  const { $, el, getJson, watchSignIn } = window.teType

  const TEXT = {
    title: '我的帳號',
    loading: '載入中…',
    error: '載入失敗,重新整理再試一次',
    guest: '登入之後這裡會有你的成績和練習紀錄',
    login: '登入',
    logout: '登出',
    upgrade: '升級 Pro',
    manage: '管理訂閱',
    tiers: { free: '免費會員', pro: 'Pro', pro_plus: 'Pro Plus' },
    until: (date) => `有效到 ${date}`,
    stats: { runs: '練了幾輪', songs: '練過幾首', wpm: '最高 WPM', accuracy: '平均正確率', minutes: '打字分鐘' },
    bests: '每首最佳',
    mine: '我的歌',
    mineQuota: (used, limit) => (limit === null ? `這個月加了 ${used} 首` : `這個月加了 ${used} / ${limit} 首`),
    mineEmpty: '還沒有自己加的歌',
    mineGo: '去加一首',
    history: '練習紀錄',
    historyEmpty: '還沒有成績 — 練完一首(至少 3 句)就會出現在這裡',
    historyGo: '去練一首',
    points: (n) => `${n} 分`,
    lines: (n) => `${n} 句`,
    peeked: (n) => `看答案 ${n} 句`
  }

  const songUrl = (item) => (item.own ? `/type?mine=${encodeURIComponent(item.songId || item.id)}` : `/type?id=${encodeURIComponent(item.songId || item.id)}`)
  const dateOf = (iso) => String(iso || '').slice(0, 10).replace(/-/g, '/')
  // 紀錄存的是 UTC,顯示成這台裝置的當地時間
  function whenOf(iso) {
    const at = new Date(iso)
    if (Number.isNaN(at.getTime())) return ''
    const pad = (n) => String(n).padStart(2, '0')
    return `${pad(at.getMonth() + 1)}/${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
  }

  function section(title, ...children) {
    const box = el('section', 'me-section')
    box.append(el('h2', 'row-title', title), ...children)
    return box
  }

  function profile(me) {
    const box = el('section', 'me-profile')
    const who = el('div', 'me-who')
    who.append(el('h1', 'watch-title', me.name || me.email || TEXT.title))
    if (me.name && me.email) who.append(el('p', 'me-email', me.email))
    const plan = el('p', 'me-plan')
    plan.append(el('b', me.tier === 'free' ? 'me-tier' : 'me-tier paid', TEXT.tiers[me.tier] || TEXT.tiers.free))
    if (me.activeUntil) plan.append(el('span', 'me-until', TEXT.until(dateOf(me.activeUntil))))
    who.append(plan)

    const actions = el('div', 'me-actions')
    const billing = el('a', 'auth-btn', me.tier === 'free' ? TEXT.upgrade : TEXT.manage)
    billing.href = '/#plans'
    const logout = el('button', 'auth-btn quiet', TEXT.logout)
    logout.type = 'button'
    logout.onclick = () => {
      const sdk = window.letmeuse
      if (sdk && sdk.logout) sdk.logout()
    }
    actions.append(billing, logout)
    box.append(who, actions)
    return box
  }

  // 總成績:只算得出「紀錄裡有的那幾輪」(伺服器留最近 50 輪)
  function stats(runs) {
    const songs = new Set(runs.map((run) => `${run.own ? 'mine' : 'pub'}:${run.songId}`))
    const best = runs.reduce((max, run) => Math.max(max, run.wpm || 0), 0)
    const accuracy = runs.length ? Math.round(runs.reduce((sum, run) => sum + (run.accuracy || 0), 0) / runs.length) : 0
    const minutes = Math.round(runs.reduce((sum, run) => sum + (run.seconds || 0), 0) / 60)
    const node = el('div', 'type-stats me-stats')
    const tiles = [
      [runs.length, TEXT.stats.runs],
      [songs.size, TEXT.stats.songs],
      [best, TEXT.stats.wpm],
      [runs.length ? `${accuracy}%` : 0, TEXT.stats.accuracy],
      [minutes, TEXT.stats.minutes]
    ]
    for (const [value, label] of tiles) {
      const tile = el('div', 'type-stat')
      const number = el('b', '', String(value))
      // 零就灰掉:還沒有的東西不要跟有的一樣亮
      if (!value) number.classList.add('zero')
      tile.append(number, el('span', '', label))
      node.append(tile)
    }
    return node
  }

  function runRow(run, { when }) {
    const row = el('a', 'type-history-row me-row')
    row.href = songUrl(run)
    const peeked = run.peeked ? ` · ${TEXT.peeked(run.peeked)}` : ''
    row.append(
      el('span', 'type-history-when', when),
      el('span', 'type-board-name', run.artist ? `${run.title} — ${run.artist}` : run.title),
      el('b', 'type-board-points', TEXT.points(run.points)),
      el('span', 'type-board-meta', `${run.wpm} WPM · ${run.accuracy}% · ${run.cleared}/${run.total}${peeked}`)
    )
    return row
  }

  function bestsSection(bests) {
    const runs = Object.values(bests || {}).sort((a, b) => b.points - a.points)
    if (runs.length === 0) return null
    const list = el('div', 'type-history-list')
    for (const run of runs) list.append(runRow(run, { when: dateOf(run.at).slice(5) }))
    return section(TEXT.bests, list)
  }

  function mineSection(mine) {
    if (!mine) return null
    const items = Array.isArray(mine.items) ? mine.items : []
    const quota = el('p', 'lesson-sub me-sub', TEXT.mineQuota(mine.used || 0, mine.limit === undefined ? null : mine.limit))
    if (items.length === 0) {
      const go = el('a', 'auth-btn quiet', TEXT.mineGo)
      go.href = '/type'
      return section(TEXT.mine, quota, el('p', 'me-empty', TEXT.mineEmpty), go)
    }
    const list = el('div', 'type-history-list')
    for (const item of items) {
      const row = el('a', 'type-history-row me-row me-song')
      row.href = songUrl(item)
      row.append(el('span', 'type-board-name', item.artist ? `${item.title} — ${item.artist}` : item.title), el('span', 'type-board-meta', TEXT.lines(item.lines)))
      list.append(row)
    }
    return section(TEXT.mine, quota, list)
  }

  function historySection(runs) {
    if (runs.length === 0) {
      const go = el('a', 'auth-btn', TEXT.historyGo)
      go.href = '/type'
      return section(TEXT.history, el('p', 'me-empty', TEXT.historyEmpty), go)
    }
    const list = el('div', 'type-history-list')
    for (const run of runs) list.append(runRow(run, { when: whenOf(run.at) }))
    return section(TEXT.history, list)
  }

  async function render() {
    const main = $('#type-main')
    await window.teSession.ready
    watchSignIn()
    if (!window.teSession.user()) {
      const login = el('button', 'auth-btn', TEXT.login)
      login.type = 'button'
      login.onclick = () => window.teSession.login()
      main.replaceChildren(el('h1', 'watch-title', TEXT.title), el('p', 'lesson-sub', TEXT.guest), login)
      return
    }
    const [me, scores, mine] = await Promise.all([getJson('/api/me'), getJson('/api/type/scores'), getJson('/api/my-songs')])
    if (!me.ok || !me.data) {
      main.replaceChildren(el('p', 'watch-status', TEXT.error))
      return
    }
    const runs = scores.ok && scores.data && Array.isArray(scores.data.items) ? scores.data.items : []
    const parts = [
      profile(me.data),
      stats(runs),
      bestsSection(scores.ok && scores.data ? scores.data.bests : {}),
      // 這台伺服器沒開放自己加歌的話(503)整區不畫
      mineSection(mine.ok ? mine.data : null),
      historySection(runs)
    ]
    main.replaceChildren(...parts.filter(Boolean))
  }

  render().catch(() => {
    $('#type-main').replaceChildren(el('p', 'watch-status', TEXT.error))
  })
})()

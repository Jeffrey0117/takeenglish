// 同一支 MV 的即時對戰。玩法:全場共用同一個句子指標 —— 誰先打完這一句就得 1 分,
// 其他人會被直接推到下一句(那一句就沒分了)。所以是搶分,不是各打各的。
//
// 這支只管「房間」:開房、加入、名單、分數、把伺服器推來的句號轉給練習引擎。
// 打字本身還是 type.js 那一套。
(function () {
  const TEXT = {
    open: '對戰',
    panelTitle: '對戰',
    intro: '同一首歌比誰先打完每一句 — 慢的人會被推到下一句。',
    create: '開一間房',
    joinLabel: '房號',
    join: '加入',
    codeHint: '把房號或連結給對手',
    copy: '複製連結',
    copied: '已複製',
    waiting: '等對手進來…',
    start: '開始',
    hostOnly: '等房主按開始',
    playing: '比賽中',
    over: '結束',
    again: '再來一場',
    leave: '離開',
    you: '(你)',
    point: (n) => `${n} 分`,
    line: (n, total) => `第 ${n} / ${total} 句`,
    needPlayers: '至少要兩個人才能開始',
    errors: {
      room_not_found: '找不到這間房(房號打錯,或房間已經收掉)',
      room_full: '這間房滿了',
      room_over: '這一場已經結束了',
      too_many_rooms: '現在房間太多了,等一下再開',
      no_credits: '今天的點數用完了 — 明天再來,或升級 Pro 不限',
      upgrade_required: '對戰是會員功能',
      not_host: '只有房主能開始',
      need_players: '至少要兩個人才能開始',
      song_not_found: '這首歌不能對戰',
      unauthorized: '請先登入',
      default: '連不上對戰伺服器,再試一次'
    }
  }

  const el = (tag, className, text) => window.teStudy.el(tag, className, text)

  async function post(url, body = {}) {
    await window.teSession.ready
    const token = window.teSession.getToken()
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body)
    })
    const parsed = await res.json().catch(() => ({}))
    return { status: res.status, ok: res.ok && parsed.success === true, data: parsed.data, error: parsed.error }
  }

  async function getState(code) {
    const token = window.teSession.getToken()
    const res = await fetch(`/api/battle/${encodeURIComponent(code)}`, {
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
    const parsed = await res.json().catch(() => ({}))
    return { ok: res.ok && parsed.success === true, data: parsed.data }
  }

  const message = (error) => TEXT.errors[error] || TEXT.errors.default

  // 連線:先用 SSE,2.5 秒內沒收到第一筆就退回輪詢。
  // 中間的 proxy(Cloudflare、公司網路)會把 event-stream 緩衝或整個擋掉,
  // 那時候「同時被推到下一句」會變成卡住 —— 寧可慢 0.8 秒也不要卡住
  function connect(code, token, onState) {
    let stopped = false
    let source = null
    let poll = null
    let gotOne = false

    const stopSse = () => {
      if (source) source.close()
      source = null
    }

    function startPolling() {
      if (stopped || poll) return
      stopSse()
      poll = setInterval(async () => {
        if (stopped) return
        const res = await getState(code).catch(() => null)
        if (res && res.ok && res.data && res.data.state) onState(res.data.state)
      }, 800)
    }

    try {
      source = new EventSource(`/api/battle/${encodeURIComponent(code)}/stream?t=${encodeURIComponent(token)}`)
      source.onmessage = (event) => {
        if (stopped) return
        gotOne = true
        try {
          onState(JSON.parse(event.data))
        } catch {
          /* 壞掉的一筆跳過就好 */
        }
      }
      source.onerror = () => {
        if (!stopped) startPolling()
      }
      setTimeout(() => {
        if (!gotOne && !stopped) startPolling()
      }, 2500)
    } catch {
      startPolling()
    }

    return () => {
      stopped = true
      stopSse()
      if (poll) clearInterval(poll)
    }
  }

  // engine = type.js 那邊的練習引擎。對戰期間由伺服器決定大家在第幾句
  function attach({ song, mount, engine, code: initialCode = '' }) {
    const panel = el('section', 'battle')
    const note = el('p', 'battle-note', '')
    const body = el('div', 'battle-body')
    panel.append(el('h2', 'row-title', TEXT.panelTitle), body, note)
    mount.append(panel)

    const room = { code: '', me: '', token: '', state: null, stop: null, line: -1, started: false, over: false }

    const shareUrl = (code) => `${location.origin}/type?id=${encodeURIComponent(song.id)}&battle=${encodeURIComponent(code)}`

    function renderIdle() {
      body.replaceChildren()
      body.append(el('p', 'battle-intro', TEXT.intro))
      const create = el('button', 'auth-btn', TEXT.create)
      create.type = 'button'
      create.onclick = () => makeRoom(create)
      const form = el('form', 'battle-join')
      const input = el('input', 'lesson-add-input')
      input.placeholder = TEXT.joinLabel
      input.maxLength = 6
      input.autocapitalize = 'characters'
      input.spellcheck = false
      const go = el('button', 'auth-btn quiet', TEXT.join)
      go.type = 'submit'
      form.append(input, go)
      form.onsubmit = (event) => {
        event.preventDefault()
        const value = input.value.trim().toUpperCase()
        if (value.length === 6) joinRoom(value, go)
      }
      body.append(create, form)
    }

    function roster(state) {
      const list = el('div', 'battle-players')
      for (const person of state.players) {
        const row = el('div', 'battle-player')
        if (person.id === room.me) row.classList.add('me')
        row.append(
          el('span', 'battle-player-name', `${person.name}${person.id === room.me ? TEXT.you : ''}`),
          el('b', 'battle-player-points', TEXT.point(person.points))
        )
        list.append(row)
      }
      return list
    }

    function renderRoom() {
      const state = room.state
      if (!state) return
      body.replaceChildren()
      if (!state.started && !state.over) {
        const code = el('p', 'battle-code', state.code)
        const copy = el('button', 'auth-btn quiet', TEXT.copy)
        copy.type = 'button'
        copy.onclick = async () => {
          try {
            await navigator.clipboard.writeText(shareUrl(state.code))
            copy.textContent = TEXT.copied
          } catch {
            // 剪貼簿不給用就把連結放出來讓他自己複製
            note.textContent = shareUrl(state.code)
          }
        }
        body.append(code, el('p', 'battle-hint', TEXT.codeHint), copy, roster(state))
        const iAmHost = state.players.some((person) => person.id === room.me && person.host)
        if (iAmHost) {
          const start = el('button', 'auth-btn', TEXT.start)
          start.type = 'button'
          start.disabled = state.players.length < 2
          start.onclick = () => startRoom(start)
          body.append(start)
          if (state.players.length < 2) body.append(el('p', 'battle-hint', TEXT.waiting))
        } else {
          body.append(el('p', 'battle-hint', TEXT.hostOnly))
        }
      } else {
        body.append(el('p', 'battle-status', state.over ? TEXT.over : TEXT.line(state.line + 1, state.total)), roster(state))
        if (state.over) {
          const again = el('button', 'auth-btn', TEXT.again)
          again.type = 'button'
          again.onclick = () => (location.href = `/type?id=${encodeURIComponent(song.id)}`)
          body.append(again)
        }
      }
      const leave = el('button', 'auth-btn quiet', TEXT.leave)
      leave.type = 'button'
      leave.onclick = () => leaveRoom()
      body.append(leave)
    }

    // 伺服器是唯一的事實:大家在第幾句、開始了沒、結束了沒,都照它說的
    function apply(state) {
      if (!state || state.code !== room.code) return
      const previous = room.state
      room.state = state
      if (state.started && !room.started) {
        room.started = true
        room.line = -1
        engine.onStart()
      }
      if (state.started && state.line !== room.line) {
        room.line = state.line
        engine.onForceLine(state.line)
      }
      if (state.over && !room.over) {
        room.over = true
        engine.onOver(state)
      }
      // 名單或分數有變就重畫(等對手的時候只有這個會動)
      if (!previous || JSON.stringify(previous) !== JSON.stringify(state)) renderRoom()
    }

    function listen() {
      if (room.stop) room.stop()
      room.stop = connect(room.code, room.token, apply)
    }

    function enter(data) {
      room.code = data.code || (data.state && data.state.code) || ''
      room.me = data.playerId || ''
      room.token = data.playerToken || ''
      room.state = data.state || null
      room.started = Boolean(data.state && data.state.started)
      room.over = Boolean(data.state && data.state.over)
      room.line = room.started && data.state ? data.state.line : -1
      engine.onEnter(room)
      renderRoom()
      listen()
    }

    async function makeRoom(button) {
      button.disabled = true
      note.textContent = ''
      const res = await post('/api/battle', { songId: song.id })
      if (!res.ok) {
        button.disabled = false
        note.textContent = message(res.error)
        return
      }
      // 重新載入進房:那 1 點 credit 也把這首歌整首解鎖了,重新拿一次才拿得到全部句子
      location.href = shareUrl(res.data.code)
    }

    async function joinRoom(code, button) {
      if (button) button.disabled = true
      note.textContent = ''
      const res = await post(`/api/battle/${encodeURIComponent(code)}/join`)
      if (!res.ok) {
        if (button) button.disabled = false
        note.textContent = message(res.error)
        renderIdle()
        return
      }
      // 房間是別首歌的 → 把人帶去對的那一首
      if (res.data.songId && res.data.songId !== song.id) {
        location.href = `/type?id=${encodeURIComponent(res.data.songId)}&battle=${encodeURIComponent(code)}`
        return
      }
      // 句數對不上(免費會員還沒拿到整首)→ 重新載入就會拿到解鎖後的版本
      if (res.data.state && res.data.state.total !== song.totalLines) {
        location.href = shareUrl(code)
        return
      }
      enter({ ...res.data, code })
    }

    async function startRoom(button) {
      button.disabled = true
      const res = await post(`/api/battle/${encodeURIComponent(room.code)}/start`)
      if (!res.ok) {
        button.disabled = false
        note.textContent = message(res.error)
      }
    }

    async function leaveRoom() {
      if (room.stop) room.stop()
      room.stop = null
      if (room.code) await post(`/api/battle/${encodeURIComponent(room.code)}/leave`).catch(() => null)
      room.code = ''
      room.state = null
      room.started = false
      room.over = false
      engine.onLeave()
      renderIdle()
    }

    renderIdle()
    if (initialCode) joinRoom(initialCode.toUpperCase(), null)

    return {
      active: () => Boolean(room.code && room.started && !room.over),
      inRoom: () => Boolean(room.code),
      // 我打完這一句了。第一個送到的人得分,然後伺服器會把全場推到下一句
      reportCleared(line) {
        if (!room.code || !room.started || room.over) return
        post(`/api/battle/${encodeURIComponent(room.code)}/cleared`, { line })
          .then((res) => {
            if (res.ok && res.data && res.data.state) apply(res.data.state)
          })
          .catch(() => {})
      }
    }
  }

  window.teBattle = { TEXT, attach }
})()

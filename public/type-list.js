// 聽歌練英打 — 歌單頁:公開歌庫、我的歌(貼 YouTube 連結)、我的成績。
(function () {
  const { TEXT, $, el, status, getJson, watchSignIn } = window.teType
  // ---- 歌單 ----

  // 只收 YouTube 縮圖網址。這個值會進 CSS 的 url(),在這裡擋住就不必相信後端每次都乾淨
  const THUMB = /^https:[/][/]i[.]ytimg[.]com[/]vi[/][A-Za-z0-9_-]{11}[/][a-z0-9]+[.]jpg$/

  function songCard(item, best = null) {
    const card = el('a', 'lesson-card')
    card.href = item.own ? `/type?mine=${encodeURIComponent(item.id)}` : `/type?id=${encodeURIComponent(item.id)}`
    const cover = el('div', 'lesson-cover')
    if (THUMB.test(item.thumb || '')) cover.style.backgroundImage = `url("${item.thumb}")`
    if (item.level) cover.append(el('span', 'song-level', item.level))
    if (item.duration) cover.append(el('span', 'lesson-duration', TEXT.minutes(item.duration)))
    cover.append(el('span', 'song-lines', TEXT.lines(item.lines)))
    card.append(cover, el('p', 'lesson-title', item.title), el('p', 'lesson-channel', item.artist))
    // 練過的歌直接把自己的最佳分數寫在卡片上 —— 這是回來再練一次的理由
    if (best) card.append(el('p', 'song-best', TEXT.historyBest(best.points)))
    return card
  }

  // 我的成績:最近幾輪 + 每首最佳。沒登入就整區不畫(回 null)
  async function scoresSection() {
    const res = await getJson('/api/type/scores')
    if (!res.ok || !res.data) return { node: null, bests: {}, tier: 'guest' }
    const box = el('section', 'type-history')
    box.append(el('h2', 'row-title', TEXT.historyTitle))
    const items = Array.isArray(res.data.items) ? res.data.items : []
    if (items.length === 0) {
      box.append(el('p', 'lesson-sub', TEXT.historyEmpty))
      return { node: box, bests: res.data.bests || {}, tier: res.data.tier }
    }
    const list = el('div', 'type-history-list')
    for (const run of items.slice(0, 10)) {
      const row = el('div', 'type-history-row')
      const when = String(run.at || '').slice(5, 10).replace('-', '/')
      row.append(
        el('span', 'type-history-when', when),
        el('span', 'type-board-name', run.title),
        el('b', 'type-board-points', String(run.points)),
        el('span', 'type-board-meta', `${run.wpm} WPM · ${run.accuracy}% · ${run.cleared}/${run.total}`)
      )
      list.append(row)
    }
    box.append(list)
    return { node: box, bests: res.data.bests || {}, tier: res.data.tier }
  }

  // 歌單頁的「現在有人在等對手」。沒登入或沒人在等就整區不畫
  async function openRoomsSection() {
    const res = await getJson('/api/battle/open')
    if (!res.ok || !res.data) return null
    const items = Array.isArray(res.data.items) ? res.data.items : []
    if (items.length === 0) return null
    const box = el('section', 'type-open')
    box.append(el('h2', 'row-title', TEXT.openTitle), el('p', 'lesson-sub', TEXT.openHint))
    const list = el('div', 'type-open-list')
    for (const item of items) {
      const row = el('a', 'type-open-row')
      row.href = `/type?id=${encodeURIComponent(item.songId)}&battle=${encodeURIComponent(item.code)}`
      row.append(
        el('span', 'type-open-song', item.title),
        el('span', 'type-open-who', TEXT.openWho(item.players.join('、'), item.waiting, item.seats)),
        el('span', 'type-open-go', TEXT.openJoin)
      )
      list.append(row)
    }
    box.append(list)
    return box
  }

  async function renderList() {
    const res = await getJson('/api/songs')
    const main = $('#type-main')
    if (!res.ok) {
      status(TEXT.error)
      return
    }
    const hero = el('div', 'type-hero')
    hero.append(el('h1', 'watch-title', TEXT.heading), el('span', 'type-badge', TEXT.badge))
    main.replaceChildren(hero, el('p', 'lesson-sub', TEXT.sub))
    if ((window.teSession.config() || {}).songImport) main.append(await mineSection())
    // 登入/登出之後「我的歌」整區的內容就不一樣了,重新載入最乾淨。
    // 要擺在歌單是不是空的判斷之前 — 不然歌庫空的時候登入了畫面也不會變
    watchSignIn()
    if (res.data.items.length === 0) {
      main.append(el('p', 'watch-status', TEXT.empty))
      return
    }
    // 有人在等對手就擺在歌單上面 —— 那是現在最值得點的東西
    const open = await openRoomsSection()
    if (open) main.append(open)
    const mine = await scoresSection()
    const grid = el('div', 'lesson-grid')
    for (const item of res.data.items) grid.append(songCard(item, mine.bests[item.id] || null))
    main.append(grid)
    if (mine.node) main.append(mine.node)
    // 廣告擺最底下,而且付費會員不畫。script 沒載到就當沒有廣告 ——
    // 不能讓一個廣告位把整個歌單的 render 打掛
    if (window.teAds) window.teAds.render(main, mine.tier)
  }

  // 登入會重新載入頁面,打到一半的網址只好先寄放在瀏覽器。
  // 無痕視窗或擋了 storage 的時候會丟例外,接住就好 — 大不了重貼一次
  const STASH_KEY = 'te-type-pending-url'
  const stash = {
    keep(url) {
      try {
        if (url) sessionStorage.setItem(STASH_KEY, url)
      } catch {
        /* 沒得存就算了 */
      }
    },
    take() {
      try {
        const url = sessionStorage.getItem(STASH_KEY) || ''
        sessionStorage.removeItem(STASH_KEY)
        return url
      } catch {
        return ''
      }
    }
  }

  // 我的歌:貼連結加一支。抓字幕要跑 yt-dlp,十幾秒跑不掉,所以按鈕會一直停在「抓字幕中」
  async function mineSection() {
    const box = el('section', 'lesson-mine')
    box.append(el('h2', 'row-title', TEXT.mine), el('p', 'lesson-sub mine-hint', TEXT.mineHint))
    const form = el('form', 'lesson-add')
    const input = el('input', 'lesson-add-input')
    input.type = 'url'
    input.placeholder = TEXT.minePlaceholder
    input.required = true
    const submit = el('button', 'auth-btn', TEXT.mineAdd)
    submit.type = 'submit'
    const note = el('p', 'study-note lesson-add-note', '')
    form.append(input, submit)
    const grid = el('div', 'lesson-grid')
    box.append(form, note, grid)

    // 被叫去登入之前先把打好的網址記起來:登入完頁面會重新載入,不能讓他再貼一次
    input.value = stash.take()

    const signedIn = Boolean(window.teSession.user())
    if (!signedIn) {
      note.textContent = TEXT.mineLogin
      form.onsubmit = (event) => {
        event.preventDefault()
        stash.keep(input.value.trim())
        window.teSession.login()
      }
      return box
    }

    async function refresh() {
      const res = await getJson('/api/my-songs')
      if (!res.ok) return
      note.textContent = TEXT.mineQuota(res.data.used, res.data.limit)
      grid.replaceChildren()
      for (const item of res.data.items) grid.append(mineCard(item, refresh))
      if (res.data.items.length === 0) grid.append(el('p', 'watch-status mine-empty', TEXT.mineEmpty))
    }

    form.onsubmit = async (event) => {
      event.preventDefault()
      submit.disabled = true
      note.textContent = TEXT.mineAdding
      try {
        const token = window.teSession.getToken()
        const res = await fetch('/api/my-songs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ url: input.value.trim() })
        })
        const body = await res.json().catch(() => ({}))
        if (res.ok && body.success) {
          input.value = ''
          await refresh()
          // 加好了就直接進去練,不用自己再點一次
          location.href = `/type?mine=${encodeURIComponent(body.data.id)}`
          return
        }
        // 被擋下來時伺服器會說還要等多久,那比罐頭訊息有用
        note.textContent =
          body.error === 'rate_limited' && body.detail ? body.detail : TEXT.mineErrors[body.error] || TEXT.mineErrors.default
      } catch {
        note.textContent = TEXT.mineErrors.default
      } finally {
        submit.disabled = false
      }
    }

    await refresh()
    return box
  }

  // 自己加的歌的卡片:多一個移除
  function mineCard(item, onRemoved) {
    const wrap = el('div', 'mine-card')
    wrap.append(songCard(item))
    const remove = el('button', 'mine-remove', TEXT.mineRemove)
    remove.type = 'button'
    remove.onclick = async () => {
      if (!confirm(TEXT.mineRemoveConfirm(item.title))) return
      const token = window.teSession.getToken()
      await fetch(`/api/my-songs/${encodeURIComponent(item.id)}/delete`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      }).catch(() => {})
      await onRemoved()
    }
    wrap.append(remove)
    return wrap
  }

  window.teTypeList = { render: renderList }
})()

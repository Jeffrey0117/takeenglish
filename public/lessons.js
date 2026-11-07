// 影片學習:列表 → 單支影片(左邊影片、右邊逐句中英字幕,每個字可點,點一句從那句開始播)
// 學習模式人人可以按、可以用(單句重複、慢速、聽寫、字幕切換、重點整理);
// 能用的範圍是看得到的那幾句,往後播或想看完整重點才撞牆,這時才推銷升級。
const TEXT = {
  heading: '影片學習',
  sub: '看短影片學英文:逐句中英字幕,每個字點了就懂。',
  prev: '上一頁',
  next: '下一頁',
  page: (n, total) => `${n} / ${total}`,
  empty: '還沒有影片',
  error: '載入失敗,重新整理再試一次',
  notFound: '找不到這支影片',
  back: '← 所有影片',
  noVideo: '這支影片暫時不能播放,字幕照常可以看',
  login: '免費登入',
  upgrade: '升級 Pro',
  lockedLines: (n) => `後面還有 ${n} 句`,
  seeRest: '看完整支',
  modesTitle: '學習模式',
  display: { en: '英文', both: '中英', zh: '中文' },
  repeat: '單句重複',
  speed: (rate) => `${rate}x`,
  dictation: '聽寫',
  dictationHint: '點一下句子看答案',
  summary: '重點整理',
  keyPoints: '重點',
  quotes: '金句',
  words: '單字表',
  summaryMore: (points, quotes) =>
    [points ? `還有 ${points} 個重點` : '', quotes ? `${quotes} 句金句` : ''].filter(Boolean).join('、'),
  // 撞牆時的升級視窗(只在這裡推銷)
  wallTitle: '這支影片後面還有',
  wallPrice: (price, cycle) => `NT$${Number(price).toLocaleString()} / ${cycle === 'yearly' ? '年' : '月'}`,
  wallPoints: ['完整影片與逐字稿', '單句重複、慢速、聽寫不受限', '完整重點整理與單字表', '片語搜尋看全部結果'],
  wallGuestHint: '先免費登入,可以多看幾句',
  wallPlans: '看方案',
  wallWorking: '前往付款頁…',
  wallFailed: '付款服務暫時連不上,稍後再試',
  minutes: (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
}
const SPEEDS = [1, 0.75, 0.5]
const DISPLAY_ORDER = ['both', 'en', 'zh']

const $ = (sel) => document.querySelector(sel)
const params = new URLSearchParams(location.search)
const { el, renderLine, closeTips } = window.teStudy

// 只收我們自己的媒體路徑
function mediaUrl(value) {
  return typeof value === 'string' && /^[/]lesson-media[/][0-9a-f-]{36}[/](video|thumb[.]jpg)$/.test(value) ? value : ''
}

async function getJson(url) {
  await window.teSession.ready
  const token = window.teSession.getToken()
  const res = await fetch(url, { cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {} })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, ok: res.ok && body.success === true, data: body.data }
}

function lessonCard(item) {
  const card = el('a', 'lesson-card')
  card.href = `/lessons?id=${encodeURIComponent(item.id)}`
  const cover = el('div', 'lesson-cover')
  const thumb = mediaUrl(item.thumb)
  if (thumb) cover.style.backgroundImage = `url("${thumb}")`
  if (item.duration) cover.append(el('span', 'lesson-duration', TEXT.minutes(item.duration)))
  card.append(cover, el('p', 'lesson-title', item.title), el('p', 'lesson-channel', item.channel))
  return card
}

async function renderList() {
  const page = Math.max(Number.parseInt(params.get('page') || '0', 10) || 0, 0)
  const res = await getJson(`/api/lessons?page=${page}`)
  const main = $('#lesson-main')
  if (!res.ok) {
    $('#lesson-status').textContent = TEXT.error
    return
  }
  main.replaceChildren(el('h1', 'watch-title', TEXT.heading), el('p', 'lesson-sub', TEXT.sub))
  if (res.data.items.length === 0) {
    main.append(el('p', 'watch-status', TEXT.empty))
    return
  }
  const grid = el('div', 'lesson-grid')
  for (const item of res.data.items) grid.append(lessonCard(item))
  main.append(grid)
  if (res.data.pages > 1) {
    const pager = el('div', 'lesson-pager')
    const link = (label, target, disabled) => {
      const a = el('a', 'auth-btn quiet', label)
      if (disabled) a.classList.add('disabled')
      else a.href = `/lessons?page=${target}`
      return a
    }
    pager.append(
      link(TEXT.prev, res.data.page - 1, res.data.page === 0),
      el('span', 'lesson-page', TEXT.page(res.data.page + 1, res.data.pages)),
      link(TEXT.next, res.data.page + 1, res.data.page + 1 >= res.data.pages)
    )
    main.append(pager)
  }
}

// 從指定秒數開始播;影片還沒載入時先等它知道片長
function playFrom(video, seconds) {
  const jump = () => {
    video.currentTime = seconds
    video.play().catch(() => {})
  }
  if (video.readyState >= 1) return jump()
  video.addEventListener('loadedmetadata', jump, { once: true })
  video.play().catch(() => {})
}

function loginButton() {
  const b = el('button', 'auth-btn', TEXT.login)
  b.type = 'button'
  b.onclick = () => window.teSession.login()
  return b
}

async function checkout(btn, note) {
  btn.disabled = true
  note.textContent = TEXT.wallWorking
  try {
    const token = window.teSession.getToken()
    const res = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: '{}'
    })
    const body = await res.json().catch(() => ({}))
    const url = body.data && body.data.checkoutUrl
    if (res.ok && typeof url === 'string' && /^https?:[/][/]/.test(url)) {
      location.href = url
      return
    }
    if (res.status === 409) {
      location.reload()
      return
    }
  } catch {
    /* 落到下面的錯誤訊息 */
  }
  btn.disabled = false
  note.textContent = TEXT.wallFailed
}

// 撞牆:影片播到被鎖的地方、或想看完整內容時,才跳出升級視窗
function showWall(lesson) {
  if (document.querySelector('.wall')) return
  const billing = (window.teSession.config() || {}).billing || {}
  const overlay = el('div', 'modal wall')
  const card = el('div', 'modal-card')
  const close = el('button', 'modal-close', '×')
  close.type = 'button'
  close.onclick = () => overlay.remove()
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove()
  }
  card.append(close, el('p', 'modal-title', TEXT.wallTitle))
  if (lesson.lockedLines) card.append(el('p', 'wall-count', TEXT.lockedLines(lesson.lockedLines)))
  if (billing.enabled && billing.plan) card.append(el('p', 'modal-price', TEXT.wallPrice(billing.plan.price, billing.plan.cycle)))
  const list = el('ul', 'modal-list')
  for (const point of TEXT.wallPoints) list.append(el('li', '', point))
  card.append(list)
  const note = el('p', 'modal-note', '')
  card.append(note)
  if (!lesson.signedIn) {
    note.textContent = TEXT.wallGuestHint
    const login = loginButton()
    login.onclick = () => {
      overlay.remove()
      window.teSession.login()
    }
    const plans = el('a', 'auth-btn quiet', TEXT.wallPlans)
    plans.href = '/#plans'
    card.append(login, plans)
  } else {
    const buy = el('button', 'auth-btn', TEXT.upgrade)
    buy.type = 'button'
    buy.onclick = () => checkout(buy, note)
    card.append(buy)
  }
  overlay.append(card)
  document.body.append(overlay)
}

// 重點整理:主旨、重點、金句、這支影片的單字表。非 Pro 看到的是預覽,後面接「還有幾個」
function summaryPanel(lesson) {
  const box = el('div', 'lesson-summary')
  if (lesson.theme) box.append(el('p', 'lesson-summary-theme', lesson.theme))
  const s = lesson.summary || {}
  if (s.keyPoints && s.keyPoints.length) {
    box.append(el('h3', 'lesson-summary-h', TEXT.keyPoints))
    const list = el('ul', 'lesson-summary-list')
    for (const point of s.keyPoints) list.append(el('li', '', point))
    box.append(list)
  }
  if (s.quotes && s.quotes.length) {
    box.append(el('h3', 'lesson-summary-h', TEXT.quotes))
    for (const quote of s.quotes) box.append(renderLine({ text: quote.en, zh: quote.zh, vocab: [] }))
  }
  if (s.preview && (s.lockedPoints || s.lockedQuotes)) {
    const more = el('button', 'lesson-summary-more', `${TEXT.summaryMore(s.lockedPoints, s.lockedQuotes)} →`)
    more.type = 'button'
    more.onclick = () => showWall(lesson)
    box.append(more)
  }
  const seen = new Set()
  const words = []
  for (const segment of lesson.segments) {
    for (const v of segment.vocab || []) {
      const key = v.word.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      words.push(v)
    }
  }
  if (words.length) {
    box.append(el('h3', 'lesson-summary-h', TEXT.words))
    const table = el('div', 'lesson-words')
    for (const v of words) {
      const link = el('a', 'lesson-word', v.word)
      link.href = `/?q=${encodeURIComponent(v.word)}`
      table.append(link, el('span', 'lesson-word-zh', v.zh))
    }
    box.append(table)
  }
  return box
}

async function renderLesson(id) {
  const res = await getJson(`/api/lessons/${encodeURIComponent(id)}`)
  const main = $('#lesson-main')
  if (!res.ok) {
    $('#lesson-status').textContent = res.status === 404 ? TEXT.notFound : TEXT.error
    return
  }
  const lesson = res.data
  document.title = `${lesson.title}｜${TEXT.heading}｜takeENGLISH`

  const state = { display: lesson.notes ? 'both' : 'en', repeat: false, speed: 0, dictation: false, active: -1 }

  const back = el('a', 'lesson-back', TEXT.back)
  back.href = '/lessons'
  const layout = el('div', 'lesson-layout')
  const left = el('div', 'lesson-left')
  const right = el('div', 'lesson-right')
  const toolbar = el('div', 'lesson-toolbar')
  const extra = el('div', 'lesson-extra')
  const panel = el('div', 'lesson-lines')

  const src = mediaUrl(lesson.video)
  let video = null
  if (src) {
    video = document.createElement('video')
    video.className = 'lesson-video'
    video.controls = true
    video.playsInline = true
    video.preload = 'metadata'
    video.src = src
    const poster = mediaUrl(lesson.thumb)
    if (poster) video.poster = poster
    video.setAttribute('controlslist', 'nodownload noremoteplayback')
    video.oncontextmenu = (e) => e.preventDefault()
    left.append(video)
  } else {
    left.append(el('p', 'study-note', TEXT.noVideo))
  }
  left.append(el('h1', 'lesson-heading', lesson.title))
  left.append(el('p', 'lesson-channel', lesson.channel))
  if (lesson.theme) left.append(el('p', 'lesson-theme', lesson.theme))

  // ---- 逐字稿 ----
  const rows = lesson.segments.map((segment, index) => {
    const row = renderLine(segment)
    row.dataset.index = String(index)
    if (video) {
      row.classList.add('seekable')
      row.onclick = () => {
        closeTips(panel)
        // 聽寫模式下,點一下是看答案
        if (state.dictation) row.classList.add('revealed')
        state.active = index
        playFrom(video, segment.start)
      }
    }
    panel.append(row)
    return { row, start: segment.start, end: segment.end }
  })
  if (lesson.lockedLines > 0) {
    const lock = el('div', 'lesson-lock')
    lock.append(el('p', 'lock-title', TEXT.lockedLines(lesson.lockedLines)))
    const more = el('button', 'auth-btn', TEXT.seeRest)
    more.type = 'button'
    more.onclick = () => showWall(lesson)
    lock.append(more)
    panel.append(lock)
  }

  function applyDisplay() {
    panel.classList.toggle('hide-zh', state.display === 'en')
    panel.classList.toggle('hide-en', state.display === 'zh')
    panel.classList.toggle('dictation', state.dictation)
    if (!state.dictation) for (const r of rows) r.row.classList.remove('revealed')
  }

  // ---- 學習模式工具列 ----
  function tool(label, onClick) {
    const btn = el('button', 'study-btn lesson-tool', label)
    btn.type = 'button'
    btn.onclick = () => onClick(btn)
    toolbar.append(btn)
    return btn
  }
  toolbar.append(el('span', 'lesson-toolbar-title', TEXT.modesTitle))
  if (lesson.notes) {
    tool(TEXT.display[state.display], (btn) => {
      state.display = DISPLAY_ORDER[(DISPLAY_ORDER.indexOf(state.display) + 1) % DISPLAY_ORDER.length]
      btn.textContent = TEXT.display[state.display]
      applyDisplay()
    })
  }
  if (video) {
    tool(TEXT.repeat, (btn) => {
      state.repeat = !state.repeat
      btn.classList.toggle('on', state.repeat)
      // 還沒選句子就從目前播到的那句開始重複
      if (state.repeat && state.active < 0) {
        const now = video.currentTime
        state.active = Math.max(0, rows.findIndex((r) => now >= r.start && now < r.end))
      }
    })
    tool(TEXT.speed(SPEEDS[0]), (btn) => {
      state.speed = (state.speed + 1) % SPEEDS.length
      video.playbackRate = SPEEDS[state.speed]
      btn.textContent = TEXT.speed(SPEEDS[state.speed])
      btn.classList.toggle('on', state.speed !== 0)
    })
  }
  tool(TEXT.dictation, (btn) => {
    state.dictation = !state.dictation
    btn.classList.toggle('on', state.dictation)
    extra.replaceChildren()
    if (state.dictation) extra.append(el('p', 'study-note', TEXT.dictationHint))
    applyDisplay()
  })
  tool(TEXT.summary, (btn) => {
    const open = !btn.classList.contains('on')
    btn.classList.toggle('on', open)
    extra.replaceChildren()
    if (open) extra.append(summaryPanel(lesson))
  })

  // 播到哪一句就亮哪一句;單句重複時播完那句就跳回句首;播到被鎖的地方就撞牆
  if (video) {
    video.addEventListener('timeupdate', () => {
      const now = video.currentTime
      if (lesson.lockedFrom !== null && now >= lesson.lockedFrom) {
        video.pause()
        video.currentTime = Math.max(lesson.lockedFrom - 0.2, 0)
        showWall(lesson)
        return
      }
      if (state.repeat && state.active >= 0 && rows[state.active]) {
        const line = rows[state.active]
        if (now >= line.end || now < line.start - 0.5) {
          video.currentTime = line.start
          return
        }
      }
      rows.forEach((line, index) => {
        const active = now >= line.start && now < line.end
        if (active && !line.row.classList.contains('active')) {
          line.row.scrollIntoView({ block: 'nearest' })
          if (!state.repeat) state.active = index
        }
        line.row.classList.toggle('active', active)
      })
    })
  }

  applyDisplay()
  right.append(toolbar, extra, panel)
  layout.append(left, right)
  main.replaceChildren(back, layout)

  // 登入狀態真的變了(登入/登出)才重新載入。登入元件啟動時也會回報一次「目前是誰」,
  // 那一次身分沒變,不能重載,不然會一直重整
  const identity = (user) => (user ? user.id || user.sub || user.email || 'signed-in' : null)
  const loadedAs = identity(window.teSession.user())
  window.teSession.onChange((user) => {
    if (identity(user) !== loadedAs) location.reload()
  })
}

async function init() {
  try {
    const id = params.get('id')
    if (id) await renderLesson(id)
    else await renderList()
  } catch {
    $('#lesson-status').textContent = TEXT.error
  }
}

init()

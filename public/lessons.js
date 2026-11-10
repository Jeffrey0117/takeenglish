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
  // 撞牆時的升級視窗(只在這裡推銷;視窗的按鈕文字在 wall.js)
  wallTitle: '看完整支影片',
  wallPoints: ['完整影片與逐字稿', '單句重複、慢速、聽寫不受限', '完整重點整理與單字表', '片語搜尋看全部結果'],
  wallGuestHint: '先免費登入,可以多看幾句',
  mine: '我的影片',
  mineHint: '貼上 YouTube 連結,自動轉成逐句字幕,每個字都能點',
  minePlaceholder: 'https://www.youtube.com/watch?v=…',
  mineAdd: '加入',
  mineAdding: '加入中…',
  mineEmpty: '還沒有自己的影片',
  mineBadUrl: '這個連結不支援,請貼 YouTube 影片連結',
  mineLimit: '這個月加的影片已經到上限',
  mineFailed: '加入失敗,稍後再試',
  mineStatus: { downloading: '下載中…', transcribing: '轉字幕中…', ready: '', failed: '處理失敗' },
  processing: '影片處理中,通常幾分鐘,完成後會自動顯示',
  uploadWallTitle: '把任何 YouTube 影片變成教材',
  uploadWallPoints: ['貼連結自動轉成逐句字幕', '每個字點了就懂', '單句重複、慢速、聽寫', '完整影片學習區與片語搜尋'],
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

// 頁面訊息。第一次 render 之後 #lesson-status 就被 replaceChildren 換掉了,不能假設它還在 —
// 不然這裡自己會丟 TypeError,使用者看到的是半張畫面加上沒有任何訊息
function status(message) {
  const node = $('#lesson-status')
  if (node) node.textContent = message
  else $('#lesson-main').replaceChildren(el('p', 'watch-status', message))
}

async function getJson(url) {
  await window.teSession.ready
  const token = window.teSession.getToken()
  const res = await fetch(url, { cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {} })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, ok: res.ok && body.success === true, data: body.data }
}

function lessonCard(item, { mine = false } = {}) {
  const card = el('a', 'lesson-card')
  card.href = mine ? `/lessons?mine=${encodeURIComponent(item.id)}` : `/lessons?id=${encodeURIComponent(item.id)}`
  const cover = el('div', 'lesson-cover')
  const thumb = mediaUrl(item.thumb)
  if (thumb) cover.style.backgroundImage = `url("${thumb}")`
  if (item.duration) cover.append(el('span', 'lesson-duration', TEXT.minutes(item.duration)))
  const status = mine && TEXT.mineStatus[item.status]
  if (status) cover.append(el('span', `lesson-status ${item.status}`, status))
  card.append(cover, el('p', 'lesson-title', item.title), el('p', 'lesson-channel', item.channel))
  return card
}

async function renderList() {
  const page = Math.max(Number.parseInt(params.get('page') || '0', 10) || 0, 0)
  const res = await getJson(`/api/lessons?page=${page}`)
  const main = $('#lesson-main')
  if (!res.ok) {
    status(TEXT.error)
    return
  }
  main.replaceChildren(el('h1', 'watch-title', TEXT.heading), el('p', 'lesson-sub', TEXT.sub))
  main.append(await mineSection())
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

// ---- 我的影片:貼連結加、看處理進度 ----

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
  box.append(form, note)
  const grid = el('div', 'lesson-grid')
  box.append(grid)

  const signedIn = Boolean(window.teSession.user())
  let canAdd = false
  let timer = null

  async function refresh() {
    const res = await getJson('/api/my-lessons')
    if (!res.ok) return
    canAdd = res.data.canAdd
    grid.replaceChildren()
    for (const item of res.data.items) grid.append(lessonCard(item, { mine: true }))
    if (res.data.items.length === 0) grid.append(el('p', 'watch-status mine-empty', TEXT.mineEmpty))
    // 還有在處理的就每 10 秒再問一次
    clearTimeout(timer)
    if (res.data.items.some((item) => item.status === 'downloading' || item.status === 'transcribing')) {
      timer = setTimeout(refresh, 10_000)
    }
  }

  form.onsubmit = async (event) => {
    event.preventDefault()
    // 沒登入:先登入;不是 Pro:這裡撞牆
    if (!signedIn) return window.teSession.login()
    if (!canAdd) {
      return showWall({ signedIn: true, lockedLines: 0 }, { title: TEXT.uploadWallTitle, points: TEXT.uploadWallPoints })
    }
    submit.disabled = true
    note.textContent = TEXT.mineAdding
    try {
      const token = window.teSession.getToken()
      const res = await fetch('/api/my-lessons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ url: input.value.trim() })
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 402) {
        note.textContent = ''
        showWall({ signedIn: true, lockedLines: 0 }, { title: TEXT.uploadWallTitle, points: TEXT.uploadWallPoints })
      } else if (!res.ok) {
        note.textContent = res.status === 400 ? TEXT.mineBadUrl : res.status === 429 ? TEXT.mineLimit : TEXT.mineFailed
      } else {
        note.textContent = ''
        input.value = ''
        await refresh()
        if (body.data && body.data.id && body.data.status === 'ready') location.href = `/lessons?mine=${encodeURIComponent(body.data.id)}`
      }
    } catch {
      note.textContent = TEXT.mineFailed
    } finally {
      submit.disabled = false
    }
  }

  if (signedIn) await refresh()
  else grid.append(el('p', 'watch-status mine-empty', TEXT.mineEmpty))
  return box
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

// 撞牆:影片播到被鎖的地方、或想看完整內容時,才跳出升級視窗(視窗本身在 wall.js,跟聽歌練打共用)
function showWall(lesson, { title = TEXT.wallTitle, points = TEXT.wallPoints } = {}) {
  window.teWall.show({
    signedIn: lesson.signedIn,
    title,
    points,
    count: lesson.lockedLines ? TEXT.lockedLines(lesson.lockedLines) : '',
    guestHint: TEXT.wallGuestHint
  })
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

async function renderLesson(id, { mine = false } = {}) {
  const res = await getJson(mine ? `/api/my-lessons/${encodeURIComponent(id)}` : `/api/lessons/${encodeURIComponent(id)}`)
  const main = $('#lesson-main')
  if (!res.ok) {
    status(res.status === 404 || res.status === 401 ? TEXT.notFound : TEXT.error)
    return
  }
  const lesson = res.data
  // 自己的影片還在處理:顯示進度,過一下再來看
  if (mine && lesson.status !== 'ready') {
    const back = el('a', 'lesson-back', TEXT.back)
    back.href = '/lessons'
    const message = lesson.status === 'failed' ? TEXT.mineStatus.failed : TEXT.processing
    main.replaceChildren(back, el('h1', 'lesson-heading', lesson.title), el('p', 'watch-status', message))
    if (lesson.status !== 'failed') setTimeout(() => location.reload(), 10_000)
    return
  }
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
    const mine = params.get('mine')
    if (mine) await renderLesson(mine, { mine: true })
    else if (id) await renderLesson(id)
    else await renderList()
  } catch {
    status(TEXT.error)
  }
}

init()

// 影片學習:列表 → 單支影片(左邊影片、右邊逐句中英字幕,每個字可點,點一句從那句開始播)
// 學習模式(Pro):單句重複、慢速、遮字幕聽寫、字幕中英切換、重點整理
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
  loginForNotes: '登入後可以看中文翻譯與重點片語',
  login: '免費登入',
  upgrade: '升級 Pro',
  lockedGuest: (n) => `還有 ${n} 句沒顯示,免費登入可以多看幾句`,
  lockedMember: (n) => `還有 ${n} 句沒顯示,Pro 看完整逐字稿`,
  modesTitle: '學習模式',
  proOnly: 'PRO',
  modesLocked: '學習模式是 Pro 功能',
  display: { en: '英文', both: '中英', zh: '中文' },
  repeat: '單句重複',
  speed: (rate) => `${rate}x`,
  dictation: '聽寫',
  dictationHint: '點一下句子看答案',
  summary: '重點整理',
  keyPoints: '重點',
  quotes: '金句',
  words: '單字表',
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

function upgradeButton() {
  const a = el('a', 'auth-btn', TEXT.upgrade)
  a.href = '/#plans'
  a.style.textDecoration = 'none'
  return a
}

function loginButton() {
  const b = el('button', 'auth-btn', TEXT.login)
  b.type = 'button'
  b.onclick = () => window.teSession.login()
  return b
}

// 沒權限的人按到學習模式:不偷偷失效,直接告訴他這是 Pro 功能
function lockedNotice(box) {
  box.replaceChildren()
  const note = el('p', 'study-note', TEXT.modesLocked)
  note.append(upgradeButton())
  box.append(note)
}

// 重點整理:主旨、重點、金句、這支影片的單字表
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
  if (!lesson.notes) {
    const note = el('p', 'study-note', TEXT.loginForNotes)
    note.append(loginButton())
    left.append(note)
  }

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
    lock.append(el('p', 'lock-title', lesson.signedIn ? TEXT.lockedMember(lesson.lockedLines) : TEXT.lockedGuest(lesson.lockedLines)))
    lock.append(lesson.signedIn ? upgradeButton() : loginButton())
    panel.append(lock)
  }

  function applyDisplay() {
    panel.classList.toggle('hide-zh', state.display === 'en')
    panel.classList.toggle('hide-en', state.display === 'zh')
    panel.classList.toggle('dictation', state.dictation)
    if (!state.dictation) for (const r of rows) r.row.classList.remove('revealed')
  }

  // ---- 學習模式工具列 ----
  const buttons = {}
  function tool(key, label, onClick, { pro = true } = {}) {
    const btn = el('button', 'study-btn lesson-tool', label)
    btn.type = 'button'
    if (pro && !lesson.modes) btn.append(el('span', 'ep-lock', TEXT.proOnly))
    btn.onclick = () => {
      if (pro && !lesson.modes) return lockedNotice(extra)
      onClick(btn)
    }
    buttons[key] = btn
    toolbar.append(btn)
    return btn
  }
  toolbar.append(el('span', 'lesson-toolbar-title', TEXT.modesTitle))
  if (lesson.notes) {
    tool('display', TEXT.display[state.display], (btn) => {
      state.display = DISPLAY_ORDER[(DISPLAY_ORDER.indexOf(state.display) + 1) % DISPLAY_ORDER.length]
      btn.textContent = TEXT.display[state.display]
      applyDisplay()
    }, { pro: false })
  }
  if (video) {
    tool('repeat', TEXT.repeat, (btn) => {
      state.repeat = !state.repeat
      btn.classList.toggle('on', state.repeat)
      // 還沒選句子就從目前播到的那句開始重複
      if (state.repeat && state.active < 0) {
        const now = video.currentTime
        state.active = Math.max(0, rows.findIndex((r) => now >= r.start && now < r.end))
      }
    })
    tool('speed', TEXT.speed(SPEEDS[0]), (btn) => {
      state.speed = (state.speed + 1) % SPEEDS.length
      video.playbackRate = SPEEDS[state.speed]
      btn.textContent = TEXT.speed(SPEEDS[state.speed])
      btn.classList.toggle('on', state.speed !== 0)
    })
  }
  tool('dictation', TEXT.dictation, (btn) => {
    state.dictation = !state.dictation
    btn.classList.toggle('on', state.dictation)
    extra.replaceChildren()
    if (state.dictation) extra.append(el('p', 'study-note', TEXT.dictationHint))
    applyDisplay()
  })
  tool('summary', TEXT.summary, (btn) => {
    const open = !btn.classList.contains('on')
    btn.classList.toggle('on', open)
    extra.replaceChildren()
    if (open) extra.append(summaryPanel(lesson))
  })

  // 播到哪一句就亮哪一句;單句重複時,播完那句就跳回句首
  if (video) {
    video.addEventListener('timeupdate', () => {
      const now = video.currentTime
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

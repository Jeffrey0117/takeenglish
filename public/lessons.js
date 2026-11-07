// 影片學習:列表 → 單支影片(左邊影片、右邊逐句中英字幕,每個字可點,點一句從那句開始播)
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
  minutes: (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
}

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

async function renderLesson(id) {
  const res = await getJson(`/api/lessons/${encodeURIComponent(id)}`)
  const main = $('#lesson-main')
  if (!res.ok) {
    $('#lesson-status').textContent = res.status === 404 ? TEXT.notFound : TEXT.error
    return
  }
  const lesson = res.data
  document.title = `${lesson.title}｜${TEXT.heading}｜takeENGLISH`

  const back = el('a', 'lesson-back', TEXT.back)
  back.href = '/lessons'
  const layout = el('div', 'lesson-layout')
  const left = el('div', 'lesson-left')
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
    const login = el('button', 'auth-btn', TEXT.login)
    login.onclick = () => window.teSession.login()
    note.append(login)
    left.append(note)
  }

  const rows = lesson.segments.map((segment) => {
    const row = renderLine(segment)
    if (video) {
      row.classList.add('seekable')
      row.onclick = () => {
        closeTips(panel)
        playFrom(video, segment.start)
      }
    }
    panel.append(row)
    return { row, start: segment.start, end: segment.end }
  })
  // 播到哪一句就亮哪一句
  if (video) {
    video.addEventListener('timeupdate', () => {
      const now = video.currentTime
      for (const line of rows) {
        const active = now >= line.start && now < line.end
        if (active && !line.row.classList.contains('active')) line.row.scrollIntoView({ block: 'nearest' })
        line.row.classList.toggle('active', active)
      }
    })
  }

  layout.append(left, panel)
  main.replaceChildren(back, layout)
  // 登入狀態變了(登入/登出)就重新載入,拿到對應權限的內容
  window.teSession.onChange(() => location.reload())
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

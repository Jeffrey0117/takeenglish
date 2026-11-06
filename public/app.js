const HOT_PHRASES = [
  'get a life',
  'break a leg',
  'piece of cake',
  'call it a day',
  'hit the road',
  'you nailed it',
  'no offense',
  'fair enough'
]
const PAGE_SIZE = 30

const state = {
  query: '',
  from: 0,
  total: 0,
  loading: false,
  config: { letmeuse: { appId: null, baseUrl: null }, freeLimit: 3 },
  user: null
}

const $ = (sel) => document.querySelector(sel)

function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text || ''
  return div.innerHTML
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 先高亮整句,找不到再逐字高亮
function highlight(text, query) {
  const safe = escapeHtml(text)
  const whole = new RegExp(escapeRegExp(escapeHtml(query)), 'gi')
  if (whole.test(safe)) {
    return safe.replace(whole, (m) => `<mark>${m}</mark>`)
  }
  const words = query.split(/\s+/).filter((w) => w.length > 2)
  if (words.length === 0) return safe
  const pattern = new RegExp(`\\b(${words.map(escapeRegExp).join('|')})\\b`, 'gi')
  return safe.replace(pattern, (m) => `<mark>${m}</mark>`)
}

function setSearchingMode(on) {
  document.body.classList.toggle('searching', on)
  $('#results').classList.toggle('hidden', !on)
}

function renderChips(container, phrases, onPick) {
  container.replaceChildren()
  for (const phrase of phrases) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'chip'
    chip.textContent = phrase
    chip.onclick = () => onPick(phrase)
    container.appendChild(chip)
  }
}

function episodeLabel(clip) {
  if (!clip.season) return clip.movieYear ? `(${clip.movieYear})` : ''
  const s = String(clip.season).padStart(2, '0')
  const e = String(clip.episode || 0).padStart(2, '0')
  return `S${s}E${e}`
}

function clipCard(clip, query) {
  const card = document.createElement('article')
  card.className = 'clip-card'
  card.innerHTML = `
    <div class="player">
      <video preload="none" playsinline src="${escapeHtml(clip.mp4 || '')}"></video>
      <div class="play-badge"></div>
    </div>
    <div class="clip-body">
      <p class="clip-text">${highlight(clip.text || '', query)}</p>
      <div class="clip-meta">
        <span class="show">${escapeHtml(clip.movieTitle || '')} ${episodeLabel(clip)}</span>
        <span>${clip.duration ? `${clip.duration}s` : ''}</span>
      </div>
    </div>
  `
  const player = card.querySelector('.player')
  const video = card.querySelector('video')
  player.onclick = () => {
    if (player.classList.contains('playing')) return
    player.classList.add('playing')
    video.controls = true
    video.play().catch(() => {})
  }
  video.onplay = () => {
    for (const other of document.querySelectorAll('video')) {
      if (other !== video) other.pause()
    }
  }
  return card
}

// ---- 登入 (LetMeUse) ----

function sdk() {
  return window.letmeuse
}

function getToken() {
  const s = sdk()
  return s && s.ready && state.user ? s.getToken() : null
}

function authEnabled() {
  return Boolean(state.config.letmeuse.appId)
}

function renderAuth() {
  for (const area of [$('#auth-head'), $('#auth-corner')]) {
    area.replaceChildren()
    if (!authEnabled()) continue
    if (state.user) {
      const name = document.createElement('span')
      name.className = 'auth-user'
      name.textContent = state.user.name || state.user.email || ''
      const logout = document.createElement('button')
      logout.className = 'auth-btn quiet'
      logout.textContent = '登出'
      logout.onclick = () => sdk()?.logout()
      area.append(name, logout)
    } else {
      const login = document.createElement('button')
      login.className = 'auth-btn'
      login.textContent = '登入'
      login.onclick = () => sdk()?.login()
      area.appendChild(login)
    }
  }
}

function waitForLetMeUse() {
  return new Promise((resolve) => {
    if (sdk()?.ready) return resolve()
    const check = setInterval(() => {
      if (sdk()?.ready) {
        clearInterval(check)
        resolve()
      }
    }, 100)
    setTimeout(() => {
      clearInterval(check)
      resolve()
    }, 5000)
  })
}

async function initAuth() {
  try {
    const res = await fetch('/api/config')
    const body = await res.json()
    if (body.success) state.config = body.data
  } catch {
    return
  }
  const { appId, baseUrl } = state.config.letmeuse
  if (!appId || !baseUrl) return

  const script = document.createElement('script')
  script.src = `${baseUrl}/letmeuse.js`
  script.dataset.appId = appId
  script.dataset.theme = 'dark'
  script.dataset.accent = '#ffd60a'
  script.dataset.locale = 'zh'
  script.dataset.mode = 'modal'
  document.head.appendChild(script)

  await waitForLetMeUse()
  const s = sdk()
  if (!s?.ready) return
  state.user = s.user
  renderAuth()
  s.onAuthChange((user) => {
    state.user = user
    renderAuth()
    if (state.query) search(state.query)
  })
}

// ---- 搜尋 ----

async function fetchPage() {
  const loose = $('#loose-toggle').checked
  const url = `/api/search?q=${encodeURIComponent(state.query)}&from=${state.from}&size=${PAGE_SIZE}&slop=${loose ? 3 : 0}`
  const token = getToken()
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })
  const body = await res.json()
  if (!body.success) throw new Error(body.error || `HTTP ${res.status}`)
  return body.data
}

function lockPanel(total) {
  const panel = document.createElement('div')
  panel.className = 'lock-panel'
  const count = Math.max(total - state.config.freeLimit, 0)
  panel.innerHTML = `
    <p class="lock-title">還有 <b>${count.toLocaleString()}</b> 個片段沒看到</p>
    <p class="lock-sub">免費版顯示前 ${state.config.freeLimit} 筆,登入就能解鎖全部結果</p>
  `
  if (authEnabled()) {
    const btn = document.createElement('button')
    btn.className = 'auth-btn'
    btn.textContent = '免費登入解鎖'
    btn.onclick = () => sdk()?.login()
    panel.appendChild(btn)
  }
  return panel
}

async function search(query, { append = false } = {}) {
  const trimmed = (query || '').trim()
  if (!trimmed || state.loading) return

  state.loading = true
  const status = $('#results-status')
  const grid = $('#results-grid')
  const moreBtn = $('#btn-more')
  moreBtn.disabled = true

  if (!append) {
    state.query = trimmed
    state.from = 0
    $('#mini-search-input').value = trimmed
    setSearchingMode(true)
    grid.replaceChildren()
    $('#related-chips').classList.add('hidden')
    status.className = 'status'
    status.textContent = '搜尋中…'
    const params = new URLSearchParams({ q: trimmed })
    history.replaceState(null, '', `?${params}`)
  }

  try {
    const data = await fetchPage()
    state.total = data.total
    state.from += (data.results || []).length

    for (const clip of data.results || []) {
      grid.appendChild(clipCard(clip, state.query))
    }

    status.className = 'status'
    status.innerHTML = `「<b>${escapeHtml(state.query)}</b>」在影集電影裡出現 <b>${state.total.toLocaleString()}</b> 次`

    const related = [...(data.related || []), ...(data.didYouMean || [])].slice(0, 8)
    if (!append && related.length > 0) {
      renderChips($('#related-chips'), related, (p) => search(p))
      $('#related-chips').classList.remove('hidden')
    }
    if (!append && (data.results || []).length === 0) {
      grid.innerHTML = '<p class="status">沒搜到這句,試試「寬鬆搜尋」,或換個講法</p>'
    }

    if (data.limited) {
      grid.appendChild(lockPanel(data.total))
      moreBtn.classList.add('hidden')
    } else {
      moreBtn.classList.toggle(
        'hidden',
        state.from >= state.total || (data.results || []).length === 0
      )
    }
  } catch (err) {
    status.className = 'status error'
    status.textContent = err.message
  } finally {
    state.loading = false
    moreBtn.disabled = false
  }
}

// ---- 綁定 ----

$('#search-form').onsubmit = (e) => {
  e.preventDefault()
  search($('#search-input').value)
}
$('#mini-search-form').onsubmit = (e) => {
  e.preventDefault()
  search($('#mini-search-input').value)
}
$('#btn-more').onclick = () => search(state.query, { append: true })
$('#loose-toggle').onchange = () => search(state.query)
$('#home-link').onclick = (e) => {
  e.preventDefault()
  setSearchingMode(false)
  history.replaceState(null, '', '/')
  $('#search-input').focus()
}

renderChips($('#hot-chips'), HOT_PHRASES, (p) => {
  $('#search-input').value = p
  search(p)
})

initAuth()

const initial = new URLSearchParams(location.search).get('q')
if (initial) {
  $('#search-input').value = initial
  search(initial)
}

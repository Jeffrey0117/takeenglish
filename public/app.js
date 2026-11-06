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
const CC_PREF_KEY = 'takeenglish-cc'
const LANG_LABELS = { en: 'English' }
// 字幕底邊離影片頂端的位置(%)。數字越小字幕越高;100 = 貼在最底
const CAPTION_BOTTOM_PERCENT = 82
// 一行字幕的高度(px),要跟 style.css 的 video::cue 字級 × 行高對得上
const CAPTION_LINE_PX = 21

// 方案區塊與鎖定卡的所有文字都在這裡,要改字只改這一處
const PLAN_COPY = {
  heading: '方案',
  link: '方案',
  names: { guest: '訪客', free: '免費會員', pro: 'Pro' },
  prices: { guest: '不用登入', free: 'NT$0' },
  rows: { results: '搜尋結果', subtitles: '字幕', download: '下載 mp4' },
  all: '全部',
  current: '目前方案',
  login: '免費登入',
  upgrade: '升級 Pro',
  comingSoon: '即將開放'
}
// 從付款頁回來的記號。搜尋會改寫網址,所以一載入就先記下來
const RETURNED_FROM_CHECKOUT = new URLSearchParams(location.search).has('upgraded')

const state = {
  query: '',
  from: 0,
  total: 0,
  loading: false,
  config: {
    letmeuse: { appId: null, baseUrl: null },
    freeLimit: 3,
    tiers: [],
    billing: { enabled: false, plan: null }
  },
  user: null,
  tier: 'guest',
  activeUntil: null,
  captions: readCaptionPref()
}

const $ = (sel) => document.querySelector(sel)

function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text || ''
  // innerHTML 不會跳脫引號,放進屬性值之前要自己補
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
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

function toast(message) {
  const el = $('#toast')
  el.textContent = message
  el.classList.add('show')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => el.classList.remove('show'), 3500)
}

// ---- 縮圖 ----

// 備援:載入影片 metadata 後跳到首幀當縮圖,整支影片不會先下載
function loadFrameFromVideo(video) {
  // 使用者已經開始播(或瀏覽器已載入)就別重載,會打斷播放
  if (!video.paused || video.readyState > 0) return
  video.preload = 'metadata'
  video.addEventListener(
    'loadedmetadata',
    () => {
      try {
        video.currentTime = Math.min(0.5, (video.duration || 1) / 3)
      } catch {
        /* 首幀失敗就維持黑底 */
      }
    },
    { once: true }
  )
  video.load()
}

// 先拿伺服器抽好的首幀 jpg(一張小圖,不用碰影片);拿不到才走備援
function loadThumb(video) {
  const src = video.dataset.thumb
  if (!src) return loadFrameFromVideo(video)
  const img = new Image()
  img.onload = () => {
    video.poster = img.src
  }
  img.onerror = () => loadFrameFromVideo(video)
  img.src = src
}

// 滑進視野才要縮圖
const thumbObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const video = entry.target
      thumbObserver.unobserve(video)
      if (video.dataset.thumbed) continue
      video.dataset.thumbed = '1'
      loadThumb(video)
    }
  },
  { rootMargin: '250px' }
)

// ---- 字幕 ----

function readCaptionPref() {
  try {
    return localStorage.getItem(CC_PREF_KEY) !== 'off'
  } catch {
    return true
  }
}

function setCaptions(on) {
  state.captions = on
  try {
    localStorage.setItem(CC_PREF_KEY, on ? 'on' : 'off')
  } catch {
    /* 存不了就只在這次生效 */
  }
  for (const video of document.querySelectorAll('.player video')) applyCaptions(video)
  for (const btn of document.querySelectorAll('.cc-btn')) btn.classList.toggle('on', on)
}

// 只顯示第一條字幕軌;之後有多語言再做選單,不然會兩種語言疊在一起
function applyCaptions(video) {
  Array.from(video.textTracks).forEach((track, index) => {
    track.mode = state.captions && index === 0 ? 'showing' : 'hidden'
  })
}

// 第一次播放才掛字幕軌,免得一頁三十張卡片一口氣抓三十份字幕
function attachCaptions(video, subs) {
  if (video.dataset.subbed || !subs || subs.length === 0) return
  video.dataset.subbed = '1'
  subs.forEach((sub, index) => {
    const track = document.createElement('track')
    track.kind = 'captions'
    track.srclang = sub.lang
    track.label = LANG_LABELS[sub.lang] || sub.lang
    track.src = sub.url
    track.default = index === 0
    track.addEventListener('load', () => raiseCues(track.track, video))
    video.appendChild(track)
  })
  applyCaptions(video)
}

// 字幕預設貼在影片最底下,會壓到進度條也不好讀,往上提一點。
// 瀏覽器只給「字幕框頂邊在影片的百分之幾」這個參數(Chrome 不支援以底邊定位),
// 所以用這句有幾行、每行多高,反推頂邊該放哪,讓底邊落在 CAPTION_BOTTOM_PERCENT。
function raiseCues(textTrack, video) {
  const height = video.clientHeight || 212
  const linePercent = (CAPTION_LINE_PX / height) * 100
  for (const cue of Array.from(textTrack.cues || [])) {
    try {
      const lines = String(cue.text || '').split('\n').length
      cue.snapToLines = false
      cue.line = Math.max(5, Math.round(CAPTION_BOTTOM_PERCENT - lines * linePercent))
    } catch {
      /* 這個瀏覽器不給調位置就維持預設 */
    }
  }
}

// ---- 卡片 ----

function clipCard(clip, query) {
  const card = document.createElement('article')
  card.className = 'clip-card'
  card.innerHTML = `
    <div class="player">
      <video preload="none" playsinline disablepictureinpicture controlslist="nodownload noremoteplayback" data-thumb="${escapeHtml(clip.thumb || '')}" src="${escapeHtml(clip.video || '')}"></video>
      <div class="play-badge"></div>
      <div class="progress"><div class="progress-fill"></div></div>
    </div>
    <div class="clip-body">
      <p class="clip-text">${highlight(clip.text || '', query)}</p>
      <div class="clip-meta">
        <span class="show">${escapeHtml(clip.movieTitle || '')} ${episodeLabel(clip)}</span>
        <span class="meta-right">${clip.duration ? `${clip.duration}s` : ''}</span>
      </div>
    </div>
  `
  const player = card.querySelector('.player')
  const video = card.querySelector('video')
  const fill = card.querySelector('.progress-fill')
  const hasSubs = Array.isArray(clip.subs) && clip.subs.length > 0

  for (const el of [player, video]) {
    el.oncontextmenu = (e) => e.preventDefault()
  }
  thumbObserver.observe(video)

  player.onclick = () => {
    if (video.paused) {
      video.dataset.started = '1'
      attachCaptions(video, clip.subs)
      video.play().catch(() => {})
    } else {
      video.pause()
    }
  }
  video.onplay = () => {
    player.classList.add('playing')
    for (const other of document.querySelectorAll('video')) {
      if (other !== video) other.pause()
    }
  }
  video.onpause = () => player.classList.remove('playing')
  video.ontimeupdate = () => {
    if (video.duration) fill.style.width = `${(video.currentTime / video.duration) * 100}%`
  }
  video.onended = () => {
    player.classList.remove('playing')
    fill.style.width = '0%'
  }
  // 播放網址幾小時後會過期;頁面放太久再回來播就會載入失敗
  video.onerror = () => {
    if (video.dataset.started) toast('片段載入失敗,重新搜尋一次再試')
  }

  const metaRight = card.querySelector('.meta-right')
  if (hasSubs) {
    const cc = document.createElement('button')
    cc.className = 'cc-btn'
    cc.classList.toggle('on', state.captions)
    cc.textContent = 'CC'
    cc.title = '字幕開關'
    cc.onclick = (e) => {
      e.stopPropagation()
      setCaptions(!state.captions)
    }
    metaRight.appendChild(cc)
  }
  if (clip.id && authEnabled()) {
    const dl = document.createElement('button')
    dl.className = 'dl-btn'
    dl.textContent = '⬇ 下載'
    dl.onclick = (e) => {
      e.stopPropagation()
      downloadClip(clip, dl)
    }
    metaRight.appendChild(dl)
  }
  return card
}

// ---- 登入與會員 (LetMeUse + PayGate) ----

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

function proPlan() {
  const { enabled, plan } = state.config.billing || {}
  return enabled && plan ? plan : null
}

function canDownload() {
  const tier = (state.config.tiers || []).find((t) => t.id === state.tier)
  return Boolean(tier && tier.features.download)
}

// 帶登入身分打自己的 API。POST 一律帶 JSON body(經 CDN 時空 body 的 POST 會出事)
async function api(path, { method = 'GET' } = {}) {
  const token = getToken()
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  const init = { method, headers }
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json'
    init.body = '{}'
  }
  const res = await fetch(path, init)
  const body = await res.json().catch(() => ({}))
  return { status: res.status, ok: res.ok && body.success === true, data: body.data, error: body.error }
}

async function refreshMe({ fresh = false } = {}) {
  if (!state.user) {
    state.tier = 'guest'
    state.activeUntil = null
    return
  }
  const res = await api(`/api/me${fresh ? '?fresh=1' : ''}`).catch(() => null)
  if (res && res.ok) {
    state.tier = res.data.tier
    state.activeUntil = res.data.activeUntil
  } else if (state.tier === 'guest') {
    // 問不到就先當免費會員;已經知道等級的(例如 Pro)不要因為一次網路失敗被降級
    state.tier = 'free'
    state.activeUntil = null
  }
}

function tierInfo(id) {
  return (state.config.tiers || []).find((t) => t.id === id) || null
}

function resultsLabel(limit) {
  return limit === null || limit === undefined ? PLAN_COPY.all : `前 ${limit} 筆`
}

// 三個等級並排:名稱、價格、各自拿到什麼、下一步的按鈕。內容來自 /api/config,跟後端擋的是同一份
function renderPlans(container) {
  container.replaceChildren()
  const tiers = state.config.tiers || []
  if (!authEnabled() || tiers.length === 0) return

  const heading = document.createElement('h2')
  heading.className = 'plans-title'
  heading.textContent = PLAN_COPY.heading
  const grid = document.createElement('div')
  grid.className = 'plans-grid'
  const plan = proPlan()

  for (const tier of tiers) {
    const card = document.createElement('div')
    card.className = 'plan-card'
    const isCurrent = tier.id === state.tier
    card.classList.toggle('current', isCurrent)
    card.classList.toggle('featured', tier.id === 'pro')

    const name = document.createElement('p')
    name.className = 'plan-name'
    name.textContent = PLAN_COPY.names[tier.id] || tier.name
    const price = document.createElement('p')
    price.className = 'plan-price'
    if (tier.id === 'pro') {
      price.textContent = plan
        ? `NT$${Number(plan.price).toLocaleString()} / ${plan.cycle === 'yearly' ? '年' : '月'}`
        : PLAN_COPY.comingSoon
    } else {
      price.textContent = PLAN_COPY.prices[tier.id] || ''
    }

    const list = document.createElement('ul')
    list.className = 'plan-list'
    const rows = [
      [PLAN_COPY.rows.results, resultsLabel(tier.features.results), true],
      [PLAN_COPY.rows.subtitles, '', Boolean(tier.features.subtitles)],
      [PLAN_COPY.rows.download, '', Boolean(tier.features.download)]
    ]
    for (const [label, value, included] of rows) {
      const li = document.createElement('li')
      li.classList.toggle('off', !included)
      li.textContent = value ? `${label} ${value}` : label
      list.appendChild(li)
    }
    card.append(name, price, list)

    if (isCurrent) {
      const tag = document.createElement('p')
      tag.className = 'plan-current'
      tag.textContent = PLAN_COPY.current
      card.appendChild(tag)
    } else if (tier.id === 'free' && !state.user) {
      const btn = document.createElement('button')
      btn.className = 'auth-btn'
      btn.textContent = PLAN_COPY.login
      btn.onclick = () => {
        closeModal()
        sdk()?.login()
      }
      card.appendChild(btn)
    } else if (tier.id === 'pro' && plan) {
      const btn = document.createElement('button')
      btn.className = 'auth-btn'
      btn.textContent = PLAN_COPY.upgrade
      btn.onclick = openUpgrade
      card.appendChild(btn)
    }
    grid.appendChild(card)
  }
  container.append(heading, grid)
}

function openPlans() {
  showModal((body) => renderPlans(body), 'wide')
}

function renderAuth() {
  renderPlans($('#plans'))
  $('#plans-link').classList.toggle('hidden', !authEnabled())
  for (const area of [$('#auth-head'), $('#auth-corner')]) {
    area.replaceChildren()
    if (!authEnabled()) continue
    if (!state.user) {
      const login = document.createElement('button')
      login.className = 'auth-btn'
      login.textContent = '登入'
      login.onclick = () => sdk()?.login()
      area.appendChild(login)
      continue
    }
    if (state.tier === 'pro') {
      const badge = document.createElement('button')
      badge.className = 'pro-badge'
      badge.textContent = 'PRO'
      badge.title = '管理訂閱'
      badge.onclick = openManage
      area.appendChild(badge)
    } else if (proPlan()) {
      const upgrade = document.createElement('button')
      upgrade.className = 'auth-btn'
      upgrade.textContent = '升級 Pro'
      upgrade.onclick = openUpgrade
      area.appendChild(upgrade)
    }
    const name = document.createElement('span')
    name.className = 'auth-user'
    name.textContent = state.user.name || state.user.email || ''
    const logout = document.createElement('button')
    logout.className = 'auth-btn quiet'
    logout.textContent = '登出'
    logout.onclick = () => sdk()?.logout()
    area.append(name, logout)
  }
}

function identityOf(user) {
  return user ? user.id || user.sub || user.email || 'signed-in' : null
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

// 站台設定(有沒有開登入、方案與價格)。卡片要先知道這些才畫得對,所以搜尋會等它
async function loadConfig() {
  try {
    const res = await fetch('/api/config')
    const body = await res.json()
    if (body.success) state.config = { ...state.config, ...body.data }
  } catch {
    /* 拿不到設定就當沒開登入,搜尋照常 */
  }
}
const configReady = loadConfig()

async function initAuth() {
  await configReady
  // 方案區塊不用等登入元件,設定到了就先畫
  renderPlans($('#plans'))
  $('#plans-link').classList.toggle('hidden', !authEnabled())
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
  await refreshMe()
  renderAuth()
  // 頁面一開就搜尋時登入狀態還沒好,先以訪客身分出結果;身分確定後補搜一次
  if (state.user && state.query) rerunSearch()
  s.onAuthChange(async (user) => {
    // SDK 初始化時也會回報一次「目前是誰」。身分沒變就不要重搜:
    // 重搜會重畫卡片,使用者剛按下播放的影片會被換掉。
    const changed = identityOf(user) !== identityOf(state.user)
    state.user = user
    await refreshMe()
    renderAuth()
    if (changed) rerunSearch()
  })
  await handleCheckoutReturn()
}

// ---- 升級 / 訂閱管理 ----

function formatDate(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-TW')
}

function closeModal() {
  $('#modal').classList.add('hidden')
  $('#modal-body').replaceChildren()
}

function showModal(build, size = '') {
  const body = $('#modal-body')
  body.replaceChildren()
  $('#modal').classList.toggle('wide', size === 'wide')
  build(body)
  $('#modal').classList.remove('hidden')
}

function modalText(parent, className, text) {
  const el = document.createElement('p')
  el.className = className
  el.textContent = text
  parent.appendChild(el)
  return el
}

function modalButton(parent, className, text, onClick) {
  const btn = document.createElement('button')
  btn.className = className
  btn.textContent = text
  btn.onclick = () => onClick(btn)
  parent.appendChild(btn)
  return btn
}

function openUpgrade() {
  if (!state.user) {
    closeModal()
    return sdk()?.login()
  }
  const plan = proPlan()
  if (!plan) return toast('Pro 即將開放')
  showModal((body) => {
    modalText(body, 'modal-title', '升級 Pro')
    const price = modalText(body, 'modal-price', '')
    price.innerHTML = `NT$<b>${Number(plan.price).toLocaleString()}</b> / ${plan.cycle === 'yearly' ? '年' : '月'}`
    const list = document.createElement('ul')
    list.className = 'modal-list'
    for (const line of ['全部搜尋結果', '片段下載 mp4', '隨時可退訂,已付的期間照常使用']) {
      const li = document.createElement('li')
      li.textContent = line
      list.appendChild(li)
    }
    body.appendChild(list)
    const note = modalText(body, 'modal-note', '')
    modalButton(body, 'auth-btn modal-cta', '升級 Pro', async (btn) => {
      btn.disabled = true
      note.textContent = '前往付款頁…'
      const res = await api('/api/billing/checkout', { method: 'POST' }).catch(() => null)
      if (res && res.ok && res.data.checkoutUrl) {
        location.href = res.data.checkoutUrl
        return
      }
      btn.disabled = false
      if (res && res.status === 409) {
        note.textContent = '你已經是 Pro 了'
        await refreshMe({ fresh: true })
        renderAuth()
      } else {
        note.textContent = '付款服務暫時連不上,稍後再試'
      }
    })
  })
}

function openManage() {
  showModal((body) => {
    modalText(body, 'modal-title', '你是 Pro 會員')
    const until = formatDate(state.activeUntil)
    const info = modalText(body, 'modal-note', until ? `目前有效至 ${until}` : '')
    modalButton(body, 'auth-btn quiet', '取消訂閱', (btn) => {
      // 第二次按才真的送出
      if (!btn.dataset.armed) {
        btn.dataset.armed = '1'
        btn.textContent = '確定取消訂閱'
        info.textContent = until
          ? `取消後不再扣款,Pro 可以用到 ${until}`
          : '取消後不再扣款,已付的期間照常使用'
        return
      }
      cancelSubscription(btn, info)
    })
  })
}

async function cancelSubscription(btn, info) {
  btn.disabled = true
  const res = await api('/api/billing/cancel', { method: 'POST' }).catch(() => null)
  if (res && res.ok) {
    const until = formatDate(res.data.activeUntil)
    info.textContent = until ? `已取消訂閱,Pro 可以用到 ${until}` : '已取消訂閱'
    btn.remove()
    return
  }
  btn.disabled = false
  info.textContent =
    res && res.status === 404 ? '找不到進行中的訂閱,可能已經取消過了' : '取消失敗,稍後再試'
}

// 從付款頁回來:帳本入帳可能慢幾秒,等一下再問
async function handleCheckoutReturn() {
  if (!RETURNED_FROM_CHECKOUT) return
  const params = new URLSearchParams(location.search)
  if (params.has('upgraded')) {
    params.delete('upgraded')
    const rest = params.toString()
    history.replaceState(null, '', rest ? `?${rest}` : '/')
  }
  if (!state.user) return
  toast('付款確認中…')
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await refreshMe({ fresh: true })
    if (state.tier === 'pro') {
      renderAuth()
      toast('已升級 Pro,謝謝支持')
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 2500))
  }
  toast('還沒收到付款結果,稍後重新整理看看')
}

async function downloadClip(clip, btn) {
  if (!state.user) return sdk()?.login()
  if (!canDownload()) return openUpgrade()
  btn.disabled = true
  try {
    const res = await api(`/api/clips/${encodeURIComponent(clip.id)}/download`, { method: 'POST' })
    if (res.status === 402) {
      await refreshMe({ fresh: true })
      renderAuth()
      return openUpgrade()
    }
    if (!res.ok) return toast('下載失敗,稍後再試')
    const link = document.createElement('a')
    link.href = `${res.data.url}?name=${encodeURIComponent((clip.text || '').slice(0, 60))}`
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
  } catch {
    toast('下載失敗,稍後再試')
  } finally {
    btn.disabled = false
  }
}

// ---- 搜尋 ----

async function fetchPage() {
  await configReady
  const loose = $('#loose-toggle').checked
  const url = `/api/search?q=${encodeURIComponent(state.query)}&from=${state.from}&size=${PAGE_SIZE}&slop=${loose ? 3 : 0}`
  const token = getToken()
  // 結果跟登入身分有關,不能用瀏覽器快取(不然登入後還是看到訪客那三筆)
  const res = await fetch(url, {
    cache: 'no-store',
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })
  const body = await res.json()
  if (!body.success) throw new Error(body.error || `HTTP ${res.status}`)
  return body.data
}

function lockPanel(total, shown) {
  const panel = document.createElement('div')
  panel.className = 'lock-panel'
  const count = Math.max(total - shown, 0)
  const title = document.createElement('p')
  title.className = 'lock-title'
  title.innerHTML = `還有 <b>${count.toLocaleString()}</b> 個片段沒看到`
  const sub = document.createElement('p')
  sub.className = 'lock-sub'
  panel.append(title, sub)

  if (!state.user) {
    // 免費會員拿到多少以後端的等級表為準,不要寫死「全部」
    const free = tierInfo('free')
    const freeLimit = free ? free.features.results : null
    sub.textContent =
      freeLimit === null || freeLimit === undefined
        ? `訪客顯示前 ${shown} 筆,登入看全部`
        : `訪客顯示前 ${shown} 筆,登入看前 ${freeLimit} 筆,Pro 看全部`
    if (authEnabled()) {
      const btn = document.createElement('button')
      btn.className = 'auth-btn'
      btn.textContent = PLAN_COPY.login
      btn.onclick = () => sdk()?.login()
      const plans = document.createElement('button')
      plans.className = 'auth-btn quiet'
      plans.textContent = PLAN_COPY.link
      plans.onclick = openPlans
      panel.append(btn, plans)
    }
  } else {
    sub.textContent = `免費會員顯示前 ${shown} 筆,Pro 看全部`
    if (proPlan()) {
      const btn = document.createElement('button')
      btn.className = 'auth-btn'
      btn.textContent = '升級 Pro'
      btn.onclick = openUpgrade
      panel.appendChild(btn)
    }
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
    const results = data.results || []
    state.total = data.total
    state.from += results.length

    for (const clip of results) {
      grid.appendChild(clipCard(clip, state.query))
    }

    status.className = 'status'
    status.innerHTML = `「<b>${escapeHtml(state.query)}</b>」在影集電影裡出現 <b>${state.total.toLocaleString()}</b> 次`

    const related = [...(data.related || []), ...(data.didYouMean || [])].slice(0, 8)
    if (!append && related.length > 0) {
      renderChips($('#related-chips'), related, (p) => search(p))
      $('#related-chips').classList.remove('hidden')
    }
    if (!append && results.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <img src="empty-cat.png" alt="">
          <p>沒搜到這句,試試「寬鬆搜尋」,或換個講法</p>
        </div>
      `
    }

    if (data.limited) {
      grid.appendChild(lockPanel(data.total, results.length))
      moreBtn.classList.add('hidden')
    } else {
      moreBtn.classList.toggle('hidden', state.from >= state.total || results.length === 0)
    }
  } catch (err) {
    status.className = 'status error'
    status.textContent = err.message
  } finally {
    state.loading = false
    moreBtn.disabled = false
  }
}

// 正在搜尋就等它跑完再重搜,不然會被 loading 擋掉
function rerunSearch(attempt = 0) {
  if (!state.query) return
  if (state.loading && attempt < 40) return void setTimeout(() => rerunSearch(attempt + 1), 150)
  search(state.query)
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
$('#modal').onclick = (e) => {
  if (e.target.id === 'modal') closeModal()
}
$('#modal-close').onclick = closeModal
$('#plans-link').onclick = (e) => {
  e.preventDefault()
  openPlans()
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal()
})

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

// 看劇學習區:劇 → 季 → 每一集的標題與劇情介紹。資料來自 /api/shows(由 Wikipedia 匯入)。
const LANG_KEY = 'takeenglish-watch-lang'
const LANGS = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
  { id: 'both', label: '雙語' }
]
// 這一頁的所有文字都在這裡,要改字只改這一處
const TEXT = {
  heading: '看劇學習區',
  shows: '影集',
  season: (n) => `第 ${n} 季`,
  seasonEn: (n) => `Season ${n}`,
  episodes: (n) => `${n} 集`,
  episodesEn: (n) => `${n} episodes`,
  episode: (n) => `第 ${n} 集`,
  more: '展開',
  less: '收合',
  empty: '還沒有任何影集',
  error: '載入失敗,重新整理再試一次',
  notFound: '找不到這一季',
  study: '逐句解析',
  transcript: '整集台詞',
  moreLines: '載入更多台詞',
  login: '登入',
  plans: '看方案',
  sourceLead: '劇情介紹與集數資料來自維基百科',
  licenseLead: '授權'
}

const $ = (sel) => document.querySelector(sel)
const params = new URLSearchParams(location.search)

function readLang() {
  const fromUrl = params.get('lang')
  if (LANGS.some((l) => l.id === fromUrl)) return fromUrl
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (LANGS.some((l) => l.id === saved)) return saved
  } catch {
    /* 讀不到就用預設 */
  }
  return 'zh'
}

const state = { lang: readLang(), season: null, shows: [] }

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

// 依目前語言挑主要文字與次要文字(雙語時兩個都給)
function pick(pair) {
  const zh = (pair && pair.zh) || ''
  const en = (pair && pair.en) || ''
  if (state.lang === 'en') return { main: en || zh, sub: '' }
  if (state.lang === 'zh') return { main: zh || en, sub: '' }
  return { main: en || zh, sub: en && zh ? zh : '' }
}

function episodesLabel(count) {
  return state.lang === 'en' ? TEXT.episodesEn(count) : TEXT.episodes(count)
}

function seasonLabel(number) {
  return state.lang === 'en' ? TEXT.seasonEn(number) : TEXT.season(number)
}

// 封面圖只收我們自己的圖片路徑,其他一律不放進樣式
function artUrl(value) {
  return typeof value === 'string' && /^[/](thumb|og)[/][A-Za-z0-9_-]+[.]jpg$/.test(value) ? value : ''
}

function year(date) {
  return date ? date.slice(0, 4) : ''
}

function years(first, last) {
  const a = year(first)
  const b = year(last)
  return a && b && a !== b ? `${a}–${b}` : a || b
}

function setLang(lang) {
  state.lang = lang
  try {
    localStorage.setItem(LANG_KEY, lang)
  } catch {
    /* 存不了就只在這次生效 */
  }
  renderLangSwitch()
  render()
}

function renderLangSwitch() {
  const box = $('#lang-switch')
  box.replaceChildren()
  for (const lang of LANGS) {
    const btn = el('button', 'lang-btn', lang.label)
    btn.type = 'button'
    btn.classList.toggle('on', lang.id === state.lang)
    btn.onclick = () => setLang(lang.id)
    box.appendChild(btn)
  }
}

// ---- 劇的列表 ----

function showCard(show, season) {
  const card = el('a', 'show-card')
  card.href = `/watch?show=${encodeURIComponent(show.id)}&season=${season.season}`
  const title = pick(show.title)
  card.append(
    el('span', 'show-card-season', seasonLabel(season.season)),
    el('span', 'show-card-title', title.main)
  )
  if (title.sub) card.appendChild(el('span', 'show-card-sub', title.sub))
  card.appendChild(
    el('span', 'show-card-meta', [episodesLabel(season.episodes), years(season.firstAired, season.lastAired)].filter(Boolean).join(' · '))
  )
  const art = artUrl(season.artwork && season.artwork.card)
  if (art) {
    card.classList.add('has-art')
    card.style.setProperty('--art', `url("${art}")`)
  }
  return card
}

function renderShows() {
  const main = $('#watch-main')
  main.replaceChildren()
  main.appendChild(el('h1', 'watch-title', TEXT.heading))
  if (state.shows.length === 0) {
    main.appendChild(el('p', 'watch-status', TEXT.empty))
    return
  }
  main.appendChild(el('h2', 'row-title', TEXT.shows))
  const row = el('div', 'show-row')
  for (const show of state.shows) {
    for (const season of show.seasons) row.appendChild(showCard(show, season))
  }
  main.appendChild(row)
}

// ---- 一季 ----

function summaryBlock(pair) {
  const box = el('div', 'ep-summary')
  const text = pick(pair)
  box.appendChild(el('p', 'ep-summary-main', text.main))
  if (text.sub) box.appendChild(el('p', 'ep-summary-sub', text.sub))
  return box
}

function episodeRow(season, ep) {
  const row = el('article', 'ep-row')
  row.id = `e${ep.number}`
  row.appendChild(el('div', 'ep-number', String(ep.number)))

  const body = el('div', 'ep-body')
  const title = pick(ep.title)
  body.appendChild(el('h3', 'ep-title', title.main))
  const subtitle = [title.sub, state.lang !== 'en' && ep.title.zhNetflix ? `Netflix:${ep.title.zhNetflix}` : '']
    .filter(Boolean)
    .join(' · ')
  if (state.lang === 'zh' && ep.title.en) body.appendChild(el('p', 'ep-title-sub', [ep.title.en, subtitle].filter(Boolean).join(' · ')))
  else if (subtitle) body.appendChild(el('p', 'ep-title-sub', subtitle))
  body.appendChild(
    el('p', 'ep-meta', [`S${season.season}E${String(ep.number).padStart(2, '0')}`, ep.airDate].filter(Boolean).join(' · '))
  )

  const summary = summaryBlock(ep.summary)
  body.appendChild(summary)
  const toggle = el('button', 'ep-toggle', TEXT.more)
  toggle.type = 'button'
  toggle.onclick = () => {
    const open = summary.classList.toggle('open')
    toggle.textContent = open ? TEXT.less : TEXT.more
  }
  body.appendChild(toggle)
  const actions = episodeActions(body, season, ep)
  if (actions) body.appendChild(actions)
  row.appendChild(body)

  // 等版面排好才知道有沒有被截斷;沒截斷就不需要「展開」
  requestAnimationFrame(() => {
    const clipped = [...summary.children].some((p) => p.scrollHeight > p.clientHeight + 1)
    if (!clipped) toggle.remove()
  })
  return row
}

// ---- 逐句解析 / 整集台詞 ----

function studyEnabled() {
  const config = window.teSession.config()
  return Boolean(config && config.study)
}

function studyNote(box, info) {
  const { el } = window.teStudy
  const note = el('p', 'study-note', info.message)
  if (info.action === 'login') {
    const login = el('button', 'auth-btn', TEXT.login)
    login.onclick = () => window.teSession.login()
    note.append(login)
  } else if (info.action === 'upgrade') {
    const plans = el('a', 'auth-btn', TEXT.plans)
    plans.href = '/#plans'
    plans.style.textDecoration = 'none'
    note.append(plans)
  }
  box.replaceChildren(note)
}

// kind: 'study' = 這一集劇情介紹的逐句解析;'transcript' = 整集台詞(有匯入才有)
async function toggleEpisodeStudy(body, season, ep, kind, btn) {
  const { el, renderLine, explain, request, TEXT: STUDY_TEXT } = window.teStudy
  const existing = body.querySelector(`.ep-study[data-kind="${kind}"]`)
  if (existing) {
    existing.remove()
    btn.classList.remove('on')
    return
  }
  const box = el('div', 'ep-study')
  box.dataset.kind = kind
  box.append(el('p', 'study-note', STUDY_TEXT.loading))
  body.append(box)
  btn.classList.add('on')
  btn.disabled = true

  await window.teSession.ready
  const base = `/api/shows/${encodeURIComponent(season.show.id)}/seasons/${season.season}/episodes/${ep.number}`

  async function load(page) {
    const path = kind === 'transcript' ? `${base}/transcript?page=${page}` : `${base}/study`
    const res = await request(path, window.teSession.getToken()).catch(() => null)
    if (!res || !res.ok) {
      if (page === 0) studyNote(box, explain(res ? res.status : 0, res ? res.body : null))
      // 後面幾頁載入失敗:把「載入更多」按鈕恢復,讓人可以再按一次
      const stuck = box.querySelector('.study-more')
      if (stuck) stuck.disabled = false
      return
    }
    if (page === 0) box.replaceChildren()
    box.querySelector('.study-more')?.remove()
    for (const line of kind === 'transcript' ? res.data.lines : res.data.sentences) box.append(renderLine(line))
    if (kind === 'transcript' && res.data.page + 1 < res.data.pages) {
      const more = el('button', 'study-more', TEXT.moreLines)
      more.type = 'button'
      more.onclick = () => {
        more.disabled = true
        load(res.data.page + 1)
      }
      box.append(more)
    }
  }
  await load(0)
  btn.disabled = false
}

function episodeActions(body, season, ep) {
  const { el } = window.teStudy
  const actions = el('div', 'ep-actions')
  const add = (kind, label) => {
    const btn = el('button', 'study-btn', label)
    btn.type = 'button'
    btn.onclick = () => toggleEpisodeStudy(body, season, ep, kind, btn)
    actions.append(btn)
  }
  if (studyEnabled()) add('study', TEXT.study)
  if (studyEnabled() && ep.hasTranscript) add('transcript', TEXT.transcript)
  if (actions.children.length === 0) return null
  // 不貼 PRO 標籤:按下去才知道要升級(撞牆才推銷,見 paywall-kit 方案頁鐵則)
  return actions
}

function renderSeason() {
  const data = state.season
  const main = $('#watch-main')
  main.replaceChildren()

  const hero = el('section', 'season-hero')
  const title = pick(data.show.title)
  hero.appendChild(el('p', 'season-kicker', seasonLabel(data.season)))
  const backdrop = artUrl(data.artwork && data.artwork.hero)
  if (backdrop) {
    hero.classList.add('has-art')
    hero.style.setProperty('--art', `url("${backdrop}")`)
  }
  hero.appendChild(el('h1', 'season-title', title.main))
  if (title.sub) hero.appendChild(el('p', 'season-title-sub', title.sub))
  else if (state.lang === 'zh' && data.show.title.en) hero.appendChild(el('p', 'season-title-sub', data.show.title.en))
  const first = data.episodes[0]
  const last = data.episodes[data.episodes.length - 1]
  hero.appendChild(
    el('p', 'season-meta', [episodesLabel(data.episodes.length), years(first && first.airDate, last && last.airDate)].filter(Boolean).join(' · '))
  )
  const intro = pick(data.intro)
  hero.appendChild(el('p', 'season-intro', intro.main))
  if (intro.sub) hero.appendChild(el('p', 'season-intro sub', intro.sub))
  main.appendChild(hero)

  const list = el('section', 'ep-list')
  for (const ep of data.episodes) list.appendChild(episodeRow(data, ep))
  main.appendChild(list)

  const source = el('p', 'watch-source')
  source.append(`${TEXT.sourceLead}(`)
  const links = [
    ['English', data.source.en && data.source.en.url],
    ['中文', data.source.zh && data.source.zh.url]
  ].filter(([, url]) => typeof url === 'string' && url.startsWith('https://'))
  links.forEach(([label, url], index) => {
    const a = el('a', '', label)
    a.href = url
    a.rel = 'noopener'
    a.target = '_blank'
    source.append(a, index < links.length - 1 ? '、' : '')
  })
  source.append(`),${TEXT.licenseLead}:`)
  const license = el('a', '', 'CC BY-SA 4.0')
  if (typeof data.source.licenseUrl === 'string' && data.source.licenseUrl.startsWith('https://')) {
    license.href = data.source.licenseUrl
  }
  license.rel = 'noopener license'
  license.target = '_blank'
  source.append(license)
  main.appendChild(source)

  document.title = `${title.main} ${seasonLabel(data.season)}｜${TEXT.heading}｜takeENGLISH`
}

function render() {
  if (state.season) renderSeason()
  else renderShows()
}

async function getJson(url) {
  const res = await fetch(url)
  const body = await res.json().catch(() => ({}))
  return { status: res.status, ok: res.ok && body.success === true, data: body.data }
}

async function init() {
  renderLangSwitch()
  // 要先知道站台設定(有沒有開逐句解析、前幾集免費),每一集的按鈕才畫得對
  await window.teSession.configReady
  const showId = params.get('show')
  const seasonNumber = Number.parseInt(params.get('season') || '', 10)
  try {
    if (showId && Number.isInteger(seasonNumber)) {
      const res = await getJson(`/api/shows/${encodeURIComponent(showId)}/seasons/${seasonNumber}`)
      if (!res.ok) {
        $('#watch-status').textContent = res.status === 404 ? TEXT.notFound : TEXT.error
        return
      }
      state.season = res.data
    } else {
      const res = await getJson('/api/shows')
      if (!res.ok) {
        $('#watch-status').textContent = TEXT.error
        return
      }
      state.shows = res.data.shows
    }
    render()
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView()
  } catch {
    $('#watch-status').textContent = TEXT.error
  }
}

init()

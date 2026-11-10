// 聽歌練英打:YouTube MV 一句一句跟著打,打完那句影片才繼續。會員專屬(訪客只看得到歌單)。
// 資料來自 /api/songs,鎖住的句子後端根本不會送過來。
const TEXT = {
  heading: '聽歌練英打',
  sub: '挑一首歌,跟著 MV 一句一句打。打完才繼續播 — 練手速,也把歌詞聽進去。',
  badge: '會員專屬',
  empty: '歌庫還在準備中',
  error: '載入失敗,重新整理再試一次',
  notFound: '找不到這首歌',
  back: '← 所有歌曲',
  lines: (n) => `${n} 句`,
  progress: (n, total) => `${n} / ${total}`,
  // 播放器
  playerBlocked: '這支 MV 不能嵌入播放,換一首試試',
  playerFailed: '播放器載入不起來,檢查網路或擋廣告的外掛',
  // 控制列
  play: '播放',
  pause: '暫停',
  again: '重聽這句',
  prev: '上一句',
  next: '下一句',
  speed: (rate) => `${rate}x`,
  blankCount: (n) => (n === 'auto' ? '自動挖空' : n === 0 ? '全挖空' : `挖 ${n} 字`),
  zh: '中文',
  lyrics: '看歌詞',
  autoPause: '句末暫停',
  cover: '遮住畫面',
  coverNote: '畫面遮住了 — 只用耳朵聽',
  coverHint: '很多 MV 直接把歌詞印在畫面上,想純聽寫就遮起來',
  restart: '從頭開始',
  // 打字區
  hint: '整句都要打,點點的字要用聽的 · Enter 看答案 · ↓ 下一句 · ↑ 上一句 · Shift+Enter 重聽',
  waiting: '打完這一句,影片就繼續播(聽不出來按 Enter)',
  revealed: '這就是答案 — 照著打一次(這句不計分),或按 ↓ 跳下一句',
  correct: '對了!',
  startHint: '按播放開始。整句都要打,點點的那幾個字要用聽的',
  // 成績
  wpm: 'WPM',
  accuracy: '正確率',
  cleared: '完成',
  resultTitle: '這首練完了',
  resultTime: (s) => `${Math.floor(s / 60)} 分 ${String(Math.round(s % 60)).padStart(2, '0')} 秒`,
  resultPeeked: (n) => `${n} 句看了答案`,
  misses: '最常打錯',
  retry: '再練一次',
  otherSongs: '換一首',
  // credit
  creditUnlock: (left) => `用 1 點解鎖整首(今天還有 ${left} 點)`,
  creditNone: '今天的點數用完了 — 明天再來,或升級 Pro 整首不限',
  creditWorking: '解鎖中…',
  creditFailed: '解鎖失敗,再試一次',
  creditLeft: (left) => `今天還有 ${left} 點`,
  // 成績與排行榜
  boardTitle: '排行榜',
  boardEmpty: '還沒有人留下成績 — 你可以是第一個',
  scoreUploading: '上傳成績…',
  scorePoints: (n) => `這一輪 ${n} 分`,
  scoreRank: (n) => `這首第 ${n} 名`,
  scoreSkipped: '這一輪沒記成績',
  scoreNeedLines: (n) => `打完 ${n} 句以上才會記成績`,
  scoreGuest: '登入後才會記成績、上排行榜',
  scoreOffline: '成績沒存上(網路斷了?)',
  historyTitle: '我的成績',
  historyEmpty: '還沒有成績 — 練完一首就會出現在這裡',
  historyBest: (n) => `最佳 ${n} 分`,
  // 會員牆
  gateTitle: '聽歌練英打是會員專屬',
  gateBody: '免費登入就可以開始練,每首歌先練 15 句;升級 Pro 整首歌不限。',
  gateLogin: '免費登入開始練',
  lockedLines: (n) => `後面還有 ${n} 句`,
  unlock: '解鎖整首',
  wallTitle: '練完整首歌',
  wallPoints: ['每首歌從頭打到尾', '影片學習完整逐字稿', '單句重複、慢速、聽寫不受限', '片語搜尋看全部結果'],
  wallGuestHint: '先免費登入,可以先練 15 句',
  // 自己貼 YouTube 連結
  mine: '我的歌',
  mineHint: '貼上 YouTube 連結,自動抓字幕變成練習;自己加的歌整首都能練。',
  minePlaceholder: 'https://www.youtube.com/watch?v=…',
  mineAdd: '加入',
  mineAdding: '抓字幕中…(可能要十幾秒)',
  mineEmpty: '還沒有自己加的歌',
  mineLogin: '登入後可以貼自己的 YouTube 連結',
  mineQuota: (used, limit) => (limit === null ? '不限' : `今天還可以加 ${Math.max(limit - used, 0)} 支`),
  mineRemove: '移除',
  mineRemoveConfirm: (title) => `把「${title}」從我的歌移除?`,
  mineErrors: {
    bad_url: '這不是 YouTube 影片連結',
    not_embeddable: '這支影片不給嵌入播放,練不了 — 換一支',
    no_subtitles: '這支影片沒有英文字幕(很多官方 MV 都沒有)— 找同一首歌的 lyrics 影片通常有',
    thin_subtitles: '這首的英文字幕太零散,練不了 — YouTube 只從非英文歌裡聽出幾個字。換英文歌試試',
    subs_fetch_failed: '這支有字幕,但這次沒抓到 — 等一下再按一次就好,不用換影片',
    rate_limited: 'YouTube 暫時擋下請求,過幾分鐘再試',
    daily_limit: '今天加的額度用完了',
    library_full: '我的歌放滿了,先移除幾首',
    upgrade_required: '這是會員功能',
    unauthorized: '請先登入',
    import_unavailable: '這台伺服器沒有開放自己加歌',
    default: '加入失敗,稍後再試'
  },
  minutes: (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
}
// YouTube 只認得這幾個速度,給它 0.9 會被吸到最近的一個 — 按鈕寫 0.9x 但其實是 1x
const SPEEDS = [1, 0.75, 0.5]
const TICK_MS = 100
// 句末多給一點時間再暫停:字幕的結束時間常常切在尾音上
const END_GRACE = 0.25
// 跟上一次差這麼多就是使用者自己拖了進度條,要重新對句子
const SEEK_JUMP = 1.5
// 打滿這麼多句才會記成績(跟 src/scores.js 的 MIN_CLEARED 一致)
const MIN_SCORE_LINES = 3
// 整句打對之後亮綠多久才換下一句
const CORRECT_MS = 420
// 一句挖幾個字:自動(看句子長度)→ 固定 1 → 固定 2 → 0(整句照打)
const BLANK_COUNTS = ['auto', 1, 2, 0]

const $ = (sel) => document.querySelector(sel)
const params = new URLSearchParams(location.search)
const { el } = window.teStudy
const { same, lineDone, wordAt, lineIndexAt, needsSeek, createScore, pickBlanks, autoBlankCount, wholeLine } = window.teTyping

// 頁面訊息。第一次 render 之後 #type-status 就被換掉了,不能假設它還在
function status(message) {
  const node = $('#type-status')
  if (node) node.textContent = message
  else $('#type-main').replaceChildren(el('p', 'watch-status', message))
}

async function getJson(url) {
  await window.teSession.ready
  const token = window.teSession.getToken()
  const res = await fetch(url, { cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {} })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, ok: res.ok && body.success === true, data: body.data }
}

async function postJson(url, body) {
  await window.teSession.ready
  const token = window.teSession.getToken()
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  })
  const parsed = await res.json().catch(() => ({}))
  return { status: res.status, ok: res.ok && parsed.success === true, data: parsed.data }
}

// 排行榜的一列一列。名字是伺服器去識別化過的(暱稱或遮起來的信箱),這裡照用
function boardTable(items, myRank = null) {
  const table = el('div', 'type-board-list')
  items.forEach((row, index) => {
    const line = el('div', 'type-board-row')
    if (myRank && index + 1 === myRank) line.classList.add('me')
    line.append(
      el('span', 'type-board-rank', String(index + 1)),
      el('span', 'type-board-name', row.name),
      el('b', 'type-board-points', String(row.points)),
      el('span', 'type-board-meta', `${row.wpm} WPM · ${row.accuracy}% · ${row.cleared}/${row.total}`)
    )
    table.append(line)
  })
  return table
}

// 今天還剩幾點;null = 不限(付費會員)
function creditsLeft(song) {
  const credits = song.credits || null
  if (!credits || credits.limit === null) return null
  return Math.max(credits.limit - credits.used, 0)
}

// 花 1 點把這一首整首打開。成功就重新整理 —— 伺服器那邊記著「今天解鎖過這首」,
// 重新載入就會把整首送下來,不用在播放中途重建整個練習狀態
async function spendCredit(button, note) {
  const id = params.get('id') || ''
  button.disabled = true
  note.textContent = TEXT.creditWorking
  const res = await postJson(`/api/songs/${encodeURIComponent(id)}/unlock`, {}).catch(() => null)
  if (res && res.ok) return location.reload()
  button.disabled = false
  note.textContent = res && res.status === 402 ? TEXT.creditNone : TEXT.creditFailed
}

function showWall(song) {
  const left = creditsLeft(song)
  window.teWall.show({
    // 公開歌庫的歌、還有點數、今天還沒解鎖過這首 → 給他一條不用付錢的路
    extra:
      song.signedIn && !song.own && !song.unlocked && left !== null && left > 0
        ? { label: TEXT.creditUnlock(left), onClick: spendCredit }
        : null,
    signedIn: song.signedIn,
    title: TEXT.wallTitle,
    points: TEXT.wallPoints,
    count: song.lockedLines ? TEXT.lockedLines(song.lockedLines) : '',
    guestHint: TEXT.wallGuestHint
  })
}

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
  if (!res.ok || !res.data) return { node: null, bests: {} }
  const box = el('section', 'type-history')
  box.append(el('h2', 'row-title', TEXT.historyTitle))
  const items = Array.isArray(res.data.items) ? res.data.items : []
  if (items.length === 0) {
    box.append(el('p', 'lesson-sub', TEXT.historyEmpty))
    return { node: box, bests: res.data.bests || {} }
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
  return { node: box, bests: res.data.bests || {} }
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
  const mine = await scoresSection()
  const grid = el('div', 'lesson-grid')
  for (const item of res.data.items) grid.append(songCard(item, mine.bests[item.id] || null))
  main.append(grid)
  if (mine.node) main.append(mine.node)
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

// 遮住畫面要跨首歌、跨分頁記住 — 會用的人每首都想遮。localStorage 壞掉(無痕/擋第三方)不能讓整頁掛掉
const COVER_KEY = 'te-type-cover'

function coverPref() {
  try {
    return localStorage.getItem(COVER_KEY) === '1'
  } catch {
    return false
  }
}

function setCoverPref(on) {
  try {
    localStorage.setItem(COVER_KEY, on ? '1' : '0')
  } catch {
    /* 記不住就算了,這一次還是遮著 */
  }
}

// ---- YouTube 播放器 ----

let ytLoading = null

function loadYouTube() {
  if (ytLoading) return ytLoading
  ytLoading = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) return resolve(window.YT)
    const timer = setTimeout(() => reject(new Error('youtube api timeout')), 12000)
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer)
      if (typeof previous === 'function') previous()
      resolve(window.YT)
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.onerror = () => {
      clearTimeout(timer)
      reject(new Error('youtube api blocked'))
    }
    document.head.append(script)
  })
  return ytLoading
}

function createPlayer(mount, videoId, { onState, onError }) {
  return loadYouTube().then(
    (YT) =>
      new YT.Player(mount, {
        videoId,
        // nocookie 網域:沒播之前不會在訪客瀏覽器種追蹤 cookie
        host: 'https://www.youtube-nocookie.com',
        // cc_load_policy: 0 = 不要預設開字幕。YouTube 自己的字幕會把整句答案
        // 直接打在影片上,那這個練習就沒意義了
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, cc_load_policy: 0, iv_load_policy: 3, origin: location.origin },
        events: {
          // 使用者的 YouTube 帳號如果把字幕設成「一律開啟」,playerVars 擋不住 — 載好之後再關一次
          onReady: (event) => {
            try {
              event.target.unloadModule('captions')
              event.target.unloadModule('cc')
            } catch {
              /* 這支影片沒有字幕模組就算了 */
            }
          },
          onStateChange: (event) => {
            // 使用者在播放器裡自己按了字幕,或 YouTube 換畫質時把字幕模組載回來 → 每次開始播就再關一次
            if (event.data === 1) {
              try {
                event.target.unloadModule('captions')
                event.target.unloadModule('cc')
              } catch {
                /* 沒有字幕模組就算了 */
              }
            }
            onState(event.data)
          },
          onError: () => onError(new Error('video not embeddable'))
        }
      })
  )
}

// ---- 畫面元件 ----

// 三個數字:WPM、正確率、完成幾句。每敲一個鍵就更新,所以是改字不是重畫
function createStats(score, total) {
  const node = el('div', 'type-stats')
  const values = []
  for (const label of [TEXT.wpm, TEXT.accuracy, TEXT.cleared]) {
    const stat = el('div', 'type-stat')
    const value = el('b', '', '0')
    stat.append(value, el('span', '', label))
    values.push(value)
    node.append(stat)
  }
  function update(cleared) {
    values[0].textContent = String(score.wpm())
    values[1].textContent = `${score.accuracy()}%`
    values[2].textContent = `${cleared}/${total}`
  }
  update(0)
  return { node, update }
}

// ---- 一首歌的練習畫面 ----

async function renderSong(id, { mine = false } = {}) {
  const path = mine ? `/api/my-songs/${encodeURIComponent(id)}` : `/api/songs/${encodeURIComponent(id)}`
  const res = await getJson(path)
  const main = $('#type-main')
  if (!res.ok) {
    status(res.status === 404 ? TEXT.notFound : TEXT.error)
    return
  }
  const song = res.data
  document.title = `${song.title}｜${TEXT.heading}｜takeENGLISH`

  const back = el('a', 'lesson-back', TEXT.back)
  back.href = '/type'
  const layout = el('div', 'type-layout')
  const stage = el('div', 'type-stage')
  const side = el('div', 'type-side')
  const playerBox = el('div', 'type-player')
  const mount = el('div')
  // ⚠️ 遮罩掛在 playerBox 不是 mount:YT.Player 會把 mount 整個換成 iframe,掛在裡面會連同遮罩一起消失
  const cover = el('div', 'type-cover')
  cover.append(el('p', 'type-cover-note', TEXT.coverNote), el('p', 'type-cover-hint', TEXT.coverHint))
  playerBox.append(mount, cover)
  if (coverPref()) playerBox.classList.add('covered')
  stage.append(playerBox, el('h1', 'type-heading', song.title))
  if (song.artist) stage.append(el('p', 'type-artist', song.artist))
  layout.append(stage, side)
  main.replaceChildren(back, layout)

  // 訪客:看得到 MV 和歌名,練習區換成登入牆
  if (!song.typing || song.lines.length === 0) {
    const gate = el('div', 'type-gate')
    gate.append(el('h2', '', TEXT.gateTitle), el('p', '', TEXT.gateBody))
    const button = el('button', 'auth-btn', song.signedIn ? TEXT.unlock : TEXT.gateLogin)
    button.type = 'button'
    button.onclick = () => (song.signedIn ? showWall(song) : window.teSession.login())
    gate.append(button)
    stage.append(gate)
    await mountPlayer(playerBox, mount, song, {})
    watchSignIn()
    return
  }

  const score = createScore()
  const state = {
    index: 0,
    typed: '',
    // 一句挖幾個字。'auto' = 看句子長度決定,0 = 不挖空整句照打
    blankCount: 'auto',
    blanks: [],
    revealed: false,
    // 整句打對之後亮綠的那一下
    correct: false,
    showZh: true,
    // 右欄歌詞:還沒練到的句子預設糊掉 — 不然答案整排就在旁邊,照抄就好了
    showLyrics: false,
    speed: 0,
    autoPause: true,
    waiting: false,
    lastTime: 0,
    cleared: 0,
    finished: false
  }
  // 每一句的狀態:false 沒練過 / 'cleared' 自己打出來 / 'revealed' 看了答案
  const done = new Array(song.lines.length).fill(false)
  let correctTimer = null

  // 這一句要挖哪幾個字
  function blanksFor(line) {
    if (!line) return []
    const count = state.blankCount === 'auto' ? autoBlankCount(line.text) : state.blankCount
    if (count === 0) return wholeLine(line.text)
    // 伺服器那邊有離線字典,候選已經照難度排好(難的在前面),而且同一句重複出現時
    // 會換一個字挖。拿不到就退回前端自己挑(字典沒載入時)
    const ranked = Array.isArray(line.blanks) ? line.blanks : []
    if (ranked.length === 0) return pickBlanks(line.text, count)
    return ranked
      .slice(0, count)
      .map(([from, to]) => ({ from, to, word: line.text.slice(from, to) }))
      .sort((a, b) => a.from - b.from)
  }

  // 進度
  const progress = el('div', 'type-progress')
  const bar = el('span', 'type-progress-bar')
  const fill = el('span', 'type-progress-fill')
  bar.append(fill)
  const count = el('span', 'type-progress-count', TEXT.progress(0, song.totalLines))
  progress.append(bar, count)

  // 打字區
  const box = el('div', 'type-box')
  const lineView = el('p', 'type-line')
  const zhView = el('p', 'type-zh')
  const hint = el('p', 'type-hint')
  const input = el('input', 'type-input')
  input.type = 'text'
  input.autocomplete = 'off'
  input.autocapitalize = 'off'
  input.spellcheck = false
  input.setAttribute('aria-label', TEXT.heading)
  // 重聽這句:就放在打字區右上角,聽不清楚的當下手不用離開這裡去找工具列。
  // 要排在 input 後面 —— input 鋪滿整個框(inset: 0),先放的話按鈕會被它蓋住
  const replay = el('button', 'type-replay', '↺')
  replay.type = 'button'
  replay.title = TEXT.again
  replay.setAttribute('aria-label', TEXT.again)
  replay.onclick = (event) => {
    event.stopPropagation()
    goTo(state.index, { seek: true, resume: true })
  }
  box.append(lineView, zhView, hint, input, replay)
  box.onclick = () => input.focus({ preventScroll: true })
  input.onfocus = () => box.classList.add('focused')
  input.onblur = () => box.classList.remove('focused')

  const tools = el('div', 'type-tools')
  const stats = createStats(score, song.totalLines)
  const lyrics = el('div', 'type-lyrics')
  const results = el('div', 'type-results')
  // 成績跟著打字區走(右欄的歌詞很長,放右邊會被捲出畫面)
  stage.append(progress, box, tools, stats.node, results)
  side.append(lyrics)

  // 右欄底下的排行榜:進來就看得到別人打到幾分(自己貼的歌沒有公開榜)
  if (!song.own) {
    const panel = el('section', 'type-side-board')
    const body = el('div', 'type-side-board-body')
    panel.append(el('h2', 'row-title', TEXT.boardTitle), body)
    side.append(panel)
    getJson(`/api/type/board?songId=${encodeURIComponent(song.id)}`)
      .then((res) => {
        if (!res.ok || !res.data) return panel.remove()
        const items = Array.isArray(res.data.items) ? res.data.items : []
        body.replaceChildren(items.length ? boardTable(items.slice(0, 10)) : el('p', 'lesson-sub', TEXT.boardEmpty))
      })
      .catch(() => panel.remove())
  }

  // 右欄歌詞:點一句就跳過去練那一句
  const rows = song.lines.map((line, index) => {
    const row = el('button', 'type-lyric', line.text)
    row.type = 'button'
    row.onclick = () => goTo(index, { seek: true })
    lyrics.append(row)
    return row
  })
  if (song.lockedLines > 0) {
    const lock = el('div', 'type-lock')
    lock.append(el('p', 'lock-title', TEXT.lockedLines(song.lockedLines)))
    const more = el('button', 'auth-btn', TEXT.unlock)
    more.type = 'button'
    more.onclick = () => showWall(song)
    lock.append(more)
    // 點數就擺在鎖旁邊 —— 這是最容易被看到的位置,也是「先嚐一次整首」的入口
    const left = creditsLeft(song)
    if (song.signedIn && !song.own && left !== null) {
      if (left > 0) {
        const spend = el('button', 'auth-btn quiet', TEXT.creditUnlock(left))
        spend.type = 'button'
        const note = el('p', 'lock-note', '')
        spend.onclick = () => spendCredit(spend, note)
        lock.append(spend, note)
      } else {
        lock.append(el('p', 'lock-note', TEXT.creditNone))
      }
    }
    lyrics.append(lock)
  }

  // ---- 畫面 ----

  function currentLine() {
    return song.lines[state.index] || null
  }

  // 整句看得到,挖掉的字用點蓋住;只有「現在這一格」會跟著你打的字變。
  // 每個字元找出它屬於哪一格(沒有就是純文字),再決定要顯示什麼。
  function paintLine() {
    const line = currentLine()
    lineView.replaceChildren()
    if (!line) return
    const typed = state.typed
    for (let i = 0; i < line.text.length; i += 1) {
      const expected = line.text[i]
      const hidden = state.blanks.some((blank) => i >= blank.from && i < blank.to)
      let cls = 'ch'
      let shown = expected
      // 已經打到的位置:對就留原字,錯就顯示他實際打的那個(不然看不出哪裡錯)
      if (i < typed.length) {
        const hit = same(typed[i], expected)
        cls += hit ? ' hit' : ' miss'
        if (!hit) shown = typed[i] === ' ' ? '␣' : typed[i]
      } else {
        if (i === typed.length) cls += ' cursor'
        if (!hidden) {
          // 沒挖掉的字照樣看得到 —— 整句還是要一個一個打完,這些只是不用「聽」出來
          cls += ' context'
        } else if (state.revealed) {
          cls += ' revealed'
        } else {
          cls += ' masked'
          shown = '·'
        }
      }
      lineView.append(el('span', cls, shown))
    }
    lineView.classList.toggle('correct', state.correct)
    zhView.textContent = state.showZh && line.zh ? line.zh : ''
    hint.textContent = state.correct ? TEXT.correct : state.revealed ? TEXT.revealed : state.waiting ? TEXT.waiting : TEXT.hint
    hint.classList.toggle('type-waiting', state.waiting || state.revealed)
    hint.classList.toggle('type-correct', state.correct)
  }

  function paintProgress() {
    count.textContent = TEXT.progress(state.cleared, song.totalLines)
    fill.style.width = `${(state.cleared / song.totalLines) * 100}%`
    stats.update(state.cleared)
    // 練過的那幾句看得到(當作進度),還沒練到的糊著
    lyrics.classList.toggle('hide-answers', !state.showLyrics)
    rows.forEach((row, index) => {
      row.classList.toggle('active', index === state.index)
      row.classList.toggle('cleared', done[index] === 'cleared')
      row.classList.toggle('revealed', done[index] === 'revealed')
    })
    // 只捲歌詞那一欄。用 scrollIntoView 會順便把整頁往下拉,播放器就被推出畫面了
    const active = rows[state.index]
    if (active) lyrics.scrollTop = Math.max(0, active.offsetTop - lyrics.clientHeight / 2 + active.offsetHeight / 2)
  }

  function repaint() {
    paintLine()
    paintProgress()
  }

  // ---- 播放器控制 ----

  let player = null
  let playing = false

  const time = () => (player && player.getCurrentTime ? player.getCurrentTime() || 0 : 0)
  const play = () => player && player.playVideo && player.playVideo()
  const pause = () => player && player.pauseVideo && player.pauseVideo()
  const seek = (seconds) => player && player.seekTo && player.seekTo(Math.max(seconds, 0), true)

  function goTo(index, { seek: shouldSeek = false, resume = false } = {}) {
    // 回到任何一句就是「還在練」:不清掉的話練完一次之後整個引擎(句末暫停、付費牆)就死了
    state.finished = false
    results.replaceChildren()
    // 離開這一句就停止計時,換句之間在發呆不算打字時間
    score.stop()
    clearTimeout(correctTimer)
    state.correct = false
    state.index = Math.max(0, Math.min(index, song.lines.length - 1))
    state.typed = ''
    state.waiting = false
    state.revealed = false
    input.value = ''
    const line = currentLine()
    state.blanks = blanksFor(line)
    // 多打的字會憑空消失(畫面只畫得出歌詞那麼長),乾脆讓它打不進去
    input.maxLength = line ? line.text.length : 0
    // 影片要跟著句子走。已經播過這一句了(打太慢、或剛剛跳了句)就倒回句首,
    // 不然你在打第 5 句、影片在唱第 8 句,這個練習就散了。
    // 還沒播到不用動 —— 讓它自然播過去,中間的前奏/間奏照樣聽得到
    if (needsSeek(time(), line, shouldSeek)) {
      seek(line.start)
      state.lastTime = line.start
    }
    if (resume) play()
    repaint()
    input.focus({ preventScroll: true })
  }

  function resultPanel() {
    const panel = el('div', 'type-result')
    panel.append(el('h2', '', TEXT.resultTitle))
    const peeked = done.filter((how) => how === 'revealed').length
    panel.append(el('p', 'type-artist', `${TEXT.resultTime(score.seconds())}${peeked ? ` · ${TEXT.resultPeeked(peeked)}` : ''}`))
    const final = createStats(score, song.totalLines)
    final.update(state.cleared)
    panel.append(final.node)
    const top = score.top()
    if (top.length) {
      panel.append(el('h3', 'lesson-summary-h', TEXT.misses))
      const list = el('div', 'type-misses')
      for (const [word, times] of top) {
        const chip = el('span', 'type-miss', word)
        chip.append(el('b', '', `×${times}`))
        list.append(chip)
      }
      panel.append(list)
    }
    const boardBox = el('div', 'type-board')
    panel.append(boardBox)
    // 不 await:成績面板要馬上出現,排行榜慢一點到沒關係
    reportScore(boardBox, peeked)
    const actions = el('div', 'type-result-actions')
    const retry = el('button', 'auth-btn', TEXT.retry)
    retry.type = 'button'
    retry.onclick = () => location.reload()
    const other = el('a', 'auth-btn quiet', TEXT.otherSongs)
    other.href = '/type'
    actions.append(retry, other)
    panel.append(actions)
    return panel
  }

  // 把這一輪送上去,換回「第幾名 + 排行榜」。整段包在 try 裡 ——
  // 成績存不上是小事,絕對不能讓成績面板本身壞掉
  async function reportScore(boardBox, peeked) {
    if (!song.signedIn) return boardBox.replaceChildren(el('p', 'type-board-note', TEXT.scoreGuest))
    if (state.cleared < MIN_SCORE_LINES) {
      return boardBox.replaceChildren(el('p', 'type-board-note', TEXT.scoreNeedLines(MIN_SCORE_LINES)))
    }
    boardBox.replaceChildren(el('p', 'type-board-note', TEXT.scoreUploading))
    let res
    try {
      res = await postJson('/api/type/scores', {
        songId: song.id,
        own: song.own === true,
        wpm: score.wpm(),
        accuracy: score.accuracy(),
        cleared: state.cleared,
        total: song.totalLines,
        peeked,
        seconds: Math.round(score.seconds())
      })
    } catch {
      res = null
    }
    if (!res || !res.ok || !res.data) return boardBox.replaceChildren(el('p', 'type-board-note', TEXT.scoreOffline))
    const parts = []
    if (res.data.recorded && res.data.run) {
      const rank = res.data.rank ? ` · ${TEXT.scoreRank(res.data.rank)}` : ''
      parts.push(el('p', 'type-board-mine', `${TEXT.scorePoints(res.data.run.points)}${rank}`))
    } else {
      parts.push(el('p', 'type-board-note', TEXT.scoreSkipped))
    }
    const board = Array.isArray(res.data.board) ? res.data.board : []
    if (board.length) {
      parts.push(el('h3', 'lesson-summary-h', TEXT.boardTitle), boardTable(board, res.data.rank))
    }
    boardBox.replaceChildren(...parts)
  }

  function finish() {
    if (state.finished) return
    state.finished = true
    score.stop()
    pause()
    // 成績先給他看 — 免費會員練完開放的句數也值得看到自己打多快,升級視窗再疊上去
    results.replaceChildren(resultPanel())
    results.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    if (song.lockedLines > 0) showWall(song)
  }

  function lineComplete(how = 'cleared') {
    const line = currentLine()
    if (!line) return
    if (!done[state.index]) {
      done[state.index] = how
      if (how === 'cleared') state.cleared += 1
    }
    score.stop()
    if (how !== 'cleared') return advanceAfterLine()
    // 掀過答案的句子:照著打完照樣亮綠(那是練習本身),但不進 WPM
    if (!state.revealed) score.lineCleared(line.text)
    // 打對了:整句亮綠一下再往下。沒有這一下的話,畫面只是突然換成下一句,
    // 人不會知道自己剛剛過了 —— 那個「對了!」才是會想再打一句的原因
    state.correct = true
    repaint()
    clearTimeout(correctTimer)
    correctTimer = setTimeout(advanceAfterLine, CORRECT_MS)
  }

  function advanceAfterLine() {
    clearTimeout(correctTimer)
    const resume = state.waiting
    state.correct = false
    if (state.index + 1 >= song.lines.length) {
      repaint()
      finish()
      return
    }
    goTo(state.index + 1, { resume })
  }

  // ---- 鍵盤 ----

  // 打的是「整句」—— 挖空只是把其中一兩個字蓋起來讓你用聽的,
  // 不是只打那幾個字。每個字都還是要自己打出來。
  input.oninput = () => {
    const line = currentLine()
    if (!line || state.correct) {
      input.value = ''
      return
    }
    const next = input.value
    // 掀開答案之後還是可以照著打一次 —— 這是「看到正確答案就想自己打一遍」的那個需求。
    // 但不記分也不抖:答案就在眼前,算進 WPM/正確率就是假的
    if (state.revealed) {
      state.typed = next
      paintLine()
      if (lineDone(next, line.text)) lineComplete('cleared')
      return
    }
    // 只在「多打了一個字」的時候記分:退格不罰,貼上不算成績
    if (next.length === state.typed.length + 1) {
      const at = next.length - 1
      const expected = line.text[at]
      const correct = expected !== undefined && same(next[at], expected)
      score.key(correct, correct ? '' : wordAt(line.text, at))
      if (!correct) {
        box.classList.remove('wrong')
        void box.offsetWidth
        box.classList.add('wrong')
      }
    }
    state.typed = next
    paintLine()
    stats.update(state.cleared)
    if (lineDone(next, line.text)) lineComplete('cleared')
  }

  // Enter = 只是「給我看答案」,不會換句。
  // 原本掀開後 1.6 秒自動下一句 —— 看到答案想照著打一次的人會被推走,
  // 而手快按兩次 Enter 的人等於整句跳過沒練到。要往下請按 ↓ / Tab。
  function reveal() {
    if (state.revealed) return
    state.revealed = true
    state.typed = ''
    input.value = ''
    if (!done[state.index]) done[state.index] = 'revealed'
    paintLine()
    paintProgress()
  }

  const prevLine = () => goTo(state.index - 1, { seek: true })
  const nextLine = () => {
    if (state.index + 1 < song.lines.length) goTo(state.index + 1, { seek: true, resume: state.waiting })
    else finish()
  }
  const replayLine = () => goTo(state.index, { seek: true, resume: true })

  input.onkeydown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      // Shift+Enter 重聽這句:手不用離開打字的位置,比 Esc 好按
      if (event.shiftKey) replayLine()
      else if (state.correct) advanceAfterLine()
      else reveal()
      return
    }
    // ↑ ↓ 換句。左右鍵留給游標 —— 打錯一個字母要往回移,那個不能被搶走
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      nextLine()
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      prevLine()
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      if (event.shiftKey) prevLine()
      else nextLine()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      replayLine()
    }
  }

  // ---- 控制列 ----

  // toggle: 這個鈕是開關(會亮起來),要讓讀螢幕的人也知道現在開著還是關著
  function tool(label, onClick, { on = null, title = '' } = {}) {
    const button = el('button', 'study-btn', label)
    button.type = 'button'
    // 快捷鍵寫在 title:控制列已經夠擠了,但滑過去要查得到
    if (title) button.title = title
    if (on !== null) {
      button.classList.toggle('on', on)
      button.setAttribute('aria-pressed', String(on))
    }
    button.onclick = () => {
      onClick(button)
      if (on !== null) button.setAttribute('aria-pressed', String(button.classList.contains('on')))
    }
    tools.append(button)
    return button
  }

  const playButton = tool(TEXT.play, () => (playing ? pause() : play()))
  tool(TEXT.again, () => replayLine(), { title: 'Shift+Enter(或 Esc)' })
  tool(TEXT.prev, () => prevLine(), { title: '↑(或 Shift+Tab)' })
  tool(TEXT.next, () => nextLine(), { title: '↓(或 Tab)' })
  tools.append(el('span', 'sep'))
  tool(TEXT.speed(SPEEDS[0]), (button) => {
    state.speed = (state.speed + 1) % SPEEDS.length
    const rate = SPEEDS[state.speed]
    if (player && player.setPlaybackRate) player.setPlaybackRate(rate)
    button.textContent = TEXT.speed(rate)
    button.classList.toggle('on', state.speed !== 0)
  })
  // 挖幾個字:1 → 2 → 整句照打 → 1 …(換模式後這一句重新挖,不保留已經打的)
  tool(TEXT.blankCount(state.blankCount), (button) => {
    state.blankCount = BLANK_COUNTS[(BLANK_COUNTS.indexOf(state.blankCount) + 1) % BLANK_COUNTS.length]
    button.textContent = TEXT.blankCount(state.blankCount)
    button.classList.toggle('on', state.blankCount !== 'auto')
    goTo(state.index)
  })
  // 這首歌沒有中文翻譯就不要擺一個按了沒反應的鈕
  if (song.lines.some((line) => line.zh)) {
    tool(
      TEXT.zh,
      (button) => {
        state.showZh = !state.showZh
        button.classList.toggle('on', state.showZh)
        paintLine()
      },
      { on: true }
    )
  }
  tool(
    TEXT.lyrics,
    (button) => {
      state.showLyrics = !state.showLyrics
      button.classList.toggle('on', state.showLyrics)
      paintProgress()
    },
    { on: false }
  )
  tool(
    TEXT.autoPause,
    (button) => {
      state.autoPause = !state.autoPause
      button.classList.toggle('on', state.autoPause)
    },
    { on: true }
  )
  // 遮住畫面:關不掉的是「印在影片裡」的歌詞 — YouTube 字幕我們已經強制關掉,但歌詞 MV 的字是畫面本身
  tool(
    TEXT.cover,
    (button) => {
      const on = !playerBox.classList.contains('covered')
      playerBox.classList.toggle('covered', on)
      button.classList.toggle('on', on)
      setCoverPref(on)
      // 遮罩吃掉點擊,焦點會掉到按鈕上 — 拉回打字區
      input.focus({ preventScroll: true })
    },
    { on: coverPref() }
  )
  tool(TEXT.restart, () => {
    // 成績也要歸零,不然第二輪的 WPM 會疊在第一輪上面
    score.reset()
    state.cleared = 0
    done.fill(false)
    goTo(0, { seek: true, resume: true })
  })

  // ---- 每 100ms 對一次時間 ----

  function tick() {
    if (!player || state.finished) return
    const now = time()
    const jumped = Math.abs(now - state.lastTime) > SEEK_JUMP
    state.lastTime = now

    // 使用者自己拖進度條:重新對到那個位置的句子
    if (jumped) {
      const index = lineIndexAt(now, song.lines)
      if (index !== state.index) {
        state.index = index
        state.typed = ''
        input.value = ''
        input.maxLength = song.lines[index].text.length
        state.blanks = blanksFor(song.lines[index])
        state.waiting = false
        repaint()
      }
      return
    }

    const line = currentLine()
    // ⚠️ 句末暫停要排在付費牆前面。歌詞常常一句的結束就是下一句的開始,
    // 最後一句開放的句子唱完的那一刻也正是牆的時間點 — 先暫停住,時間就不會再往前走,
    // 他才能把那句打完(打完 lineComplete → finish 會好好地給成績再推升級),
    // 而不是打到一半被升級視窗蓋住。
    if (line && state.autoPause && !state.waiting && playing && now >= line.end + END_GRACE) {
      state.waiting = true
      pause()
      paintLine()
      input.focus({ preventScroll: true })
      return
    }

    // 沒開句末暫停、或他就讓影片一直播:播到鎖住的地方就退回去一點點,跳升級視窗
    if (song.lockedFrom !== null && now >= song.lockedFrom + END_GRACE) {
      pause()
      seek(Math.max(song.lockedFrom - 0.3, 0))
      showWall(song)
    }
  }

  // pagehide 也會在頁面被放進上一頁/下一頁快取時觸發,而回來時不會重跑這支程式。
  // 無條件 clearInterval 的話,按返回再回來,句末暫停就永遠不會再動了
  let timer = setInterval(tick, TICK_MS)
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) clearInterval(timer)
  })
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return
    clearInterval(timer)
    timer = setInterval(tick, TICK_MS)
  })

  // 走 goTo 而不是直接 repaint:第一句的挖空要先算出來,不然整句都只是文字
  goTo(0)
  hint.textContent = TEXT.startHint

  player = await mountPlayer(playerBox, mount, song, {
    onState: (code) => {
      playing = code === 1
      playButton.textContent = playing ? TEXT.pause : TEXT.play
      if (playing) {
        state.waiting = false
        // 計時由第一個按鍵開始(score.key),不是播放開始 — 前奏和等你打字的時間都不該算進 WPM
        input.focus({ preventScroll: true })
        paintLine()
      }
    }
  })
  if (player && player.setPlaybackRate) player.setPlaybackRate(SPEEDS[state.speed])
  watchSignIn()
}

// 播放器掛上去;掛不起來就在原地說清楚,頁面其他部分照常。
// ⚠️ 訊息要寫進外框(playerBox),不能寫進 mount:YT.Player 會把 mount 整個換成 iframe,
// 等 onError 回來時手上那個節點早就不在畫面上了,replaceWith 會無聲無息什麼都沒發生。
async function mountPlayer(playerBox, mount, song, { onState = () => {} }) {
  const failed = (message) => {
    const note = el('p', 'study-note', message)
    const link = el('a', 'auth-btn quiet', 'YouTube')
    link.href = `https://www.youtube.com/watch?v=${song.youtubeId}`
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    note.append(' ', link)
    playerBox.classList.add('failed')
    playerBox.replaceChildren(note)
    return null
  }
  try {
    return await createPlayer(mount, song.youtubeId, {
      onState,
      onError: () => failed(TEXT.playerBlocked)
    })
  } catch {
    return failed(TEXT.playerFailed)
  }
}

// 登入/登出之後等級變了,重新載入才拿得到新的句數
function watchSignIn() {
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
    if (mine) await renderSong(mine, { mine: true })
    else if (id) await renderSong(id)
    else await renderList()
  } catch {
    status(TEXT.error)
  }
}

init()

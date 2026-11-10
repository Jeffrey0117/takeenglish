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
  restart: '從頭開始',
  // 打字區
  hint: '整句都要打,點點的字要用聽的 · Enter 看答案並下一句 · Esc 重聽這句',
  waiting: '打完這一句,影片就繼續播(聽不出來按 Enter)',
  revealed: '這就是答案 — 馬上換下一句',
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
    no_subtitles: '這支影片沒有英文字幕,抓不到歌詞',
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
// 按 Enter 看答案之後,停這麼久讓人看清楚再自動往下(再按一次 Enter 就馬上走)
const REVEAL_MS = 1600
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

function showWall(song) {
  window.teWall.show({
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

function songCard(item) {
  const card = el('a', 'lesson-card')
  card.href = item.own ? `/type?mine=${encodeURIComponent(item.id)}` : `/type?id=${encodeURIComponent(item.id)}`
  const cover = el('div', 'lesson-cover')
  if (THUMB.test(item.thumb || '')) cover.style.backgroundImage = `url("${item.thumb}")`
  if (item.level) cover.append(el('span', 'song-level', item.level))
  if (item.duration) cover.append(el('span', 'lesson-duration', TEXT.minutes(item.duration)))
  cover.append(el('span', 'song-lines', TEXT.lines(item.lines)))
  card.append(cover, el('p', 'lesson-title', item.title), el('p', 'lesson-channel', item.artist))
  return card
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
  const grid = el('div', 'lesson-grid')
  for (const item of res.data.items) grid.append(songCard(item))
  main.append(grid)
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
      note.textContent = TEXT.mineErrors[body.error] || TEXT.mineErrors.default
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
          onStateChange: (event) => onState(event.data),
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
  playerBox.append(mount)
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
  let revealTimer = null
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
    clearTimeout(revealTimer)
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
    if (!line || state.revealed || state.correct) {
      input.value = ''
      return
    }
    const next = input.value
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
    if (lineDone(next, line.text)) {
      score.lineCleared(line.text)
      lineComplete('cleared')
    }
  }

  // Enter:把答案掀開來給他看,一下下之後自動下一句(再按一次 Enter 就馬上走)
  function reveal() {
    if (state.revealed) return nextAfterReveal()
    state.revealed = true
    state.typed = ''
    input.value = ''
    if (!done[state.index]) done[state.index] = 'revealed'
    paintLine()
    paintProgress()
    clearTimeout(revealTimer)
    revealTimer = setTimeout(nextAfterReveal, REVEAL_MS)
  }

  function nextAfterReveal() {
    clearTimeout(revealTimer)
    if (!state.revealed) return
    const resume = state.waiting
    if (state.index + 1 >= song.lines.length) {
      state.revealed = false
      return finish()
    }
    goTo(state.index + 1, { resume })
  }

  input.onkeydown = (event) => {
    // Enter:看答案 → 下一句。這是聽不出來時的出口,不然影片會一直停在那裡等
    if (event.key === 'Enter') {
      event.preventDefault()
      if (state.correct) advanceAfterLine()
      else reveal()
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      if (event.shiftKey) goTo(state.index - 1, { seek: true })
      else if (state.index + 1 < song.lines.length) goTo(state.index + 1, { seek: true, resume: state.waiting })
      else finish()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      goTo(state.index, { seek: true, resume: true })
    }
  }

  // ---- 控制列 ----

  // toggle: 這個鈕是開關(會亮起來),要讓讀螢幕的人也知道現在開著還是關著
  function tool(label, onClick, { on = null } = {}) {
    const button = el('button', 'study-btn', label)
    button.type = 'button'
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
  tool(TEXT.again, () => goTo(state.index, { seek: true, resume: true }))
  tool(TEXT.prev, () => goTo(state.index - 1, { seek: true }))
  tool(TEXT.next, () => {
    if (state.index + 1 < song.lines.length) goTo(state.index + 1, { seek: true })
    else finish()
  })
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

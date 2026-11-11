// 聽歌練英打 — 一首歌的練習畫面:打字引擎、控制列、結算、對戰接線。
// 播放器與遮罩在 type-player.js,共用文案與工具在 type-shared.js。
(function () {
  const { TEXT, $, el, status, getJson, postJson } = window.teType
  const { boardTable, createStats, creditsLeft, spendCredit, sideBoard, showWall, params, watchSignIn } = window.teType
  const { coverPref, setCoverPref, mountPlayer } = window.teTypePlayer
  const { same, lineDone, wordAt, lineIndexAt, needsSeek, seekTarget, createScore, pickBlanks, autoBlankCount, wholeLine } = window.teTyping

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
      sideBoard(side, song)
      await mountPlayer(playerBox, mount, song, {})
      watchSignIn()
      return
    }

    const score = createScore()
    const state = {
      index: 0,
      typed: '',
      // 對戰進行中:在第幾句由伺服器決定,自己不能跳句、也不自動往下
      battle: false,
      // 一句挖幾個字。'auto' = 看句子長度決定,0 = 不挖空整句照打
      blankCount: 'auto',
      blanks: [],
      revealed: false,
      // 按了 Enter 但還沒對(下一次打字就清掉)
      rejected: false,
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
    // 對戰的連線(開了房才有)
    let battle = null

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
      replayLine()
    }
    zhView.onclick = (event) => {
      if (!zhView.classList.contains('locked')) return
      event.stopPropagation()
      showWall(song)
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
    const battleMount = el('div', 'battle-mount')
    stage.append(progress, box, tools, stats.node, battleMount, results)
    side.append(lyrics)
    sideBoard(side, song)

    // 右欄歌詞:點一句就跳過去練那一句
    const rows = song.lines.map((line, index) => {
      const row = el('button', 'type-lyric', line.text)
      row.type = 'button'
      row.onclick = () => {
        if (state.battle) return
        goTo(index, { seek: true })
      }
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
      // 鎖住的中文:伺服器沒送內容,只說「這句有中文」。點下去是升級視窗
      const zhLocked = state.showZh && line.zhLocked === true
      zhView.textContent = zhLocked ? TEXT.zhLocked : state.showZh && line.zh ? line.zh : ''
      zhView.classList.toggle('locked', zhLocked)
      hint.textContent = state.correct
        ? TEXT.correct
        : state.rejected
          ? TEXT.rejected
          : state.revealed
            ? TEXT.revealed
            : state.waiting
              ? TEXT.waiting
              : TEXT.hint
      hint.classList.toggle('type-waiting', state.waiting || state.revealed || state.rejected)
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
      state.rejected = false
      input.value = ''
      const line = currentLine()
      state.blanks = blanksFor(line)
      // 多打的字會憑空消失(畫面只畫得出歌詞那麼長),乾脆讓它打不進去
      input.maxLength = line ? line.text.length : 0
      // 影片要跟著句子走。已經播過這一句了(打太慢、或剛剛跳了句)就倒回句首,
      // 不然你在打第 5 句、影片在唱第 8 句,這個練習就散了。
      // 還沒播到不用動 —— 讓它自然播過去,中間的前奏/間奏照樣聽得到
      if (needsSeek(time(), line, shouldSeek)) {
        seek(seekTarget(line))
        state.lastTime = seekTarget(line)
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
      // 練完了才出現,練習進行中不插廣告
      if (window.teAds) window.teAds.render(panel, song.tier)
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
      // 對戰:回報給伺服器,換句由它決定(第一個打完的人得分,全場一起跳)。
      // 自己先跳的話兩邊就不同步了
      if (state.battle && battle) {
        battle.reportCleared(state.index)
        return
      }
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
      state.rejected = false
      // 打完不會自己過 —— 要按 Enter 送出(見 submit)。這裡只負責畫字和記分
      // 掀開答案之後還是可以照著打一次 —— 這是「看到正確答案就想自己打一遍」的那個需求。
      // 但不記分也不抖:答案就在眼前,算進 WPM/正確率就是假的
      if (state.revealed) {
        state.typed = next
        paintLine()
        return
      }
      // 只在「多打了一個字」的時候記分:退格不罰,貼上不算成績
      if (next.length === state.typed.length + 1) {
        const at = next.length - 1
        const expected = line.text[at]
        const correct = expected !== undefined && same(next[at], expected)
        score.key(correct, correct ? '' : wordAt(line.text, at))
        if (!correct) shake()
      }
      state.typed = next
      paintLine()
      stats.update(state.cleared)
    }

    function shake() {
      box.classList.remove('wrong')
      void box.offsetWidth
      box.classList.add('wrong')
    }

    // Enter = 送出。整句對了才過(亮綠 → 下一句);還沒對就抖一下留在原地,
    // 不會換句也不會掀答案 —— 手快多按幾次 Enter 不會把句子跳掉
    function submit() {
      const line = currentLine()
      if (!line) return
      // 對戰時換句由伺服器決定,已經過了就等它,不能自己先走
      if (state.correct) return state.battle ? undefined : advanceAfterLine()
      if (lineDone(state.typed, line.text)) return lineComplete('cleared')
      state.rejected = true
      shake()
      paintLine()
    }

    // Tab = 只是「給我看答案」,不會換句。
    // 看到答案想照著打一次的人可以打完再按 Enter;要直接往下請按 ↓。
    function reveal() {
      const line = currentLine()
      if (!line || state.correct) return
      state.revealed = true
      state.rejected = false
      // 打對的開頭留著,從第一個打錯的地方開始退掉 —— 錯的字會蓋住答案
      // (整句打滿但有錯的時候,不退的話按了看答案畫面上什麼都不會變)。
      // 游標停在第一個錯的位置,從那裡接著打完就好。已經掀開過再按一次也照這樣整理
      let good = 0
      while (good < state.typed.length && same(state.typed[good], line.text[good])) good += 1
      state.typed = state.typed.slice(0, good)
      input.value = state.typed
      if (!done[state.index]) done[state.index] = 'revealed'
      paintLine()
      paintProgress()
    }

    // 對戰時不能自己跳句 —— 大家一定在同一句上,不然就不是對戰了
    const prevLine = () => {
      if (state.battle) return
      goTo(state.index - 1, { seek: true })
    }
    const nextLine = () => {
      if (state.battle) return
      if (state.index + 1 < song.lines.length) goTo(state.index + 1, { seek: true, resume: state.waiting })
      else finish()
    }
    // 重聽這句:只把影片倒回句首再播,已經打的字、掀開的答案都留著。
    // 重聽就是因為有幾個字沒聽清楚 —— 把前面打好的清掉等於罰他重打
    function replayLine() {
      const line = currentLine()
      // 練完了(結算畫面)才走 goTo:要把引擎重新叫醒
      if (!line || state.finished) return goTo(state.index, { seek: true, resume: true })
      seek(seekTarget(line))
      // 不更新的話 tick 會以為是使用者自己拖了進度條
      state.lastTime = seekTarget(line)
      state.waiting = false
      play()
      paintLine()
      input.focus({ preventScroll: true })
    }

    input.onkeydown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        // Shift+Enter 重聽這句:手不用離開打字的位置,比 Esc 好按
        if (event.shiftKey) replayLine()
        else submit()
        return
      }
      // Tab 看答案。一定要 preventDefault,不然焦點會跳到下一顆按鈕、字就打不進來了
      if (event.key === 'Tab') {
        event.preventDefault()
        if (!event.shiftKey) reveal()
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
    tool(TEXT.prev, () => prevLine(), { title: '↑' })
    tool(TEXT.next, () => nextLine(), { title: '↓' })
    // 手機鍵盤沒有 Tab,看答案要有一顆按得到的鈕
    tool(
      TEXT.reveal,
      () => {
        reveal()
        input.focus({ preventScroll: true })
      },
      { title: 'Tab' }
    )
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
    if (song.lines.some((line) => line.zh || line.zhLocked)) {
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
    // 對戰只對公開歌庫的歌開放 —— 自己貼連結加的歌別人沒有
    if (!song.own) {
      tool(TEXT.battle, () => {
        if (!song.signedIn) return window.teSession.login()
        openBattle()
        battleMount.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    }
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

    // ---- 對戰 ----

    // 對戰期間伺服器是唯一的事實:在第幾句、開始了沒、結束了沒都照它說的。
    // 自己這邊只負責「我打完這一句了」這一個回報
    const battleEngine = {
      onEnter: () => {
        state.battle = true
        input.focus({ preventScroll: true })
      },
      onLeave: () => {
        state.battle = false
      },
      onStart: () => {
        // 一場比賽從零開始算:上一輪的分數不能疊進來
        score.reset()
        state.cleared = 0
        done.fill(false)
        state.finished = false
        results.replaceChildren()
        paintProgress()
      },
      onForceLine: (index) => goTo(index, { seek: true, resume: true }),
      onOver: () => {
        state.battle = false
        finish()
      }
    }

    function openBattle(code = '') {
      if (battle) return battle
      if (!window.teBattle) return null
      battle = window.teBattle.attach({ song, mount: battleMount, engine: battleEngine, code })
      return battle
    }

    // 對戰區進來就畫出來,不要藏在一排工具鈕後面 ——
    // 「我要怎麼跟朋友 PK」不該需要先找到那顆鈕。?battle= 是對手傳的連結,直接進房
    const invited = (params.get('battle') || '').trim()
    if (song.signedIn && !song.own) openBattle(invited)

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

  window.teTypeSong = { render: renderSong }
})()

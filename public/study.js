// 「點字就懂」的共用畫面:一句英文(每個字都能點)+ 一句中文。片語搜尋頁和看劇區都用這份。
//   標好的重點片語(黃色底線):點了出現這句話裡的意思
//   其他的字:點了查離線字典(音標、中文、常用程度)
(function () {
  // 這裡的文字要改只改這一處
  const TEXT = {
    seeInShows: '看影集怎麼講 →',
    loading: '解析中…',
    looking: '查詢中…',
    notFound: '字典裡沒有這個字',
    spoken: (original) => `口語,原本是 ${original}`,
    baseForm: (base) => `原形 ${base}`,
    levels: { 1: '最常用', 2: '常用', 3: '中級', 4: '進階', 5: '少見' },
    failed: '解析暫時用不了,稍後再試',
    noSubtitles: '這支片段沒有字幕可以解析',
    login: '登入後可以逐句解析',
    upgrade: '這部分是 Pro 內容',
    dailyLimit: (limit) => `今天的 ${limit} 支免費解析用完了`
  }

  const WORD_CHAR = /[\p{L}\p{N}]/u
  // 一個「字」:字母開頭,中間可以有撇號和連字號(don't、first-class)
  // 撇號和連字號只算在兩個字母中間(him--and 是兩個字,不是一個)
  const TOKEN = /[A-Za-z]+(?:['’-][A-Za-z]+)*['’]?/g
  const lookups = new Map()

  function el(tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  // 把句子切成「一般文字 / 重點片語」的片段。長的片語先配,配過的位置不重複用。
  function segments(text, vocab) {
    const taken = new Array(text.length).fill(null)
    const lower = text.toLowerCase()
    // 少數字元轉小寫後長度會變,位置就對不上;遇到就整句不標
    if (lower.length !== text.length) return [{ text, item: null }]
    const ordered = [...(vocab || [])].sort((a, b) => b.word.length - a.word.length)
    for (const item of ordered) {
      const needle = item.word.toLowerCase()
      if (!needle) continue
      let from = 0
      for (;;) {
        const at = lower.indexOf(needle, from)
        if (at === -1) break
        // 要是完整的字:ten 不能標到 often 裡面
        const whole = !WORD_CHAR.test(lower[at - 1] || '') && !WORD_CHAR.test(lower[at + needle.length] || '')
        const free = whole && taken.slice(at, at + needle.length).every((slot) => slot === null)
        if (free) {
          taken.fill(item, at, at + needle.length)
          break
        }
        from = at + 1
      }
    }
    const parts = []
    let index = 0
    while (index < text.length) {
      const item = taken[index]
      let end = index
      while (end < text.length && taken[end] === item) end += 1
      parts.push({ text: text.slice(index, end), item })
      index = end
    }
    return parts
  }

  function closeTips(root) {
    for (const tip of root.querySelectorAll('.study-tip')) tip.remove()
    for (const word of root.querySelectorAll('.study-word.open')) word.classList.remove('open')
  }

  // 查離線字典。同一個字只問伺服器一次
  function lookupWord(word) {
    const key = word.toLowerCase().replace(/’/g, "'")
    if (!lookups.has(key)) {
      lookups.set(
        key,
        fetch(`/api/dict/${encodeURIComponent(key)}`)
          .then((res) => {
            // 只有「字典裡真的沒有」(404)才記住;被限流或伺服器出錯下次要能再查
            if (!res.ok && res.status !== 404) lookups.delete(key)
            return res.json().then((body) => (res.ok && body.success ? body.data : null))
          })
          .catch(() => {
            lookups.delete(key)
            return null
          })
      )
    }
    return lookups.get(key)
  }

  function searchLink(phrase) {
    const link = el('a', 'study-tip-link', TEXT.seeInShows)
    link.href = `/?q=${encodeURIComponent(phrase)}`
    link.onclick = (event) => event.stopPropagation()
    return link
  }

  // 點一個字 → 開關它旁邊的小卡。fill(tip) 負責把內容放進去
  function attachTip(button, row, fill) {
    button.onclick = (event) => {
      event.stopPropagation()
      const wasOpen = button.classList.contains('open')
      closeTips(row.parentElement || row)
      if (wasOpen) return
      button.classList.add('open')
      const tip = el('span', 'study-tip')
      // 浮在那個字下方,不插進句子裡把後面的字擠走
      tip.place = () => placeTip(tip, button, row)
      row.append(tip)
      fill(tip)
      tip.place()
    }
  }

  // 小卡放在字的正下方;右邊超出就往左推,下方被捲動區塊切掉就改放上方
  function placeTip(tip, button, row) {
    const left = Math.max(0, Math.min(button.offsetLeft, row.clientWidth - tip.offsetWidth - 4))
    tip.style.left = `${left}px`
    tip.style.top = `${button.offsetTop + button.offsetHeight + 4}px`
    const scroller = row.closest('.lesson-lines, .study-panel, .ep-study') || document.documentElement
    const bottom = scroller.getBoundingClientRect().bottom
    if (tip.getBoundingClientRect().bottom > bottom) {
      tip.style.top = `${button.offsetTop - tip.offsetHeight - 4}px`
    }
  }

  function fillFromDictionary(tip, word) {
    tip.append(el('span', 'study-tip-zh', TEXT.looking))
    lookupWord(word).then((entry) => {
      if (!tip.isConnected) return
      tip.replaceChildren()
      if (!entry) {
        tip.append(el('span', 'study-tip-zh', TEXT.notFound), searchLink(word))
        tip.place()
        return
      }
      const head = el('span', 'study-tip-head')
      head.append(el('b', '', entry.word))
      if (entry.phonetic) head.append(el('span', 'study-tip-ipa', `/${entry.phonetic}/`))
      head.append(el('span', `study-level level-${entry.level}`, TEXT.levels[entry.level] || ''))
      tip.append(head)
      if (entry.spoken) tip.append(el('span', 'study-tip-note', TEXT.spoken(entry.spoken)))
      else if (entry.word !== entry.query) tip.append(el('span', 'study-tip-note', TEXT.baseForm(entry.word)))
      for (const sense of entry.senses || []) tip.append(el('span', 'study-tip-zh', sense))
      tip.append(searchLink(entry.word))
      // 內容變多了,重新對位
      tip.place()
    })
  }

  // 一段沒被標成重點片語的文字:裡面每個英文字各自可點
  function appendPlainText(parent, row, text) {
    let last = 0
    for (const match of text.matchAll(TOKEN)) {
      if (match.index > last) parent.append(text.slice(last, match.index))
      const button = el('button', 'study-word plain', match[0])
      button.type = 'button'
      attachTip(button, row, (tip) => fillFromDictionary(tip, match[0]))
      parent.append(button)
      last = match.index + match[0].length
    }
    if (last < text.length) parent.append(text.slice(last))
  }

  // 一行:英文(每個字可點)+ 中文(有的話)
  function renderLine(line) {
    const row = el('div', 'study-line')
    const english = el('p', 'study-en')
    for (const part of segments(line.text || '', line.vocab)) {
      if (!part.item) {
        appendPlainText(english, row, part.text)
        continue
      }
      const phrase = el('button', 'study-word', part.text)
      phrase.type = 'button'
      attachTip(phrase, row, (tip) => {
        tip.append(el('span', 'study-tip-zh', part.item.zh), searchLink(part.item.word))
      })
      english.append(phrase)
    }
    row.append(english)
    if (line.zh) row.append(el('p', 'study-zh', line.zh))
    return row
  }

  // 後端回的錯誤 → 給人看的一句話,以及下一步該做什麼
  function explain(status, body) {
    if (status === 401) return { message: TEXT.login, action: 'login' }
    if (status === 402) {
      const limit = body && body.limit
      const message = typeof limit === 'number' && limit > 0 ? TEXT.dailyLimit(limit) : TEXT.upgrade
      return { message, action: 'upgrade' }
    }
    if (status === 404 && body && body.error === 'no_subtitles') return { message: TEXT.noSubtitles, action: null }
    return { message: TEXT.failed, action: null }
  }

  async function request(path, token) {
    const res = await fetch(path, { cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {} })
    const body = await res.json().catch(() => ({}))
    return { status: res.status, ok: res.ok && body.success === true, data: body.data, body }
  }

  window.teStudy = { TEXT, renderLine, explain, request, closeTips, el }
})()

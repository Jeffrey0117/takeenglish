// 「點字就懂」的共用畫面:一句英文(重點片語可點)+ 一句中文。片語搜尋頁和看劇區都用這份。
(function () {
  // 這裡的文字要改只改這一處
  const TEXT = {
    seeInShows: '看影集怎麼講 →',
    loading: '解析中…',
    failed: '解析暫時用不了,稍後再試',
    noSubtitles: '這支片段沒有字幕可以解析',
    login: '登入後可以逐句解析',
    upgrade: '這部分是 Pro 內容',
    dailyLimit: (limit) => `今天的 ${limit} 支免費解析用完了`
  }

  function el(tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  // 把句子切成「一般文字 / 重點片語」的片段。長的片語先配,配過的位置不重複用。
  const WORD_CHAR = /[\p{L}\p{N}]/u

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

  // 一行:英文(片語可點)+ 中文。點片語出現小卡:中文意思 + 「看影集怎麼講」連到片語搜尋。
  function renderLine(line) {
    const row = el('div', 'study-line')
    const english = el('p', 'study-en')
    for (const part of segments(line.text || '', line.vocab)) {
      if (!part.item) {
        english.append(part.text)
        continue
      }
      const word = el('button', 'study-word', part.text)
      word.type = 'button'
      word.onclick = (event) => {
        event.stopPropagation()
        const wasOpen = word.classList.contains('open')
        closeTips(row.parentElement || row)
        if (wasOpen) return
        word.classList.add('open')
        const tip = el('span', 'study-tip')
        tip.append(el('span', 'study-tip-zh', part.item.zh))
        const link = el('a', 'study-tip-link', TEXT.seeInShows)
        link.href = `/?q=${encodeURIComponent(part.item.word)}`
        link.onclick = (e) => e.stopPropagation()
        tip.append(link)
        word.after(tip)
      }
      english.append(word)
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

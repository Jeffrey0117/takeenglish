// 聽歌練英打的純邏輯:比對一個字、算成績、找句子。
// 抽出來是為了能用 node --test 測(瀏覽器端 window.teTyping,測試端 require)。
;(function () {
  // 鍵盤上打不出來的字 → 打得出來的那個。歌詞常見的彎引號、破折號、全形空白、刪節號
  const SUBSTITUTES = {
    '’': "'",
    '‘': "'",
    'ʼ': "'",
    '´': "'",
    '`': "'",
    '“': '"',
    '”': '"',
    '–': '-',
    '—': '-',
    '−': '-',
    ' ': ' ',
    '　': ' ',
    '…': '.'
  }

  // 一個字元正規化成「使用者打得出來的樣子」。
  // café 的 é 去掉重音記號 → 打 e 就算對;不然一個字母就能讓整句卡死(影片停著等一個打不出來的鍵)。
  function norm(ch) {
    const substitute = SUBSTITUTES[ch]
    if (substitute) return substitute
    const base = ch.normalize('NFD').replace(/\p{M}/gu, '')
    return base || ch
  }

  const same = (a, b) => a !== undefined && b !== undefined && norm(a) === norm(b)

  // 整句打完了沒。一個字一個字比,長度也要一樣(多打的不算完成)
  function lineDone(typed, text) {
    if (typed.length !== text.length) return false
    for (let i = 0; i < text.length; i += 1) {
      if (!same(typed[i], text[i])) return false
    }
    return true
  }

  // 游標所在位置屬於哪個英文字(打錯的時候記下來,結算時告訴他哪些字老是打錯)
  function wordAt(text, index) {
    if (index >= text.length) return ''
    let from = index
    let to = index
    while (from > 0 && /\S/.test(text[from - 1])) from -= 1
    while (to < text.length && /\S/.test(text[to])) to += 1
    return text.slice(from, to).trim()
  }

  // 挖空時跳過的字:冠詞、代名詞、助動詞這些挖了也沒在學英文
  const SKIP_WORDS = new Set(
    ('a an the and or but of to in on at for from with is are am was were be been it its this that these those ' +
      'i me my you your we us our he him his she her they them their so if as do does did not no up out can will just ' +
      'any all now too very oh yeah na la ooh hey')
      .split(' ')
  )

  function hash(text) {
    let value = 5381
    for (let i = 0; i < text.length; i += 1) value = ((value << 5) + value + text.charCodeAt(i)) >>> 0
    return value
  }

  // 一句話裡的英文單字和它們的位置
  function wordSpans(text) {
    const spans = []
    for (const match of String(text || '').matchAll(/[A-Za-z][A-Za-z'’-]*/g)) {
      spans.push({ from: match.index, to: match.index + match[0].length, word: match[0] })
    }
    return spans
  }

  // 真正的聽寫:整句看得到,只挖掉一兩個關鍵字,你只要打那幾個字。
  // 挑哪幾個是固定的(同一句每次挖同樣的字),不然重練一次答案就變了;
  // 挖兩個以上時平均散在句子裡,不要擠在一起。
  function pickBlanks(text, count = 1) {
    const spans = wordSpans(text)
    if (spans.length === 0) return []
    const worth = (span, min) => span.word.length >= min && !SKIP_WORDS.has(span.word.toLowerCase())
    // 先挑有內容的長字(那才值得聽清楚),沒有就放寬,
    // 整句都是小字(例如 "Oh I do")就從全部裡面挑 — 總不能不挖
    const pool = spans.filter((s) => worth(s, 4)).length
      ? spans.filter((s) => worth(s, 4))
      : spans.filter((s) => worth(s, 3)).length
        ? spans.filter((s) => worth(s, 3))
        : spans
    const want = Math.max(1, Math.min(count, pool.length))
    const start = hash(text) % pool.length
    const order = [...pool.slice(start), ...pool.slice(0, start)]
    const picked = []
    for (let i = 0; i < want; i += 1) picked.push(order[Math.floor((i * order.length) / want)])
    return picked.sort((a, b) => a.from - b.from)
  }

  // 整句照打的時候,「挖空」就是整句一格
  function wholeLine(text) {
    return text ? [{ from: 0, to: text.length, word: text }] : []
  }

  // 這個時間點該練哪一句:第一句還沒唱完的。全部唱完了就是最後一句
  function lineIndexAt(seconds, lines) {
    if (!Array.isArray(lines) || lines.length === 0) return 0
    const at = lines.findIndex((line) => seconds < line.end)
    return at === -1 ? lines.length - 1 : at
  }

  // 成績。WPM 用英打的老規矩(5 個字元算一個字),正確率看敲下去的鍵有幾個是對的。
  //
  // 計時只算「真的在打字」的時間:從一句的第一個鍵開始,打完那句就停。
  // 不這樣算的話,MV 前奏和每次停下來等你的時間都會算進去,WPM 跟手速無關。
  function createScore({ now = Date.now } = {}) {
    const misses = new Map()
    const state = { keys: 0, wrong: 0, correctChars: 0, activeMs: 0 }
    let segmentStart = null

    function begin() {
      if (segmentStart === null) segmentStart = now()
    }

    function stop() {
      if (segmentStart === null) return
      state.activeMs += now() - segmentStart
      segmentStart = null
    }

    function seconds() {
      return (state.activeMs + (segmentStart === null ? 0 : now() - segmentStart)) / 1000
    }

    return {
      state,
      misses,
      begin,
      stop,
      key(correct, word) {
        begin()
        state.keys += 1
        if (correct) return
        state.wrong += 1
        if (word) misses.set(word, (misses.get(word) || 0) + 1)
      },
      // 挖空模式下真正打到的只有挖空那幾個字,WPM 就只算那些
      blankCleared(text) {
        state.correctChars += text.length
        stop()
      },
      lineCleared(text) {
        state.correctChars += text.length
        stop()
      },
      // 從頭開始要連成績一起歸零,不然第二輪的 WPM 會疊在第一輪上面
      reset() {
        misses.clear()
        state.keys = 0
        state.wrong = 0
        state.correctChars = 0
        state.activeMs = 0
        segmentStart = null
      },
      seconds,
      wpm() {
        const minutes = seconds() / 60
        return minutes > 0 ? Math.round(state.correctChars / 5 / minutes) : 0
      },
      accuracy() {
        return state.keys > 0 ? Math.round(((state.keys - state.wrong) / state.keys) * 100) : 100
      },
      top(n = 5) {
        return [...misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
      }
    }
  }

  const api = { norm, same, lineDone, wordAt, lineIndexAt, createScore, wordSpans, pickBlanks, wholeLine }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.teTyping = api
})()

const fs = require('node:fs')
const path = require('node:path')

const MAX_QUERY_CHARS = 40
const QUERY_PATTERN = /^[a-z'][a-z'-]*$/
// 常見的縮寫結尾 → 還原成前面那個字(don't → do、we're → we、she'll → she)
const CONTRACTIONS = [/n't$/, /'re$/, /'ve$/, /'ll$/, /'d$/, /'m$/, /'s$/]

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

// 1 = 最常用 … 5 = 少見。看的是常用度排名、柯林斯星等、是不是牛津核心 3000 字。
function levelOf(collins, oxford, rank) {
  if ((rank > 0 && rank <= 2000) || collins >= 5) return 1
  if ((rank > 0 && rank <= 5000) || collins === 4 || oxford) return 2
  if ((rank > 0 && rank <= 10000) || collins === 3) return 3
  if ((rank > 0 && rank <= 20000) || collins >= 1) return 4
  return 5
}

// 規則變化的字尾,字典的詞形表沒收到時的備案:cakes → cake、stopped → stop、making → make
function guessBases(word) {
  const guesses = []
  const add = (base) => base.length >= 2 && guesses.push(base)
  if (word.endsWith('ies')) add(`${word.slice(0, -3)}y`)
  if (word.endsWith('es')) add(word.slice(0, -2))
  if (word.endsWith('s')) add(word.slice(0, -1))
  if (word.endsWith('ied')) add(`${word.slice(0, -3)}y`)
  if (word.endsWith('ed')) {
    add(word.slice(0, -2))
    add(word.slice(0, -1))
    if (word.length > 4 && word[word.length - 3] === word[word.length - 4]) add(word.slice(0, -3))
  }
  if (word.endsWith('ing')) {
    add(word.slice(0, -3))
    add(`${word.slice(0, -3)}e`)
    if (word.length > 5 && word[word.length - 4] === word[word.length - 5]) add(word.slice(0, -4))
  }
  if (word.endsWith('ly')) add(word.slice(0, -2))
  if (word.endsWith("in'")) add(`${word.slice(0, -1)}g`)
  return guesses
}

// 離線英漢字典(點字查詞用)。資料檔由 scripts/build-dictionary.js 建好放在 data/dictionary/,
// 啟動時讀進記憶體,查詢完全不用連外、不用任何付費服務。
function createDictionary({ dir } = {}) {
  const main = dir ? readJson(path.join(dir, 'dictionary.json')) : null
  const spoken = dir ? readJson(path.join(dir, 'spoken.json')) : null
  // 拿掉原型:查 "constructor"、"toString" 這種字時,只會查到字典裡真的有的條目
  const bare = (source) => Object.assign(Object.create(null), source || {})
  const words = bare(main && main.words)
  const forms = bare(main && main.forms)
  const spokenWords = bare(spoken && spoken.words)
  const enabled = Object.keys(words).length > 0

  function entry(word) {
    const found = words[word]
    if (!found) return null
    const [phonetic, senses, collins, oxford, rank] = found
    return { word, phonetic, senses, level: levelOf(collins, oxford, rank) }
  }

  function findBase(word) {
    if (words[word]) return word
    // 單純加 s 的複數先看:詞形表有時會指到少見的拼法(cookies → cooky),cookie 才是大家要的
    if (word.endsWith('s') && !word.endsWith('ss') && words[word.slice(0, -1)]) return word.slice(0, -1)
    if (forms[word] && words[forms[word]]) return forms[word]
    for (const pattern of CONTRACTIONS) {
      const base = word.replace(pattern, '')
      if (base !== word && base.length >= 1 && words[base]) return base
    }
    return guessBases(word).find((base) => words[base]) || null
  }

  // 回 { query, word(字典裡的原形), phonetic, senses[], level, spoken? } 或 null
  function lookup(raw) {
    // 先截短再處理:超長的輸入不該讓後面的比對跑很久
    const query = String(raw || '')
      .slice(0, MAX_QUERY_CHARS * 2)
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/^[^a-z']+|[^a-z']+$/g, '')
      .slice(0, MAX_QUERY_CHARS)
    if (!query || !QUERY_PATTERN.test(query)) return null

    const colloquial = spokenWords[query]
    if (Array.isArray(colloquial)) {
      return { query, word: query, phonetic: '', senses: [colloquial[1]], level: 1, spoken: colloquial[0] }
    }
    const base = findBase(query) || findBase(query.replace(/^'+|'+$/g, ''))
    if (!base) return null
    return { query, ...entry(base) }
  }

  return { enabled, lookup, size: Object.keys(words).length, source: (main && main.source) || null }
}

module.exports = { createDictionary, levelOf }

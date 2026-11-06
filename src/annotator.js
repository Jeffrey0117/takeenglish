const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const TIMEOUT_MS = 60_000
const MAX_SENTENCES = 60
const MAX_SENTENCE_CHARS = 600
const MAX_VOCAB_PER_SENTENCE = 6
const MAX_MEMORY_ENTRIES = 500
// 引擎剛失敗過的那一段,這段時間內不再去試(不然每個請求都白花一次翻譯的錢)
const FAILURE_COOLDOWN_MS = 60_000
const MAX_REMEMBERED_FAILURES = 500

function annotatorError(code, message) {
  return Object.assign(new Error(message), { code })
}

function clip(text, max) {
  return typeof text === 'string' ? text.trim().slice(0, max) : ''
}

// 標註引擎回來的一句 → 我們要的樣子。對方回什麼都不照單全收:
// 只留「真的出現在原句裡」的單字片語,長度有上限,欄位型別不對就丟掉。
const WORD_CHAR = /[\p{L}\p{N}]/u

// 片語要以「完整的字」出現在句子裡:ten 不能配到 often 裡面那三個字母
function containsWhole(lowerSentence, needle) {
  let from = 0
  for (;;) {
    const at = lowerSentence.indexOf(needle, from)
    if (at === -1) return false
    const before = at === 0 ? '' : lowerSentence[at - 1]
    const after = lowerSentence[at + needle.length] || ''
    if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) return true
    from = at + 1
  }
}

function normalizeItem(sentence, raw) {
  const lower = sentence.toLowerCase()
  const seen = new Set()
  const vocab = []
  for (const entry of Array.isArray(raw && raw.vocabulary) ? raw.vocabulary : []) {
    const word = clip(entry && entry.word, 80)
    const zh = clip(entry && entry.translation, 120)
    const key = word.toLowerCase()
    if (!word || !zh || seen.has(key) || !containsWhole(lower, key)) continue
    seen.add(key)
    vocab.push({ word, zh })
    if (vocab.length >= MAX_VOCAB_PER_SENTENCE) break
  }
  return { zh: clip(raw && raw.translation, 400), vocab }
}

// 「點字就懂」的資料來源:把英文句子送去標註引擎(ReelScript 的翻譯 + 單字片語解析),
// 拿回每句的中文和重點片語。每次呼叫都要花 AI 的錢,所以算過的一律存檔,同一段只算一次。
function createAnnotator({
  url,
  apiKey = '',
  cacheDir,
  fetchImpl = globalThis.fetch,
  // 一天最多向引擎要幾次「新的」解析(算過的不算)。這是成本的保險絲:
  // 就算有人開一堆免費帳號到處點,一天花掉的 AI 費用也有上限。
  maxNewPerDay = 500,
  now = Date.now,
  onError = (err) => process.stderr.write(`[annotator] ${err.message}\n`)
} = {}) {
  const enabled = Boolean(url)
  const memory = new Map()
  const inflight = new Map()
  let spend = { day: '', count: 0 }
  const failures = new Map()

  function reserveBudget() {
    const day = new Date(now()).toISOString().slice(0, 10)
    if (spend.day !== day) spend = { day, count: 0 }
    if (spend.count >= maxNewPerDay) return false
    spend.count += 1
    return true
  }

  if (enabled && cacheDir) fs.mkdirSync(cacheDir, { recursive: true })

  function fileFor(key) {
    return path.join(cacheDir, `${crypto.createHash('sha256').update(key).digest('hex')}.json`)
  }

  // 記憶體和磁碟都連原句一起存:原句變了(字幕更新之類)就不能用舊的標註
  function remember(key, sentences, items) {
    memory.delete(key)
    if (memory.size >= MAX_MEMORY_ENTRIES) memory.delete(memory.keys().next().value)
    memory.set(key, { fingerprint: JSON.stringify(sentences), items })
  }

  async function readCached(key, sentences) {
    const fingerprint = JSON.stringify(sentences)
    const hit = memory.get(key)
    if (hit && hit.fingerprint === fingerprint) return hit.items
    if (!cacheDir) return null
    try {
      const saved = JSON.parse(await fs.promises.readFile(fileFor(key), 'utf8'))
      if (!Array.isArray(saved.items) || JSON.stringify(saved.sentences) !== fingerprint) return null
      remember(key, sentences, saved.items)
      return saved.items
    } catch {
      return null
    }
  }

  async function request(sentences) {
    let res
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify({ sentences }),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
    } catch (err) {
      throw annotatorError('failed', `annotation service unreachable: ${err.message}`)
    }
    const body = await res.json().catch(() => null)
    if (!res.ok || !body || !Array.isArray(body.items) || body.items.length !== sentences.length) {
      throw annotatorError('failed', `annotation service returned ${res.status} with an unusable body`)
    }
    const items = sentences.map((sentence, index) => normalizeItem(sentence, body.items[index]))
    // 少了任何一句的中文就是沒算完整(引擎那邊批次失敗會回空字串)。
    // 這種結果不能收,更不能存檔 — 存了就永遠是壞的。
    if (items.some((item) => !item.zh)) {
      throw annotatorError('failed', 'annotation service returned an incomplete translation')
    }
    return items
  }

  // 回 [{ zh, vocab: [{ word, zh }] }],順序與 sentences 一一對應。
  // key 是這段內容的名字(例如 clip:<slug>),用來存檔。
  async function annotate(key, rawSentences) {
    if (!enabled) throw annotatorError('disabled', 'annotation is not configured')
    const sentences = (Array.isArray(rawSentences) ? rawSentences : [])
      .slice(0, MAX_SENTENCES)
      .map((sentence) => clip(sentence, MAX_SENTENCE_CHARS))
    if (sentences.length === 0 || sentences.some((sentence) => !sentence)) return sentences.map(() => ({ zh: '', vocab: [] }))

    const cached = await readCached(key, sentences)
    if (cached) return cached

    // 同一段、同樣的句子同時進來只算一次
    const flightKey = `${key}|${JSON.stringify(sentences)}`
    let pending = inflight.get(flightKey)
    if (!pending) {
      if ((failures.get(flightKey) || 0) > now()) throw annotatorError('failed', 'annotation failed a moment ago')
      if (!reserveBudget()) throw annotatorError('busy', 'daily annotation budget is used up')
      pending = request(sentences)
        .then(async (items) => {
          remember(key, sentences, items)
          if (cacheDir) {
            await fs.promises
              .writeFile(fileFor(key), JSON.stringify({ key, sentences, items }))
              .catch((err) => onError(new Error(`could not save annotations: ${err.message}`)))
          }
          return items
        })
        .catch((err) => {
          onError(err)
          if (failures.size >= MAX_REMEMBERED_FAILURES) failures.delete(failures.keys().next().value)
          failures.set(flightKey, now() + FAILURE_COOLDOWN_MS)
          throw err
        })
        .finally(() => inflight.delete(flightKey))
      inflight.set(flightKey, pending)
    }
    return pending
  }

  return { enabled, annotate }
}

module.exports = { createAnnotator }

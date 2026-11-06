#!/usr/bin/env node
// 從開源的英漢字典 ECDICT 建出本站「點字查詞」用的字典檔。完全離線、不用任何付費服務。
//
// 用法(只有要重建字典時才需要跑;平常站台直接讀建好的檔案):
//   1. 下載 https://github.com/skywind3000/ECDICT 的 ecdict.csv(約 66MB,MIT 授權)
//   2. npm install            ← 需要 devDependencies 裡的 opencc-js(簡體轉繁體)
//   3. node scripts/build-dictionary.js <ecdict.csv 的路徑>
// 輸出 data/dictionary/dictionary.json,commit 之後部署就生效。
//
// 只收「學英文的人會查」的單字:有常用度排名、或被字典/考試標記過的。
// 釋義是簡體轉繁體(台灣用語),來源是大陸的字典,少數用詞會跟台灣習慣不同。

const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')

const MAX_RANK = 60000
const MAX_SENSES = 3
const MAX_SENSE_CHARS = 60
const WORD_PATTERN = /^[a-z][a-z'-]{0,29}$/
// exchange 欄位裡的詞形代號:過去式、過去分詞、現在分詞、第三人稱單數、複數、比較級、最高級
const FORM_KINDS = new Set(['p', 'd', 'i', '3', 's', 'r', 't'])

// 一行 CSV → 欄位陣列(欄位可以用雙引號包起來,裡面的 "" 代表一個引號)
function parseCsvLine(line) {
  const fields = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"'
        i += 1
      } else if (ch === '"') {
        quoted = false
      } else {
        field += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      fields.push(field)
      field = ''
    } else {
      field += ch
    }
  }
  fields.push(field)
  return fields
}

// 釋義:原檔用字面上的 \n 分行。拿掉 [网络]、[计] 這類領域標註開頭的行,留前幾行、每行不要太長
function cleanSenses(translation, convert) {
  return translation
    .split('\\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('['))
    .slice(0, MAX_SENSES)
    .map((line) => {
      const converted = convert(line).replace(/\s*,\s*/g, '、').replace(/\s*;\s*/g, ';')
      return converted.length > MAX_SENSE_CHARS ? `${converted.slice(0, MAX_SENSE_CHARS - 1)}…` : converted
    })
}

function rankOf(bnc, frq) {
  const ranks = [Number(bnc), Number(frq)].filter((n) => Number.isInteger(n) && n > 0)
  return ranks.length ? Math.min(...ranks) : 0
}

async function main() {
  const source = process.argv[2]
  if (!source || !fs.existsSync(source)) {
    process.stderr.write('usage: node scripts/build-dictionary.js <path to ecdict.csv>\n')
    process.exit(2)
  }
  const OpenCC = require('opencc-js')
  const convert = OpenCC.Converter({ from: 'cn', to: 'twp' })

  const words = {}
  const forms = {}
  const lines = readline.createInterface({ input: fs.createReadStream(source, 'utf8'), crlfDelay: Infinity })
  let header = true
  for await (const line of lines) {
    if (header) {
      header = false
      continue
    }
    const [rawWord, phonetic, , translation, , collins, oxford, tag, bnc, frq, exchange] = parseCsvLine(line)
    const word = (rawWord || '').toLowerCase()
    if (!WORD_PATTERN.test(word) || !translation) continue
    const rank = rankOf(bnc, frq)
    const notable = Number(collins) > 0 || oxford === '1' || Boolean(tag) || (rank > 0 && rank <= MAX_RANK)
    if (!notable) continue
    const senses = cleanSenses(translation, convert)
    if (senses.length === 0) continue
    // [音標, 釋義, 柯林斯星等, 是否牛津核心 3000, 常用度排名]
    words[word] = [phonetic || '', senses, Number(collins) || 0, oxford === '1' ? 1 : 0, rank]
    for (const part of (exchange || '').split('/')) {
      const [kind, form] = part.split(':')
      const lower = (form || '').toLowerCase()
      if (FORM_KINDS.has(kind) && WORD_PATTERN.test(lower) && lower !== word && !forms[lower]) forms[lower] = word
    }
  }
  // 詞形本身就是字典裡的單字時(left、running),以它自己的條目為主,不指回原形
  for (const form of Object.keys(forms)) if (words[form]) delete forms[form]

  const output = {
    source: { name: 'ECDICT', url: 'https://github.com/skywind3000/ECDICT', license: 'MIT' },
    words,
    forms
  }
  const dir = path.join(__dirname, '..', 'data', 'dictionary')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'dictionary.json')
  fs.writeFileSync(file, JSON.stringify(output))
  process.stdout.write(`wrote ${file}\n`)
  process.stdout.write(`words: ${Object.keys(words).length}; word forms: ${Object.keys(forms).length}; size: ${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB\n`)
}

main().catch((err) => {
  process.stderr.write(`build failed: ${err.message}\n`)
  process.exit(1)
})

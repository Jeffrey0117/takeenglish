#!/usr/bin/env node
// 把人工整理的逐句解析原稿(season-N.study.src.json)對上劇情介紹的句子,
// 檢查沒問題之後產生站台實際讀的 season-N.study.json。
//
// 用法:node scripts/stamp-study.js <show-id> <季>
//
// 會檢查:每一集的句數要跟英文介紹切出來的一樣、每個片語都要真的出現在那一句裡。
// 有任何一項不對就不寫檔,並列出是哪一集哪一句。

const fs = require('node:fs')
const path = require('node:path')
const { splitSentences } = require('../src/vtt')

const WORD_CHAR = /[\p{L}\p{N}]/u

function containsWhole(sentence, phrase) {
  const lower = sentence.toLowerCase()
  const needle = phrase.toLowerCase()
  let from = 0
  for (;;) {
    const at = lower.indexOf(needle, from)
    if (at === -1) return false
    if (!WORD_CHAR.test(lower[at - 1] || '') && !WORD_CHAR.test(lower[at + needle.length] || '')) return true
    from = at + 1
  }
}

function main() {
  const [showId, seasonArg] = process.argv.slice(2)
  const season = Number.parseInt(seasonArg, 10)
  if (!/^[a-z0-9-]{1,80}$/.test(showId || '') || !Number.isInteger(season)) {
    process.stderr.write('usage: node scripts/stamp-study.js <show-id> <season>\n')
    process.exit(2)
  }
  const dir = path.join(__dirname, '..', 'data', 'shows', showId)
  const data = JSON.parse(fs.readFileSync(path.join(dir, `season-${season}.json`), 'utf8'))
  const source = JSON.parse(fs.readFileSync(path.join(dir, `season-${season}.study.src.json`), 'utf8'))

  const problems = []
  const episodes = {}
  let lines = 0
  let phrases = 0
  for (const ep of data.episodes) {
    const draft = source.episodes[String(ep.number)]
    if (!draft) continue
    const sentences = splitSentences(ep.summary.en)
    if (draft.length !== sentences.length) {
      problems.push(`episode ${ep.number}: ${draft.length} annotated lines but the summary has ${sentences.length} sentences`)
      continue
    }
    episodes[String(ep.number)] = sentences.map((text, index) => {
      const [zh, vocab] = draft[index]
      if (typeof zh !== 'string' || !zh.trim()) problems.push(`episode ${ep.number} line ${index + 1}: missing Chinese`)
      for (const [word, meaning] of vocab || []) {
        if (!containsWhole(text, word)) problems.push(`episode ${ep.number} line ${index + 1}: "${word}" is not in the sentence`)
        if (!meaning) problems.push(`episode ${ep.number} line ${index + 1}: "${word}" has no Chinese`)
      }
      lines += 1
      phrases += (vocab || []).length
      return { text, zh, vocab: (vocab || []).map(([word, meaning]) => ({ word, zh: meaning })) }
    })
  }
  // 原稿裡有、但這一季沒有的集數(多半是打錯集數),不能默默丟掉
  const known = new Set(data.episodes.map((ep) => String(ep.number)))
  for (const key of Object.keys(source.episodes)) {
    if (!known.has(key)) problems.push(`episode "${key}" is in the source file but not in this season`)
  }
  if (problems.length > 0) {
    process.stderr.write(`${problems.length} problem(s), nothing written:\n  ${problems.join('\n  ')}\n`)
    process.exit(1)
  }
  const file = path.join(dir, `season-${season}.study.json`)
  fs.writeFileSync(file, `${JSON.stringify({ episodes }, null, 1)}\n`)
  process.stdout.write(`wrote ${file}\n`)
  process.stdout.write(`episodes: ${Object.keys(episodes).length}; lines: ${lines}; phrases: ${phrases}\n`)
}

main()

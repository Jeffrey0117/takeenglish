// 一首歌每一句要挖哪幾個字,由伺服器決定 —— 因為離線字典在這邊,
// 字典知道一個字有多少人認得(level 1 = 最常用 … 5 = 少見),挖難字才有在學東西。
// 前端拿到的是「照難度排好的候選位置」,它自己決定要用前幾個(看挖 1 個還 2 個)。
const { wordSpans, isWeakWord } = require('../public/typing-core')

// 一句送出幾個候選。前端最多挖兩個,多給一個是為了同一句重複出現時可以換著挖
const CANDIDATES_PER_LINE = 3
const MIN_WORD = 3
// 查不到的字(專有名詞、口語拼法 gonna/tryna)當作偏難:歌詞裡這些本來就不好聽出來
const UNKNOWN_LEVEL = 4
const MAX_LENGTH_SCORE = 12

// 難度分數:字典的 level 是主要依據,同級的用長度分高下
function scoreWord(word, dictionary) {
  const entry = dictionary && dictionary.enabled ? dictionary.lookup(word.toLowerCase()) : null
  const level = entry && Number.isInteger(entry.level) ? entry.level : UNKNOWN_LEVEL
  return level * 100 + Math.min(word.length, MAX_LENGTH_SCORE)
}

// 一句話裡值得挖的字,難的排前面
function rankCandidates(text, dictionary) {
  return wordSpans(text)
    .filter((span) => span.word.length >= MIN_WORD && !isWeakWord(span.word))
    .map((span) => ({ ...span, score: scoreWord(span.word, dictionary) }))
    .sort((a, b) => b.score - a.score || a.from - b.from)
}

// 整首歌的候選。回 [[ [from,to], … ], … ],跟 lines 一一對應。
//
// 同一句歌詞在一首歌裡常常出現三四次(副歌)。每次都挖同一個字的話,
// 第二次之後就只是打字練習了 —— 所以重複出現時把候選輪一格,換個字挖。
function blanksForLines(lines, dictionary) {
  const seen = new Map()
  return lines.map((line) => {
    const text = line.text || ''
    const times = seen.get(text) || 0
    seen.set(text, times + 1)
    const ranked = rankCandidates(text, dictionary)
    if (ranked.length === 0) return []
    const shift = times % ranked.length
    const rotated = [...ranked.slice(shift), ...ranked.slice(0, shift)]
    return rotated.slice(0, CANDIDATES_PER_LINE).map((span) => [span.from, span.to])
  })
}

module.exports = { blanksForLines, rankCandidates, CANDIDATES_PER_LINE }

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { blanksForLines, rankCandidates } = require('../src/song-blanks')

// 假字典:level 1 = 最常用 … 5 = 少見
const DICT = {
  enabled: true,
  lookup(word) {
    const levels = { take: 1, slow: 2, friends: 2, make: 1, moves: 2, sudden: 4, heathens: 5, abuse: 4, know: 1, please: 2, welcome: 2, tonight: 2 }
    const level = levels[word]
    return level ? { word, level } : null
  }
}

const wordsOf = (text, pairs) => pairs.map(([from, to]) => text.slice(from, to))

test('挑難字:字典說少見的排前面', () => {
  const text = 'All my friends are heathens, take it slow'
  const ranked = rankCandidates(text, DICT).map((span) => span.word)
  assert.equal(ranked[0], 'heathens') // level 5
  assert.ok(ranked.indexOf('friends') < ranked.indexOf('take'), 'friends(2) 要排在 take(1) 前面')
  // 挖了沒在學英文的字不該出現
  for (const weak of ['my', 'are', 'it', 'All']) assert.ok(!ranked.includes(weak), `不該挑 ${weak}`)
})

test('位置對得回原句', () => {
  const text = 'Please don’t make any sudden moves'
  for (const span of rankCandidates(text, DICT)) {
    assert.equal(text.slice(span.from, span.to), span.word)
  }
})

test('查不到的字當偏難(專有名詞、gonna/tryna 這種口語拼法)', () => {
  const ranked = rankCandidates('Welcome to Gotham tonight', DICT).map((s) => s.word)
  // Gotham 字典查不到 → 當 level 4,要排在字典說常用的那兩個(level 2)前面
  assert.equal(ranked[0], 'Gotham')
})

test('同一句歌詞重複出現時換一個字挖', () => {
  const chorus = 'All my friends are heathens, take it slow'
  const lines = [{ text: chorus }, { text: 'Wait for them to ask you who you know' }, { text: chorus }, { text: chorus }]
  const blanks = blanksForLines(lines, DICT)
  const first = wordsOf(chorus, blanks[0])[0]
  const second = wordsOf(chorus, blanks[2])[0]
  const third = wordsOf(chorus, blanks[3])[0]
  assert.notEqual(first, second, '第二次出現要換一個字')
  assert.notEqual(second, third, '第三次出現再換一個')
  assert.equal(first, 'heathens', '第一次還是挖最難的那個')
})

test('每一句都給得出候選,而且跟 lines 一一對應', () => {
  const lines = [{ text: 'Docked away' }, { text: '' }, { text: '...' }, { text: 'Take it slow' }]
  const blanks = blanksForLines(lines, DICT)
  assert.equal(blanks.length, lines.length)
  assert.deepEqual(blanks[1], []) // 空句子沒得挖
  assert.deepEqual(blanks[2], []) // 沒有英文字
  assert.ok(blanks[0].length >= 1)
})

test('沒有字典也要能用(字典沒載入時退回長度)', () => {
  const text = 'Please don’t make any sudden moves'
  const ranked = rankCandidates(text, null).map((s) => s.word)
  assert.ok(ranked.length > 0)
  assert.ok(!ranked.includes('any'), '停用詞照樣不挑')
})

test('一句最多給三個候選(前端最多挖兩個,多一個是給重複的句子換)', () => {
  const long = 'Welcome to the wonderful room of dangerous people who have rooms of people'
  for (const pairs of blanksForLines([{ text: long }], DICT)) {
    assert.ok(pairs.length <= 3)
  }
})

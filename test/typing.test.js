const { test } = require('node:test')
const assert = require('node:assert/strict')
const { norm, same, lineDone, wordAt, lineIndexAt, createScore, pickBlanks, wholeLine } = require('../public/typing-core')

test('打不出來的字元會對應到鍵盤上打得出來的那個', () => {
  assert.equal(norm('’'), "'") // 彎的單引號
  assert.equal(norm('“'), '"')
  assert.equal(norm('—'), '-') // em dash
  assert.equal(norm(' '), ' ') // 不換行空白
  assert.equal(norm('…'), '.') // 刪節號
  assert.equal(norm('a'), 'a')
})

test('重音字母打成沒重音的也算對(不然一個 é 就能讓整句卡死)', () => {
  assert.ok(same('e', 'é')) // café
  assert.ok(same('n', 'ñ')) // señor
  assert.ok(same('o', 'ö'))
  assert.ok(!same('a', 'e'))
})

test('same 不會把「沒打到」當成相等', () => {
  assert.ok(!same(undefined, 'a'))
  assert.ok(!same('a', undefined))
})

test('整句打完才算完成 — 多打一個字不算', () => {
  assert.ok(lineDone("Don't stop", "Don’t stop"))
  assert.ok(!lineDone("Don't sto", "Don’t stop"))
  assert.ok(!lineDone("Don't stop!", "Don’t stop"))
  assert.ok(!lineDone("Don't stoq", "Don’t stop"))
})

test('打錯的位置回報的是那個字,結算才指得出常錯哪個字', () => {
  const text = 'take it slow'
  assert.equal(wordAt(text, 0), 'take')
  assert.equal(wordAt(text, 3), 'take')
  // 該按空白卻按錯:算在前一個字頭上(「take 之後沒接好」比記一個空字串有用)
  assert.equal(wordAt(text, 4), 'take')
  assert.equal(wordAt(text, 8), 'slow')
  assert.equal(wordAt(text, 99), '')
})

const LINES = [
  { start: 0, end: 4 },
  { start: 4, end: 8 },
  { start: 10, end: 14 }
]

test('拖進度條之後對得回正確的句子', () => {
  assert.equal(lineIndexAt(0, LINES), 0)
  assert.equal(lineIndexAt(3.9, LINES), 0)
  assert.equal(lineIndexAt(4, LINES), 1) // 兩句首尾相接:算下一句
  assert.equal(lineIndexAt(9, LINES), 2) // 間奏:算下一句要唱的
  assert.equal(lineIndexAt(999, LINES), 2) // 唱完了停在最後一句
  assert.equal(lineIndexAt(5, []), 0)
})

// 可控的時鐘,才測得出「只算真的在打字的時間」
function fakeClock() {
  const clock = { t: 1000 }
  return { now: () => clock.t, advance: (ms) => (clock.t += ms) }
}

test('計時只算打字的時間 — 前奏和等人打字的空檔不算', () => {
  const clock = fakeClock()
  const score = createScore({ now: clock.now })
  clock.advance(20_000) // MV 前奏,還沒按任何鍵
  assert.equal(score.seconds(), 0)
  score.key(true, '')
  clock.advance(2000) // 打這一句花 2 秒
  score.lineCleared('12345678901234567890') // 20 個字元 = 4 個字
  clock.advance(30_000) // 影片在放下一段,他沒在打
  assert.equal(score.seconds(), 2)
  // 4 個字 / (2/60) 分鐘 = 120 WPM
  assert.equal(score.wpm(), 120)
})

test('正確率只看敲下去的鍵', () => {
  const score = createScore({ now: fakeClock().now })
  assert.equal(score.accuracy(), 100) // 還沒打
  for (let i = 0; i < 9; i += 1) score.key(true, '')
  score.key(false, 'heathens')
  assert.equal(score.accuracy(), 90)
  assert.deepEqual(score.top(), [['heathens', 1]])
})

// 迴歸測試:reset() 以前不存在,「從頭開始」會把第二輪的成績疊在第一輪上面。
// 拿掉 reset() 的呼叫這個測試就會紅(wpm 不會回到 0、misses 還在)。
test('從頭開始會把成績歸零,第二輪不會疊在第一輪上', () => {
  const clock = fakeClock()
  const score = createScore({ now: clock.now })
  score.key(false, 'heathens')
  clock.advance(1000)
  score.lineCleared('12345678901234567890')
  const firstWpm = score.wpm()
  assert.ok(firstWpm > 0)

  score.reset()
  assert.equal(score.wpm(), 0)
  assert.equal(score.accuracy(), 100)
  assert.equal(score.seconds(), 0)
  assert.deepEqual(score.top(), [])

  // 第二輪同樣的打法要拿到同樣的成績,不是兩倍
  score.key(false, 'heathens')
  clock.advance(1000)
  score.lineCleared('12345678901234567890')
  assert.equal(score.wpm(), firstWpm)
})

// ---- 挖空(真正的聽寫:整句看得到,只挖掉一兩個關鍵字) ----

test('挖掉的是有內容的字,不是 the / my / are 這種', () => {
  const picked = (text, n = 1) => pickBlanks(text, n).map((b) => b.word)
  const weak = ['any', 'my', 'the', 'are', 'it', 'of', 'to', 'you', 'we', 'a', 'is']
  const lines = [
    'All my friends are heathens, take it slow',
    'You don’t know the half of the abuse',
    'Please don’t make any sudden moves',
    'Wait for them to ask you who you know'
  ]
  for (const line of lines) {
    for (const count of [1, 2]) {
      for (const word of picked(line, count)) {
        assert.ok(!weak.includes(word.toLowerCase()), `不該挖「${word}」(${line})`)
        assert.ok(word.length >= 3, `挖的字太短:「${word}」(${line})`)
      }
    }
  }
})

test('同一句每次挖一樣的字 — 重練時答案不能變', () => {
  const text = 'Wait for them to ask you who you know'
  assert.deepEqual(pickBlanks(text, 1), pickBlanks(text, 1))
  assert.deepEqual(pickBlanks(text, 2), pickBlanks(text, 2))
})

test('挖出來的位置真的對得回原句', () => {
  const text = 'All my friends are heathens, take it slow'
  for (const blank of pickBlanks(text, 2)) {
    assert.equal(text.slice(blank.from, blank.to), blank.word)
  }
})

test('挖兩個字會散開,不會挑到同一個', () => {
  const blanks = pickBlanks('Welcome to the room of people who have rooms of people that they loved one day', 2)
  assert.equal(blanks.length, 2)
  assert.notEqual(blanks[0].from, blanks[1].from)
  assert.ok(blanks[0].to <= blanks[1].from, '兩格不能重疊')
})

test('整句都是小字也挖得出來(總不能不挖)', () => {
  assert.equal(pickBlanks('Oh I do', 1).length, 1)
  assert.equal(pickBlanks('Go', 1).length, 1)
  assert.deepEqual(pickBlanks('', 1), [])
  assert.deepEqual(pickBlanks('...', 1), [])
})

test('要的格子比句子裡的字還多時,就挖到沒得挖為止', () => {
  assert.equal(pickBlanks('Docked away', 5).length, 2)
})

test('整句照打模式:整句就是一格', () => {
  const text = 'Take it slow'
  assert.deepEqual(wholeLine(text), [{ from: 0, to: text.length, word: text }])
  assert.deepEqual(wholeLine(''), [])
})

test('挖空只算挖掉的那幾個字的 WPM,不是整句', () => {
  const clock = fakeClock()
  const score = createScore({ now: clock.now })
  score.key(true, '')
  clock.advance(1000)
  score.blankCleared('heathens') // 8 個字元
  assert.equal(score.state.correctChars, 8)
})

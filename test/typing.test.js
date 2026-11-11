const { test } = require('node:test')
const assert = require('node:assert/strict')
const { norm, same, lineDone, wordAt, lineIndexAt, createScore, needsSeek, seekTarget, pickBlanks, autoBlankCount, wholeLine } = require('../public/typing-core')

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

test('挖幾個字看句子長度:短句一個,長句兩個,中間偶爾兩個', () => {
  assert.equal(autoBlankCount('Docked away'), 1)
  assert.equal(autoBlankCount('Please take it slow'), 1)
  // 很長的句子一定兩個(只挖一個太鬆)
  assert.equal(autoBlankCount('The club isn’t the best place to find a lover, so the bar is where I go'), 2)
  // 同一句每次一樣多 — 不然重練一次難度就跳動
  const line = 'All my friends are heathens, take it slow'
  assert.equal(autoBlankCount(line), autoBlankCount(line))
})

test('「有時候」真的是少數 — 整首歌不會每句都挖兩個', () => {
  const lines = [
    'All my friends are heathens, take it slow',
    'Wait for them to ask you who you know',
    'Please don’t make any sudden moves',
    'You don’t know the half of the abuse',
    'Welcome to the room of people',
    'Who have rooms of people that they loved one day',
    'Just because we check the guns at the door',
    'You’ll never know the psychopath sitting next to you',
    'Why’d you come, you knew you should have stayed',
    'All my friends are heathens, take it slow'
  ]
  const two = lines.filter((text) => autoBlankCount(text) === 2).length
  assert.ok(two >= 1, '完全沒有挖兩個的話就沒變化了')
  assert.ok(two < lines.length, '每句都挖兩個就不叫「有時候」')
})

// ---- 換句之後影片要不要跟著跳 ----

const LINE = { start: 10, end: 14 }

test('已經播過這一句了就倒回句首 — 不然打第 5 句、影片唱第 8 句', () => {
  assert.equal(needsSeek(20, LINE), true)
  assert.equal(needsSeek(14, LINE), true) // 剛唱完也算播過
})

test('快要播到就不要動,讓它自然播過去(間奏照樣聽得到)', () => {
  assert.equal(needsSeek(8, LINE), false) // 再兩秒就唱到了
  // 已經唱進這句了:開頭沒聽到,要倒回句首
  assert.equal(needsSeek(12, LINE), true)
  assert.equal(needsSeek(10, LINE), false) // 剛好在句首,不用動
  // 但差太遠就要追上去(連按 Enter 跳過好幾句的情況)
  assert.equal(needsSeek(1, LINE), true)
})

test('使用者自己點的(點歌詞、上一句、重聽)一定跳', () => {
  assert.equal(needsSeek(12, LINE, true), true)
  assert.equal(needsSeek(5, LINE, true), true)
})

test('沒有句子就不要亂跳', () => {
  assert.equal(needsSeek(12, null), false)
})

test('大小寫不算錯 — 句首大寫、專有名詞、I 都聽不出來', () => {
  assert.ok(same('a', 'A'))
  assert.ok(same('I', 'i'))
  assert.ok(lineDone('all my friends are heathens', 'All my friends are heathens'))
  assert.ok(lineDone("i'm blinded by the lights", "I'm blinded by the lights"))
  // 打錯字還是要算錯
  assert.ok(!lineDone('all my friemds are heathens', 'All my friends are heathens'))
})

test('連按 Enter 跳過好幾句時,影片要追上來(不是停在原地)', () => {
  // 影片在 41 秒,使用者已經跳到 1:20 那一句 —— 差太遠,要跳過去
  assert.equal(needsSeek(41, { start: 80, end: 84 }), true)
  // 快唱到了(四秒內)就不要動,讓歌自己的小間奏播出來
  assert.equal(needsSeek(78, { start: 80, end: 84 }), false)
  assert.equal(needsSeek(76.5, { start: 80, end: 84 }), false)
})

test('句末暫停之後接著下一句:首尾相接的要倒回句首(不然開頭沒聽到),有間奏的不動', () => {
  // 剛在上一句結尾停住(14.25),下一句從 14 開始 → 這句已經開口了,從這裡播會少聽開頭
  assert.equal(needsSeek(14.25, { start: 14, end: 18 }), true)
  // 中間有三秒間奏,還在容許範圍內 → 讓它自然播過去
  assert.equal(needsSeek(14.25, { start: 17, end: 21 }), false)
})

test('跳到一句時往前多給一點(字幕的開始時間常比歌手開口晚),但不會跳到負的', () => {
  assert.ok(seekTarget({ start: 10, end: 14 }) < 10)
  assert.ok(seekTarget({ start: 10, end: 14 }) >= 9)
  assert.equal(seekTarget({ start: 0.2, end: 3 }), 0)
})

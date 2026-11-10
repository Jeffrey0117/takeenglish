const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createScores } = require('../src/scores')

const OWNER = 'te-user-1'
const OTHER = 'te-user-2'

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'te-scores-'))
}

// 一輪合理的成績:41 句全打完,85 WPM,96%
const RUN = {
  songId: 'heathens',
  title: 'Heathens',
  artist: 'twenty one pilots',
  wpm: 85,
  accuracy: 96,
  cleared: 41,
  total: 41,
  peeked: 2,
  seconds: 210
}

test('分數 = WPM × 正確率 × 打完的句數(速度、精準、打多少都算)', () => {
  const scores = createScores({ dir: tmp() })
  const { recorded, run } = scores.add(OWNER, RUN, { name: 'Jeff' })
  assert.equal(recorded, true)
  assert.equal(run.points, Math.round(85 * 0.96 * 41))
})

test('歷史:新的在前,同一首重複練每一輪都留著', () => {
  const scores = createScores({ dir: tmp() })
  scores.add(OWNER, { ...RUN, wpm: 60 }, { name: 'Jeff' })
  scores.add(OWNER, { ...RUN, wpm: 90 }, { name: 'Jeff' })
  const history = scores.history(OWNER)
  assert.equal(history.length, 2)
  assert.equal(history[0].wpm, 90)
  assert.equal(history[1].wpm, 60)
})

test('每首最佳:只留分數最高的那一輪', () => {
  const scores = createScores({ dir: tmp() })
  scores.add(OWNER, { ...RUN, wpm: 60 }, { name: 'Jeff' })
  scores.add(OWNER, { ...RUN, wpm: 90 }, { name: 'Jeff' })
  scores.add(OWNER, { ...RUN, songId: 'believer', wpm: 70 }, { name: 'Jeff' })
  const bests = scores.bests(OWNER)
  assert.equal(bests.heathens.wpm, 90)
  assert.equal(bests.believer.wpm, 70)
})

test('歷史有上限,舊的會被擠掉', () => {
  const scores = createScores({ dir: tmp(), maxHistory: 3 })
  for (let i = 1; i <= 5; i += 1) scores.add(OWNER, { ...RUN, wpm: 50 + i }, { name: 'Jeff' })
  const history = scores.history(OWNER)
  assert.equal(history.length, 3)
  assert.deepEqual(history.map((r) => r.wpm), [55, 54, 53])
})

test('排行榜:一個人只占一列(他自己的最佳),分數高的在前', () => {
  const scores = createScores({ dir: tmp() })
  scores.add(OWNER, { ...RUN, wpm: 60 }, { name: 'Jeff' })
  scores.add(OWNER, { ...RUN, wpm: 95 }, { name: 'Jeff' })
  scores.add(OTHER, { ...RUN, wpm: 80 }, { name: 'Amy' })
  const board = scores.board('heathens')
  assert.deepEqual(board.map((row) => [row.name, row.wpm]), [['Jeff', 95], ['Amy', 80]])
})

test('排行榜不出 email、不出使用者代號 — 沒暱稱就把信箱遮起來', () => {
  const scores = createScores({ dir: tmp() })
  scores.add(OWNER, RUN, { email: 'someone@example.com' })
  const row = scores.board('heathens')[0]
  assert.equal(row.name, 'so***')
  assert.equal(JSON.stringify(row).includes('example.com'), false)
  assert.equal(JSON.stringify(row).includes(OWNER), false)
})

test('自己貼的歌只進個人歷史,不進公開排行榜(別人沒有那首)', () => {
  const scores = createScores({ dir: tmp() })
  scores.add(OWNER, { ...RUN, songId: 'wifey', own: true }, { name: 'Jeff' })
  assert.equal(scores.history(OWNER).length, 1)
  assert.deepEqual(scores.board('wifey'), [])
})

test('不合理的成績不收:太快、超過 100%、句數對不上、時間太短', () => {
  const scores = createScores({ dir: tmp() })
  const bad = [
    { ...RUN, wpm: 500 },
    { ...RUN, accuracy: 120 },
    { ...RUN, cleared: 50, total: 41 },
    { ...RUN, cleared: 41, seconds: 3 },
    { ...RUN, cleared: 1 },
    { ...RUN, wpm: Number.NaN },
    { ...RUN, songId: '../../etc/passwd' }
  ]
  for (const run of bad) assert.equal(scores.add(OWNER, run, { name: 'Jeff' }).recorded, false, JSON.stringify(run).slice(0, 60))
  assert.equal(scores.history(OWNER).length, 0)
})

test('寫下去的成績重開程序也還在(存在磁碟,不是記憶體)', () => {
  const dir = tmp()
  createScores({ dir }).add(OWNER, RUN, { name: 'Jeff' })
  const again = createScores({ dir })
  assert.equal(again.history(OWNER).length, 1)
  assert.equal(again.board('heathens')[0].name, 'Jeff')
})

test('檔案壞掉當成沒有成績,不要讓整頁掛掉', () => {
  const dir = tmp()
  fs.mkdirSync(path.join(dir, 'users'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'users', `${OWNER}.json`), '{ not json')
  const scores = createScores({ dir })
  assert.deepEqual(scores.history(OWNER), [])
  assert.equal(scores.add(OWNER, RUN, { name: 'Jeff' }).recorded, true)
})

test('名次:回報自己這一輪在榜上第幾名', () => {
  const scores = createScores({ dir: tmp() })
  scores.add(OTHER, { ...RUN, wpm: 95 }, { name: 'Amy' })
  const mine = scores.add(OWNER, { ...RUN, wpm: 80 }, { name: 'Jeff' })
  assert.equal(mine.rank, 2)
  const better = scores.add(OWNER, { ...RUN, wpm: 120 }, { name: 'Jeff' })
  assert.equal(better.rank, 1)
})

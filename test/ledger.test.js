const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createLedger } = require('../src/ledger')

const OWNER = 'te-user-1'
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'te-ledger-'))

// 可以撥動的時鐘:跨日、跨月要測得到
function clock(iso) {
  const state = { at: new Date(iso).getTime() }
  return { now: () => state.at, set: (next) => (state.at = new Date(next).getTime()) }
}

test('每天 2 點:花完就不給了', () => {
  const ledger = createLedger({ dir: tmp() })
  assert.deepEqual(ledger.spend(OWNER, 'credits', 'song:a', 2), { allowed: true, used: 1, limit: 2 })
  assert.deepEqual(ledger.spend(OWNER, 'credits', 'song:b', 2), { allowed: true, used: 2, limit: 2 })
  assert.equal(ledger.spend(OWNER, 'credits', 'song:c', 2).allowed, false)
})

test('同一個東西重複花不重複扣(同一首歌當天解鎖兩次只算一次)', () => {
  const ledger = createLedger({ dir: tmp() })
  ledger.spend(OWNER, 'credits', 'song:a', 2)
  const again = ledger.spend(OWNER, 'credits', 'song:a', 2)
  assert.equal(again.allowed, true)
  assert.equal(again.used, 1)
})

test('check 只看不扣', () => {
  const ledger = createLedger({ dir: tmp() })
  assert.deepEqual(ledger.check(OWNER, 'credits', 'song:a', 2), { allowed: true, used: 0, limit: 2 })
  assert.deepEqual(ledger.check(OWNER, 'credits', 'song:a', 2), { allowed: true, used: 0, limit: 2 })
})

test('limit = null 表示不限:不扣、也不寫檔', () => {
  const dir = tmp()
  const ledger = createLedger({ dir })
  assert.deepEqual(ledger.spend(OWNER, 'credits', 'song:a', null), { allowed: true, used: 0, limit: null })
  assert.equal(fs.existsSync(path.join(dir, `${OWNER}.json`)), false)
})

test('limit = 0 表示一點都沒有', () => {
  const ledger = createLedger({ dir: tmp() })
  assert.equal(ledger.spend(OWNER, 'credits', 'song:a', 0).allowed, false)
})

test('跨日歸零,但月額度不會跟著歸零', () => {
  const time = clock('2026-11-11T10:00:00Z')
  const ledger = createLedger({ dir: tmp(), now: time.now })
  ledger.spend(OWNER, 'credits', 'song:a', 2)
  ledger.spend(OWNER, 'uploads', 'url:1', 3, { period: 'month' })
  time.set('2026-11-12T10:00:00Z')
  assert.equal(ledger.check(OWNER, 'credits', 'song:x', 2).used, 0, '隔天 credit 回來')
  assert.equal(ledger.check(OWNER, 'uploads', 'url:2', 3, { period: 'month' }).used, 1, '同月份的上傳數還在')
})

test('跨月:月額度歸零', () => {
  const time = clock('2026-11-30T10:00:00Z')
  const ledger = createLedger({ dir: tmp(), now: time.now })
  ledger.spend(OWNER, 'uploads', 'url:1', 3, { period: 'month' })
  time.set('2026-12-01T10:00:00Z')
  assert.equal(ledger.check(OWNER, 'uploads', 'url:2', 3, { period: 'month' }).used, 0)
})

test('重開程序還記得(存磁碟,不是記憶體)', () => {
  const dir = tmp()
  createLedger({ dir }).spend(OWNER, 'credits', 'song:a', 2)
  assert.equal(createLedger({ dir }).check(OWNER, 'credits', 'song:b', 2).used, 1)
})

test('檔案壞掉當成全新的一天,不要讓請求掛掉', () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, `${OWNER}.json`), '{ not json')
  const ledger = createLedger({ dir })
  assert.equal(ledger.spend(OWNER, 'credits', 'song:a', 2).allowed, true)
})

test('兩個人的額度互不相干', () => {
  const ledger = createLedger({ dir: tmp() })
  ledger.spend(OWNER, 'credits', 'song:a', 1)
  assert.equal(ledger.spend('te-user-2', 'credits', 'song:a', 1).allowed, true)
})

test('不合法的 owner 一律不給(別讓檔名被路徑穿越)', () => {
  const dir = tmp()
  const ledger = createLedger({ dir })
  for (const bad of ['../etc/passwd', 'te-../../x', '', 'user-1']) {
    assert.equal(ledger.spend(bad, 'credits', 'song:a', 2).allowed, false, bad)
  }
  assert.deepEqual(fs.readdirSync(dir), [])
})

test('單一桶子的筆數有上限,不會無限長大', () => {
  const dir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'te-ledger-'))
  const ledger = createLedger({ dir, maxItems: 5 })
  for (let i = 0; i < 20; i += 1) ledger.spend(OWNER, 'credits', `song:${i}`, 100)
  const raw = JSON.parse(require('node:fs').readFileSync(require('node:path').join(dir, `${OWNER}.json`), 'utf8'))
  assert.ok(raw.day.items.credits.length <= 5)
})

const fs = require('node:fs')
const path = require('node:path')

const OWNER_PATTERN = /^te-[A-Za-z0-9_-]{1,80}$/
const BUCKET_PATTERN = /^[a-z][a-z-]{0,31}$/
const MAX_ITEMS = 500
const PERIODS = ['day', 'month']

// 一天一個 key、一個月一個 key。跨過去舊的那一批就整批作廢
const keyFor = (period, at) => new Date(at).toISOString().slice(0, period === 'month' ? 7 : 10)

function emptyPeriod(period, at) {
  return { key: keyFor(period, at), items: {} }
}

// 會被扣掉就要記住的額度:credit(每天)、加歌數(每月)。
//
// 為什麼不用 study-routes 的 createDailyUsage:那個存在記憶體裡,重啟就歸零 ——
// 「每天 2 點 credit」會變成「重新部署就補滿」,而「一個月能加幾首」更是直接失效。
// 這裡一個人一個 JSON 檔,跟成績一樣放 data/ 底下(部署不會刪未追蹤的檔案)。
function createLedger({ dir, now = Date.now, maxItems = MAX_ITEMS } = {}) {
  const fileFor = (owner) => path.join(dir, `${owner}.json`)
  const usable = (owner, bucket) => Boolean(dir) && OWNER_PATTERN.test(String(owner)) && BUCKET_PATTERN.test(String(bucket))

  function read(owner) {
    const at = now()
    let raw = null
    try {
      raw = JSON.parse(fs.readFileSync(fileFor(owner), 'utf8'))
    } catch {
      // 檔案不在、或寫到一半壞掉 → 當成全新的一天。這不該讓請求掛掉
      raw = null
    }
    const out = {}
    for (const period of PERIODS) {
      const current = raw && raw[period] && typeof raw[period] === 'object' ? raw[period] : null
      out[period] =
        current && current.key === keyFor(period, at) && current.items && typeof current.items === 'object'
          ? { key: current.key, items: current.items }
          : emptyPeriod(period, at)
    }
    return out
  }

  function write(owner, data) {
    fs.mkdirSync(dir, { recursive: true })
    const file = fileFor(owner)
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`)
    fs.renameSync(tmp, file)
  }

  const listOf = (data, period, bucket) => (Array.isArray(data[period].items[bucket]) ? data[period].items[bucket] : [])

  function check(owner, bucket, item, limit, { period = 'day' } = {}) {
    if (limit === null) return { allowed: true, used: 0, limit: null }
    if (!usable(owner, bucket)) return { allowed: false, used: 0, limit }
    const used = listOf(read(owner), period, bucket)
    // 同一個東西再要一次不用再付(同一首歌當天解鎖兩次只算一次)
    return { allowed: used.includes(String(item)) || used.length < limit, used: used.length, limit }
  }

  // 這一筆花過了沒有。重新整理頁面要還原「今天已經解鎖過這首」,不能再扣一次
  function has(owner, bucket, item, { period = 'day' } = {}) {
    if (!usable(owner, bucket)) return false
    return listOf(read(owner), period, bucket).includes(String(item))
  }

  function spend(owner, bucket, item, limit, { period = 'day' } = {}) {
    if (limit === null) return { allowed: true, used: 0, limit: null }
    if (!usable(owner, bucket)) return { allowed: false, used: 0, limit }
    const key = String(item)
    const data = read(owner)
    const used = listOf(data, period, bucket)
    if (used.includes(key)) return { allowed: true, used: used.length, limit }
    if (used.length >= limit) return { allowed: false, used: used.length, limit }
    // 上限是防檔案無限長大的保險,不是額度 —— 擠掉最舊的那一筆
    const next = [...used, key].slice(-maxItems)
    data[period].items[bucket] = next
    write(owner, data)
    return { allowed: true, used: next.length, limit }
  }

  return { check, has, spend }
}

module.exports = { createLedger }

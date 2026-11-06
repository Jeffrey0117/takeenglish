const DEFAULT_TTL_MS = 12 * 60 * 60_000
const FAIL_TTL_MS = 10 * 60_000
const WAIT_MS = 2500
const PAGE_SIZE = 60

// 用片名搜片段,挑一支真的出自這部劇的,當封面畫面。
// 片源只能用台詞搜,所以先搜整個片名,再搜片名最後一個詞(例如 "Nine-Nine",劇中常講)。
function queriesFor(titleEn) {
  const words = String(titleEn || '').trim().split(/\s+/).filter(Boolean)
  const last = words[words.length - 1] || ''
  return [...new Set([words.join(' '), last].filter((q) => q.length >= 3))]
}

// 看劇區的封面。Wikipedia 上的海報是有版權限制的宣傳圖,不能拿來用;
// 這裡改用我們自己片段的畫面:卡片用小圖(/thumb),頁首用大圖(/og)。
// 找不到就回 null,頁面會退回純文字版面。
function createShowArtwork({
  clipcafe,
  tokens,
  now = Date.now,
  ttlMs = DEFAULT_TTL_MS,
  failTtlMs = FAIL_TTL_MS,
  waitMs = WAIT_MS,
  onError = (err) => process.stderr.write(`[artwork] ${err.message}\n`)
}) {
  const cache = new Map()
  const inflight = new Map()

  async function lookup(titleEn, season) {
    let fallback = null
    for (const q of queriesFor(titleEn)) {
      const data = await clipcafe.search({ q, size: PAGE_SIZE, from: 0, slop: 0 })
      const clips = (data.results || []).filter((clip) => clip && clip.slug && clip.movieTitle === titleEn)
      // 優先挑同一季的畫面,沒有才用同一部劇的其他季
      const sameSeason = clips.find((clip) => Number(clip.season) === season)
      if (sameSeason) return sameSeason.slug
      fallback = fallback || (clips[0] && clips[0].slug) || null
    }
    return fallback
  }

  function toArtwork(slug) {
    if (!slug) return null
    const id = tokens.seal('id', slug)
    return { card: `/thumb/${id}.jpg`, hero: `/og/${id}.jpg` }
  }

  // 回 { card, hero } 或 null。第一次要去搜片源,最多等 waitMs;來不及就先回 null,下次就有了
  async function get(show, season) {
    const titleEn = show && show.title && show.title.en
    if (!titleEn) return null
    const key = `${show.id}|${season}`
    const hit = cache.get(key)
    if (hit && now() < hit.until) return hit.value

    let pending = inflight.get(key)
    if (!pending) {
      pending = lookup(titleEn, season)
        .then((slug) => {
          const value = toArtwork(slug)
          cache.set(key, { value, until: now() + (value ? ttlMs : failTtlMs) })
          return value
        })
        .catch((err) => {
          onError(new Error(`${show.id} season ${season}: ${err.message}`))
          cache.set(key, { value: null, until: now() + failTtlMs })
          return null
        })
        .finally(() => inflight.delete(key))
      inflight.set(key, pending)
    }
    let timer
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), waitMs)
    })
    try {
      return await Promise.race([pending, timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  return { get }
}

module.exports = { createShowArtwork, queriesFor }

// 保留給測試/文件用的網域,永遠收不到信;送出去只會退信,所以不轉
const RESERVED_DOMAIN = /(^|\.)(example\.(com|org|net)|invalid|test|localhost)$/i
const TIMEOUT_MS = 8000
const RETRY_STATUS = new Set([429, 500, 502, 503, 504])

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 新註冊的會員同步到電子報名單(另一套系統的公開訂閱端點)。
// 對方每分鐘只收幾筆、而且第一次訂閱會自動寄歡迎信,所以:失敗會隔一段時間再試,
// 重複的 email 對方自己會略過。沒設定網址就整個停用。
function createNewsletter({
  url,
  siteId,
  source = 'takeenglish',
  fetchImpl = globalThis.fetch,
  retryDelaysMs = [0, 20_000, 70_000],
  sleep = defaultSleep,
  onError = (err) => process.stderr.write(`[newsletter] ${err.message}\n`)
} = {}) {
  const enabled = Boolean(url && siteId)

  // 回 'disabled' | 'skipped' | 'subscribed' | 'failed'
  async function subscribe({ email, name }) {
    if (!enabled) return 'disabled'
    const address = typeof email === 'string' ? email.trim().toLowerCase() : ''
    const domain = address.split('@')[1] || ''
    if (!address.includes('@') || address.length > 254 || RESERVED_DOMAIN.test(domain)) return 'skipped'

    const body = JSON.stringify({
      email: address,
      site_id: siteId,
      source,
      ...(typeof name === 'string' && name.trim() ? { name: name.trim().slice(0, 80) } : {})
    })
    let lastError = 'no attempt made'
    for (const delay of retryDelaysMs) {
      if (delay > 0) await sleep(delay)
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS)
        })
        await res.body?.cancel().catch(() => {})
        if (res.ok) return 'subscribed'
        lastError = `responded with ${res.status}`
        if (!RETRY_STATUS.has(res.status)) break
      } catch (err) {
        lastError = err.message
      }
    }
    // 記錄裡不放完整信箱
    onError(new Error(`could not subscribe a new member (${domain}): ${lastError}`))
    return 'failed'
  }

  return { enabled, subscribe }
}

module.exports = { createNewsletter }

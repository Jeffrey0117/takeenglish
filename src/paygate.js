const DEFAULT_TIMEOUT_MS = 6000
const MAX_CACHED_USERS = 5000
const FREE = Object.freeze({ tier: 'free', activeUntil: null })

function paygateError(status, message) {
  return Object.assign(new Error(message), { status })
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : ''
}

// PayGate 是訂閱帳本:誰付了錢、到哪一天。這裡不存任何會員資料,
// 每次問 PayGate(短快取),所以不需要自己的資料庫,也不會跟帳本對不上。
function createPaygate({
  baseUrl,
  token,
  product = 'takeenglish',
  planId = 'takeenglish:pro:monthly',
  fetchImpl = globalThis.fetch,
  now = Date.now,
  ttlMs = 60_000,
  staleMs = 10 * 60_000,
  failTtlMs = 30_000,
  planTtlMs = 10 * 60_000,
  onError = (err) => process.stderr.write(`[paygate] ${err.message}\n`)
} = {}) {
  const enabled = Boolean(baseUrl && token)
  // email → { value, at }(最後一次問成功)加上 { failValue, failUntil }(最近一次失敗時的替代答案)
  const users = new Map()
  const inflight = new Map()
  let planCache = null

  async function call(path, { method = 'GET', body, auth = false } = {}) {
    const headers = {}
    if (auth) headers.Authorization = `Bearer ${token}`
    if (body) headers['Content-Type'] = 'application/json'
    const res = await fetchImpl(new URL(path, baseUrl), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw paygateError(res.status, (data && data.error) || `PayGate responded with ${res.status}`)
    if (!data || typeof data !== 'object') throw paygateError(502, 'PayGate returned something that is not JSON')
    return data
  }

  function remember(email, entry) {
    users.delete(email)
    if (users.size >= MAX_CACHED_USERS) users.delete(users.keys().next().value)
    users.set(email, entry)
  }

  async function lookup(key) {
    const previous = users.get(key)
    try {
      const query = new URLSearchParams({ email: key, product })
      const data = await call(`/api/subscription/check?${query}`)
      // 回應長得不對就當失敗,不要把付費的人誤記成免費
      if (typeof data.active !== 'boolean') throw new Error('subscription check returned no "active" field')
      const value = data.active ? { tier: 'pro', activeUntil: data.end_date || null } : FREE
      remember(key, { value, at: now() })
      return value
    } catch (err) {
      onError(new Error(`subscription check failed: ${err.message}`))
      // 十分鐘內問成功過就沿用(付費的人不會被瞬斷踢掉),否則當免費會員。
      // 這個替代答案記 30 秒:PayGate 掛掉時不要每個請求都去等它逾時。
      const hasRecent = previous && previous.at !== undefined && now() - previous.at <= staleMs
      const failValue = hasRecent ? previous.value : FREE
      remember(key, { ...(hasRecent ? previous : {}), failValue, failUntil: now() + failTtlMs })
      return failValue
    }
  }

  // 這個 email 現在是哪個等級
  async function tierFor(email, { fresh = false } = {}) {
    const key = normalizeEmail(email)
    if (!enabled || !key) return FREE
    const hit = users.get(key)
    if (hit && !fresh) {
      if (hit.at !== undefined && now() - hit.at <= ttlMs) return hit.value
      if (hit.failUntil !== undefined && now() < hit.failUntil) return hit.failValue
    }
    // 同一個人同時進來的請求共用一次查詢
    const pending = inflight.get(key)
    if (pending) return pending
    const promise = lookup(key).finally(() => inflight.delete(key))
    inflight.set(key, promise)
    return promise
  }

  function invalidate(email) {
    users.delete(normalizeEmail(email))
  }

  // Pro 方案的名稱與價格。價格只有 PayGate 這一個來源,扣款也是照它。
  async function plan() {
    if (!enabled) return null
    if (planCache && now() < planCache.until) return planCache.value
    try {
      const data = await call(`/api/plans?${new URLSearchParams({ product })}`)
      const found = (data.plans || []).find((p) => p.id === planId && p.is_active && p.price > 0)
      const value = found
        ? { id: found.id, name: found.display_name || 'Pro', price: Number(found.price), cycle: found.billing_cycle }
        : null
      planCache = { value, until: now() + planTtlMs }
      return value
    } catch (err) {
      onError(new Error(`plan lookup failed: ${err.message}`))
      // 沿用上次的方案;失敗的結果也記 30 秒,免得首頁每次載入都卡在逾時
      planCache = { value: planCache ? planCache.value : null, until: now() + failTtlMs }
      return planCache.value
    }
  }

  // 建立訂閱結帳,回付款頁網址
  async function checkout(email, returnUrl) {
    if (!enabled) throw paygateError(503, 'billing is not configured')
    const data = await call('/api/newebpay/subscribe', {
      method: 'POST',
      auth: true,
      body: { email: normalizeEmail(email), product, plan_id: planId, return_url: returnUrl }
    })
    if (typeof data.checkout_url !== 'string' || !/^https?:\/\//.test(data.checkout_url)) {
      throw paygateError(502, 'PayGate returned no checkout url')
    }
    return data.checkout_url
  }

  // 退訂:停止之後的自動扣款,已付的期間照常用到期
  async function cancel(email) {
    if (!enabled) throw paygateError(503, 'billing is not configured')
    const data = await call('/api/newebpay/cancel', {
      method: 'POST',
      auth: true,
      body: { email: normalizeEmail(email), product }
    })
    invalidate(email)
    return { activeUntil: data.active_until || null }
  }

  return { enabled, tierFor, invalidate, plan, checkout, cancel }
}

module.exports = { createPaygate }

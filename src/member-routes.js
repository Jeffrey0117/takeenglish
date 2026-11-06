const TOKEN_PATTERN = /^[A-Za-z0-9_-]{30,400}$/
const DOWNLOAD_TTL_MS = 2 * 60_000

function fail(res, status, error) {
  res.set('Cache-Control', 'no-store')
  return res.status(status).json({ success: false, error })
}

// 會員相關:我是誰/哪個等級、升級結帳、退訂、Pro 下載。
// 這裡的每一支都要登入;等級一律問後端(PayGate),不信前端說的。
function mountMemberRoutes(app, { viewer, plans, paygate, tokens, limiter, publicUrl }) {
  const billingReady = () => paygate.enabled && Boolean(publicUrl)

  function tooMany(res, key, max) {
    if (limiter.check(key, max).allowed) return false
    res.set('Retry-After', '60')
    fail(res, 429, 'too many requests')
    return true
  }

  app.get('/api/me', async (req, res) => {
    // 剛付完款回來會帶 fresh=1,跳過快取直接問帳本;問太兇就退回快取
    const wantFresh = req.query.fresh === '1'
    const first = await viewer(req)
    if (!first.user) return fail(res, 401, 'unauthorized')
    const fresh = wantFresh && limiter.check(`me:${first.user.sub}`, 20).allowed
    const { user, tier, activeUntil } = fresh ? await viewer(req, { fresh: true }) : first
    res.set('Cache-Control', 'no-store')
    return res.json({
      success: true,
      data: { id: user.sub, email: user.email, name: user.name, tier, activeUntil }
    })
  })

  app.post('/api/billing/checkout', async (req, res) => {
    const { user } = await viewer(req)
    if (!user) return fail(res, 401, 'unauthorized')
    if (!billingReady()) return fail(res, 503, 'billing_unavailable')
    if (!user.email) return fail(res, 400, 'account_has_no_email')
    if (tooMany(res, `checkout:${user.sub}`, 6)) return

    try {
      const current = await paygate.tierFor(user.email, { fresh: true })
      if (current.tier === 'pro') return fail(res, 409, 'already_subscribed')
      const checkoutUrl = await paygate.checkout(user.email, `${publicUrl}/?upgraded=1`)
      res.set('Cache-Control', 'no-store')
      return res.json({ success: true, data: { checkoutUrl } })
    } catch (err) {
      process.stderr.write(`[billing] checkout failed: ${err.message}\n`)
      return fail(res, 502, 'billing_unavailable')
    }
  })

  app.post('/api/billing/cancel', async (req, res) => {
    const { user } = await viewer(req)
    if (!user) return fail(res, 401, 'unauthorized')
    if (!billingReady()) return fail(res, 503, 'billing_unavailable')
    if (!user.email) return fail(res, 400, 'account_has_no_email')
    if (tooMany(res, `cancel:${user.sub}`, 4)) return

    try {
      const { activeUntil } = await paygate.cancel(user.email)
      res.set('Cache-Control', 'no-store')
      return res.json({ success: true, data: { activeUntil } })
    } catch (err) {
      if (err.status === 404) return fail(res, 404, 'no_subscription')
      process.stderr.write(`[billing] cancel failed: ${err.message}\n`)
      return fail(res, 502, 'billing_unavailable')
    }
  })

  // Pro 才能下載:驗過等級才發一張兩分鐘有效的下載網址
  app.post('/api/clips/:id/download', async (req, res) => {
    const { id } = req.params
    const slug = TOKEN_PATTERN.test(id) ? tokens.open('id', id) : null
    if (!slug) return fail(res, 404, 'clip_not_found')
    const { user, tier } = await viewer(req)
    if (!user) return fail(res, 401, 'unauthorized')
    if (!plans.can(tier, 'download')) return fail(res, 402, 'upgrade_required')
    if (tooMany(res, `ticket:${user.sub}`, 30)) return

    res.set('Cache-Control', 'no-store')
    return res.json({
      success: true,
      data: { url: `/dl/${tokens.seal('dl', slug, { ttlMs: DOWNLOAD_TTL_MS })}` }
    })
  })
}

module.exports = { mountMemberRoutes }

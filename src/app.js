const path = require('path')
const express = require('express')
const { parseSearchParams } = require('./params')

function createApp({ clipcafe, auth, freeLimit = 3, letmeuse = {} }) {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.static(path.join(__dirname, '..', 'public')))

  // webhook 要驗 raw body 的 HMAC,必須排在 json parser 之前
  app.post('/api/webhooks/letmeuse', express.raw({ type: '*/*' }), (req, res) => {
    const signature = req.get('X-LetMeUse-Signature')
    if (!auth.verifyWebhookSignature(req.body, signature)) {
      return res.status(401).json({ success: false, error: 'invalid signature' })
    }
    const event = req.get('X-LetMeUse-Event') || 'unknown'
    process.stdout.write(`[letmeuse-webhook] ${event}\n`)
    res.json({ received: true })
  })

  app.use(express.json({ limit: '1mb' }))

  // 驗不過、驗到一半出錯,一律當未登入(fail closed)
  async function currentUser(req) {
    const token = auth.extractBearer(req.get('Authorization'))
    if (!token) return null
    try {
      return await auth.verifyToken(token)
    } catch (err) {
      process.stderr.write(`[auth] verify failed: ${err.message}
`)
      return null
    }
  }

  app.get('/api/config', (req, res) => {
    res.json({
      success: true,
      data: {
        letmeuse: {
          appId: letmeuse.appId || null,
          baseUrl: letmeuse.baseUrl || null
        },
        freeLimit
      }
    })
  })

  app.get('/api/me', async (req, res) => {
    const user = await currentUser(req)
    if (!user) {
      return res.status(401).json({ success: false, error: 'unauthorized' })
    }
    res.json({
      success: true,
      data: { id: user.sub, email: user.email, name: user.name }
    })
  })

  app.get('/api/search', async (req, res) => {
    const { params, error } = parseSearchParams(req.query)
    if (error) {
      return res.status(400).json({ success: false, error })
    }

    const user = await currentUser(req)
    const gated = !user && freeLimit > 0
    const effective = gated
      ? { ...params, from: 0, size: Math.min(params.size, freeLimit) }
      : params

    try {
      const data = await clipcafe.search(effective)
      const results = gated ? (data.results || []).slice(0, freeLimit) : data.results
      res.set('Cache-Control', 'private, max-age=60')
      res.json({
        success: true,
        data: {
          ...data,
          results,
          limited: gated && data.total > freeLimit
        }
      })
    } catch (err) {
      process.stderr.write(`[search] q=${JSON.stringify(params.q)}: ${err.message}\n`)
      res.status(502).json({ success: false, error: '搜尋服務暫時出錯,稍後再試' })
    }
  })

  app.use((req, res) => {
    res.status(404).json({ success: false, error: 'not found' })
  })

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    process.stderr.write(`[unhandled] ${req.method} ${req.originalUrl}: ${err.stack}\n`)
    res.status(500).json({ success: false, error: 'internal error' })
  })

  return app
}

module.exports = { createApp }

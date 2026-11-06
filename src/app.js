const path = require('path')
const express = require('express')
const { parseSearchParams } = require('./params')

const SLUG_PATTERN = /^[a-z0-9-]{1,200}$/
const THUMB_CACHE_CONTROL = 'public, max-age=31536000, immutable'
// 沒這張圖、縮圖服務忙 → 照實回給瀏覽器(前端會退回舊的首幀做法);其餘一律 502
const THUMB_PASSTHROUGH_STATUS = new Set([404, 503])

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

  // 影片首幀縮圖,片源在 clipcafe-api。網址帶 .jpg 是為了讓 CDN 照靜態圖快取。
  app.get('/thumb/:slug.jpg', async (req, res) => {
    const { slug } = req.params
    if (!SLUG_PATTERN.test(slug)) {
      return res.status(400).json({ success: false, error: 'invalid slug' })
    }
    try {
      const upstream = await clipcafe.thumb(slug)
      if (upstream.status === 200) {
        res.set('Cache-Control', THUMB_CACHE_CONTROL)
        return res.type('jpeg').send(upstream.body)
      }
      const status = THUMB_PASSTHROUGH_STATUS.has(upstream.status) ? upstream.status : 502
      res.set('Cache-Control', 'no-store')
      return res.status(status).json({ success: false, error: 'thumbnail unavailable' })
    } catch (err) {
      process.stderr.write(`[thumb] slug=${slug}: ${err.message}\n`)
      res.set('Cache-Control', 'no-store')
      return res.status(502).json({ success: false, error: 'thumbnail unavailable' })
    }
  })

  app.use(express.json({ limit: '1mb' }))

  // 驗不過、驗到一半出錯,一律當未登入(fail closed)
  async function currentUser(req) {
    const token = auth.extractBearer(req.get('Authorization'))
    if (!token) return null
    try {
      return await auth.verifyToken(token)
    } catch (err) {
      process.stderr.write(`[auth] verify failed: ${err.message}\n`)
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

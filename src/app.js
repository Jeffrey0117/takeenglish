const path = require('path')
const express = require('express')
const { parseSearchParams } = require('./params')

function createApp({ clipcafe }) {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.static(path.join(__dirname, '..', 'public')))

  app.get('/api/search', async (req, res) => {
    const { params, error } = parseSearchParams(req.query)
    if (error) {
      return res.status(400).json({ success: false, error })
    }
    try {
      const data = await clipcafe.search(params)
      res.set('Cache-Control', 'public, max-age=300')
      res.json({ success: true, data })
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

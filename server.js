const { loadEnv } = require('./src/env')

loadEnv(__dirname)

const crypto = require('node:crypto')
const { createMediaTokens } = require('./src/media-tokens')
const { createPaygate } = require('./src/paygate')
const { createApp } = require('./src/app')
const { createClipcafeClient } = require('./src/clipcafe-client')
const { createAuth } = require('./src/auth')
const { createJwksCache } = require('./src/jwks')

const PORT = Number.parseInt(process.env.PORT || '', 10) || 3300
const CLIPCAFE_API_URL = process.env.CLIPCAFE_API_URL || 'http://localhost:3100'
const LETMEUSE_BASE_URL = process.env.LETMEUSE_BASE_URL || 'https://letmeuse.isnowfriend.com'
const FREE_LIMIT = Number.parseInt(process.env.FREE_LIMIT || '', 10)

const app = createApp({
  clipcafe: createClipcafeClient({
    baseUrl: CLIPCAFE_API_URL,
    apiKey: process.env.CLIPCAFE_API_KEY || ''
  }),
  tokens: createMediaTokens({ secret: mediaSecret() }),
  paygate: createPaygate({
    baseUrl: process.env.PAYGATE_URL,
    token: process.env.PAYGATE_TOKEN,
    planId: process.env.PRO_PLAN_ID || 'takeenglish:pro:monthly'
  }),
  publicUrl: (process.env.PUBLIC_URL || '').replace(/[/]+$/, ''),
  memberLimit: Number.parseInt(process.env.MEMBER_LIMIT || '', 10) || 0,
  strictPlayback: process.env.STRICT_PLAYBACK === '1',
  auth: createAuth({
    appId: process.env.LETMEUSE_APP_ID,
    secret: process.env.LETMEUSE_APP_SECRET,
    jwks: createJwksCache({
      url: process.env.LETMEUSE_JWKS_URL || `${LETMEUSE_BASE_URL}/api/jwks`
    })
  }),
  freeLimit: Number.isInteger(FREE_LIMIT) ? FREE_LIMIT : 3,
  letmeuse: {
    appId: process.env.LETMEUSE_APP_ID || null,
    baseUrl: LETMEUSE_BASE_URL
  }
})

const server = app.listen(PORT, () => {
  process.stdout.write(`takeENGLISH listening on http://localhost:${PORT}\n`)
  process.stdout.write(`clipcafe-api expected at ${CLIPCAFE_API_URL}\n`)
})

server.on('error', (err) => {
  process.stderr.write(`failed to listen on port ${PORT}: ${err.message}\n`)
  process.exit(1)
})

// 影片/縮圖網址的簽章金鑰。正式環境一定要設 MEDIA_SECRET:
// 沒設就每次啟動隨機產生,重啟後舊網址全部失效、縮圖快取也跟著作廢。
function mediaSecret() {
  const configured = process.env.MEDIA_SECRET || ''
  if (configured.length >= 32) return configured
  process.stderr.write('MEDIA_SECRET missing or shorter than 32 chars: using a random one for this run\n')
  return crypto.randomBytes(32).toString('hex')
}

function shutdown() {
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

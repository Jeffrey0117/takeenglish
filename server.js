const { loadEnv } = require('./src/env')

loadEnv(__dirname)

const crypto = require('node:crypto')
const { createMediaTokens } = require('./src/media-tokens')
const { createPaygate } = require('./src/paygate')
const { createNewsletter } = require('./src/newsletter')
const { createAnnotator } = require('./src/annotator')
const { createLessonSource } = require('./src/lessons')
const { createApp } = require('./src/app')
const { createClipcafeClient } = require('./src/clipcafe-client')
const { createAuth } = require('./src/auth')
const { createJwksCache } = require('./src/jwks')

const PORT = Number.parseInt(process.env.PORT || '', 10) || 3300
const CLIPCAFE_API_URL = process.env.CLIPCAFE_API_URL || 'http://localhost:3100'
const LETMEUSE_BASE_URL = process.env.LETMEUSE_BASE_URL || 'https://letmeuse.isnowfriend.com'
const FREE_LIMIT = Number.parseInt(process.env.FREE_LIMIT || '', 10)

// JWKS 公鑰快取。獨立出來是為了開機時 start() 預熱 + 定時刷新：
// 不預熱的話重啟後「第一個」請求就算帶完全有效的 token 也會進到抓金鑰的等待
// 路徑（多一次網路來回）；不定時刷新的話被撤銷的金鑰只會在 kid 變動時才失效。
const jwksCache = createJwksCache({
  url: process.env.LETMEUSE_JWKS_URL || `${LETMEUSE_BASE_URL}/api/jwks`
})

const app = createApp({
  clipcafe: createClipcafeClient({
    baseUrl: CLIPCAFE_API_URL,
    apiKey: process.env.CLIPCAFE_API_KEY || ''
  }),
  tokens: createMediaTokens({ secret: mediaSecret() }),
  paygate: createPaygate({
    baseUrl: process.env.PAYGATE_URL,
    token: process.env.PAYGATE_TOKEN,
    planId: process.env.PRO_PLAN_ID || 'takeenglish:pro:monthly',
    alsoProducts: (process.env.PAYGATE_ALSO_PRODUCTS || '').split(',').map((name) => name.trim()).filter(Boolean)
  }),
  annotator: createAnnotator({
    url: process.env.ANNOTATE_URL,
    apiKey: process.env.ANNOTATE_TOKEN,
    cacheDir: require('node:path').join(__dirname, 'cache', 'annotations'),
    maxNewPerDay: Number.parseInt(process.env.ANNOTATE_DAILY_CAP || '', 10) || 500
  }),
  lessons: createLessonSource({ baseUrl: process.env.LESSON_ENGINE_URL, internalKey: process.env.ANNOTATE_TOKEN || '' }),
  publicUrl: (process.env.PUBLIC_URL || '').replace(/[/]+$/, ''),
  memberLimit: memberLimit(),
  strictPlayback: process.env.STRICT_PLAYBACK === '1',
  newsletter: createNewsletter({
    url: process.env.NEWSLETTER_SUBSCRIBE_URL,
    siteId: process.env.NEWSLETTER_SITE_ID
  }),
  auth: createAuth({
    appId: process.env.LETMEUSE_APP_ID,
    secret: process.env.LETMEUSE_APP_SECRET, // webhook HMAC 用,不是驗 token 用
    jwks: jwksCache
  }),
  freeLimit: Number.isInteger(FREE_LIMIT) ? FREE_LIMIT : 3,
  letmeuse: {
    appId: process.env.LETMEUSE_APP_ID || null,
    baseUrl: LETMEUSE_BASE_URL
  }
})

const server = app.listen(PORT, async () => {
  process.stdout.write(`takeENGLISH listening on http://localhost:${PORT}\n`)
  process.stdout.write(`clipcafe-api expected at ${CLIPCAFE_API_URL}\n`)
  // 預熱 JWKS 並把結果印出來。⚠️ 這裡一定要講話:LetMeUse 的 signAccessToken
  // 在 env 掉了的時候會無聲退回 HS256,那時候「全生態同時 401 且零線索」——
  // 唯一的早期訊號就是這一行說它拿到幾把金鑰。
  await jwksCache.start()
  const s = jwksCache.stats()
  if (!s.keys) {
    process.stderr.write(`[jwks] 預熱沒拿到金鑰 — 所有登入會 401: ${s.lastError}\n`)
  } else {
    process.stdout.write(`[jwks] ready (${s.keys} key(s), kid=${s.kids.join(',')})\n`)
  }
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

// 免費會員每次搜尋看幾筆。沒設 = 5;設 0 = 不限(登入就看全部)
function memberLimit() {
  const parsed = Number.parseInt(process.env.MEMBER_LIMIT || '', 10)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 5
}

function shutdown() {
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

const { loadEnv } = require('./src/env')

loadEnv(__dirname)

const { createApp } = require('./src/app')
const { createClipcafeClient } = require('./src/clipcafe-client')
const { createAuth } = require('./src/auth')
const { createJwksCache } = require('./src/jwks')

const PORT = Number.parseInt(process.env.PORT || '', 10) || 3300
const CLIPCAFE_API_URL = process.env.CLIPCAFE_API_URL || 'http://localhost:3100'
const LETMEUSE_BASE_URL = process.env.LETMEUSE_BASE_URL || 'https://letmeuse.isnowfriend.com'
const FREE_LIMIT = Number.parseInt(process.env.FREE_LIMIT || '', 10)

const app = createApp({
  clipcafe: createClipcafeClient({ baseUrl: CLIPCAFE_API_URL }),
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

function shutdown() {
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

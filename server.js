const { loadEnv } = require('./src/env')

loadEnv(__dirname)

const { createApp } = require('./src/app')
const { createClipcafeClient } = require('./src/clipcafe-client')

const PORT = Number.parseInt(process.env.PORT || '', 10) || 3300
const CLIPCAFE_API_URL = process.env.CLIPCAFE_API_URL || 'http://localhost:3100'

const app = createApp({
  clipcafe: createClipcafeClient({ baseUrl: CLIPCAFE_API_URL })
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

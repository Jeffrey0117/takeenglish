const { test } = require('node:test')
const assert = require('node:assert')
const { createApp } = require('../src/app')
const { createAuth } = require('../src/auth')
const { createClipcafeClient } = require('../src/clipcafe-client')

function fakeClipcafe(thumbImpl) {
  const calls = []
  return {
    calls,
    search: () => Promise.resolve({ total: 0, results: [] }),
    thumb(slug) {
      calls.push(slug)
      return thumbImpl(slug)
    }
  }
}

function startApp(clipcafe) {
  const app = createApp({
    clipcafe,
    auth: createAuth({ appId: 'app_test', secret: 's', jwks: { getKey: async () => null } }),
    freeLimit: 3,
    letmeuse: {}
  })
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` })
    })
  })
}

test('GET /thumb/:slug.jpg serves the upstream jpeg with a long cache lifetime', async () => {
  const clipcafe = fakeClipcafe(async () => ({ status: 200, body: Buffer.from('jpeg-bytes') }))
  const { server, base } = await startApp(clipcafe)
  try {
    const res = await fetch(`${base}/thumb/some-clip.jpg`)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.headers.get('content-type'), 'image/jpeg')
    assert.match(res.headers.get('cache-control'), /max-age=31536000/)
    assert.match(res.headers.get('cache-control'), /immutable/)
    assert.strictEqual(await res.text(), 'jpeg-bytes')
    assert.deepStrictEqual(clipcafe.calls, ['some-clip'])
  } finally {
    server.close()
  }
})

test('GET /thumb/:slug.jpg rejects an invalid slug without calling upstream', async () => {
  const clipcafe = fakeClipcafe(async () => ({ status: 200, body: Buffer.from('x') }))
  const { server, base } = await startApp(clipcafe)
  try {
    for (const bad of ['Bad_Slug', '..%2Fsecret', 'a'.repeat(201)]) {
      const res = await fetch(`${base}/thumb/${bad}.jpg`)
      assert.strictEqual(res.status, 400)
    }
    assert.strictEqual(clipcafe.calls.length, 0)
  } finally {
    server.close()
  }
})

test('upstream misses and overload pass through uncached', async () => {
  for (const status of [404, 503]) {
    const clipcafe = fakeClipcafe(async () => ({ status, body: null }))
    const { server, base } = await startApp(clipcafe)
    try {
      const res = await fetch(`${base}/thumb/some-clip.jpg`)
      assert.strictEqual(res.status, status)
      assert.strictEqual(res.headers.get('cache-control'), 'no-store')
    } finally {
      server.close()
    }
  }
})

test('any other upstream status becomes 502', async () => {
  const clipcafe = fakeClipcafe(async () => ({ status: 500, body: null }))
  const { server, base } = await startApp(clipcafe)
  try {
    const res = await fetch(`${base}/thumb/some-clip.jpg`)
    assert.strictEqual(res.status, 502)
    assert.strictEqual(res.headers.get('cache-control'), 'no-store')
  } finally {
    server.close()
  }
})

test('an upstream connection failure becomes 502, not a hang or crash', async () => {
  const clipcafe = fakeClipcafe(async () => {
    throw new Error('ECONNREFUSED')
  })
  const { server, base } = await startApp(clipcafe)
  try {
    const res = await fetch(`${base}/thumb/some-clip.jpg`)
    assert.strictEqual(res.status, 502)
    assert.strictEqual(res.headers.get('cache-control'), 'no-store')
  } finally {
    server.close()
  }
})

function fakeFetch(response) {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(String(url))
    return response
  }
  return { fetchImpl, calls }
}

function jpegResponse(bytes, { status = 200, type = 'image/jpeg' } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers({ 'content-type': type }),
    arrayBuffer: async () => new Uint8Array(bytes).buffer
  }
}

test('client.thumb fetches the upstream thumbnail endpoint', async () => {
  const { fetchImpl, calls } = fakeFetch(jpegResponse([1, 2, 3]))
  const client = createClipcafeClient({ baseUrl: 'http://clipcafe.test:4054', fetchImpl })

  const result = await client.thumb('some-clip')

  assert.strictEqual(calls[0], 'http://clipcafe.test:4054/api/thumb/some-clip')
  assert.strictEqual(result.status, 200)
  assert.deepStrictEqual([...result.body], [1, 2, 3])
})

test('client.thumb returns the status without a body when upstream has no image', async () => {
  const { fetchImpl } = fakeFetch(jpegResponse([], { status: 404, type: 'application/json' }))
  const client = createClipcafeClient({ baseUrl: 'http://clipcafe.test:4054', fetchImpl })

  const result = await client.thumb('some-clip')
  assert.strictEqual(result.status, 404)
  assert.strictEqual(result.body, null)
})

test('client.thumb refuses a 200 that is not an image or is too large', async () => {
  const notImage = createClipcafeClient({
    baseUrl: 'http://clipcafe.test:4054',
    fetchImpl: fakeFetch(jpegResponse([1], { type: 'text/html' })).fetchImpl
  })
  await assert.rejects(notImage.thumb('some-clip'), /unexpected content type/)

  const tooLarge = createClipcafeClient({
    baseUrl: 'http://clipcafe.test:4054',
    fetchImpl: fakeFetch(jpegResponse(new Array(2 * 1024 * 1024 + 1).fill(0))).fetchImpl
  })
  await assert.rejects(tooLarge.thumb('some-clip'), /too large/)
})

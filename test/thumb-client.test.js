const { test } = require('node:test')
const assert = require('node:assert')
const { createClipcafeClient } = require('../src/clipcafe-client')

function response({ status = 200, type = 'image/jpeg', length, bytes = [1, 2, 3] } = {}) {
  const state = { cancelled: false, read: false }
  const headers = new Headers({ 'content-type': type })
  if (length !== undefined) headers.set('content-length', String(length))
  return {
    state,
    res: {
      status,
      ok: status >= 200 && status < 300,
      headers,
      body: {
        cancel: async () => {
          state.cancelled = true
        }
      },
      arrayBuffer: async () => {
        state.read = true
        return new Uint8Array(bytes).buffer
      }
    }
  }
}

function clientFor(res) {
  return createClipcafeClient({ baseUrl: 'http://clipcafe.test:4054', fetchImpl: async () => res })
}

test('client.thumb rejects an oversized response from its content-length without reading it', async () => {
  const { res, state } = response({ length: 5 * 1024 * 1024 })
  await assert.rejects(clientFor(res).thumb('some-clip'), /too large/)
  assert.strictEqual(state.read, false)
  assert.strictEqual(state.cancelled, true)
})

test('client.thumb releases the connection when the content type is wrong', async () => {
  const { res, state } = response({ type: 'text/html' })
  await assert.rejects(clientFor(res).thumb('some-clip'), /unexpected content type/)
  assert.strictEqual(state.read, false)
  assert.strictEqual(state.cancelled, true)
})

test('client.thumb releases the connection when upstream has no image', async () => {
  const { res, state } = response({ status: 503, type: 'application/json' })
  const result = await clientFor(res).thumb('some-clip')
  assert.deepStrictEqual(result, { status: 503, body: null })
  assert.strictEqual(state.cancelled, true)
})

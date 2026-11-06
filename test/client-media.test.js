const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createClipcafeClient } = require('../src/clipcafe-client')

const BASE = 'http://clipcafe.test:4054'

function fakeFetch(respond) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} })
    return respond(String(url), init)
  }
  return { fetchImpl, calls }
}

test('client: 有設內部金鑰時每個請求都帶 Bearer;沒設就不帶', async () => {
  const ok = () => new Response(JSON.stringify({ success: true, data: { results: [] } }), { status: 200 })
  const withKey = fakeFetch(ok)
  await createClipcafeClient({ baseUrl: BASE, apiKey: 'secret-key', fetchImpl: withKey.fetchImpl }).search({ q: 'hi' })
  assert.equal(withKey.calls[0].headers.Authorization, 'Bearer secret-key')

  const noKey = fakeFetch(ok)
  await createClipcafeClient({ baseUrl: BASE, fetchImpl: noKey.fetchImpl }).search({ q: 'hi' })
  assert.equal(noKey.calls[0].headers.Authorization, undefined)
})

test('client.stream: 帶 Range 與金鑰,回串流與長度標頭', async () => {
  const { fetchImpl, calls } = fakeFetch(
    () =>
      new Response('abcd', {
        status: 206,
        headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-3/9', 'content-length': '4', 'x-other': 'no' }
      })
  )
  const client = createClipcafeClient({ baseUrl: BASE, apiKey: 'k', fetchImpl })
  const result = await client.stream('some-clip', 'bytes=0-3')
  assert.equal(calls[0].url, `${BASE}/api/stream/some-clip`)
  assert.equal(calls[0].headers.Range, 'bytes=0-3')
  assert.equal(calls[0].headers.Authorization, 'Bearer k')
  assert.equal(result.status, 206)
  assert.deepEqual(result.headers, { 'content-length': '4', 'content-range': 'bytes 0-3/9' })
  assert.equal(await new Response(result.body).text(), 'abcd')
})

test('client.stream: 非 200/206 不給 body,只回狀態', async () => {
  const { fetchImpl } = fakeFetch(() => new Response('{"success":false}', { status: 503 }))
  const result = await createClipcafeClient({ baseUrl: BASE, fetchImpl }).stream('some-clip')
  assert.equal(result.status, 503)
  assert.equal(result.body, null)
})

test('client.subtitles: 回 WebVTT 文字;沒字幕回狀態;不是 WebVTT 丟錯', async () => {
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhi\n'
  const good = fakeFetch(() => new Response(vtt, { status: 200 }))
  const client = createClipcafeClient({ baseUrl: BASE, fetchImpl: good.fetchImpl })
  assert.deepEqual(await client.subtitles('some-clip', 'en'), { status: 200, text: vtt })
  assert.equal(good.calls[0].url, `${BASE}/api/subs/some-clip/en`)

  const missing = fakeFetch(() => new Response('{}', { status: 404 }))
  const none = await createClipcafeClient({ baseUrl: BASE, fetchImpl: missing.fetchImpl }).subtitles('some-clip', 'en')
  assert.deepEqual(none, { status: 404, text: null })

  const html = fakeFetch(() => new Response('<html>', { status: 200 }))
  await assert.rejects(createClipcafeClient({ baseUrl: BASE, fetchImpl: html.fetchImpl }).subtitles('some-clip', 'en'))
})

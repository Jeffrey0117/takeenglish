const { test } = require('node:test')
const assert = require('node:assert')
const { parseSearchParams } = require('../src/params')

test('requires q', () => {
  assert.strictEqual(parseSearchParams({}).error, 'q is required')
  assert.strictEqual(parseSearchParams({ q: '  ' }).error, 'q is required')
})

test('defaults and clamps', () => {
  const { params } = parseSearchParams({ q: 'get a life', size: '999', slop: '-3', from: '99999' })
  assert.strictEqual(params.q, 'get a life')
  assert.strictEqual(params.size, 90)
  assert.strictEqual(params.slop, 0)
  assert.strictEqual(params.from, 9910)
})

test('truncates overlong query', () => {
  const { params } = parseSearchParams({ q: 'x'.repeat(500) })
  assert.strictEqual(params.q.length, 200)
})

test('takes first value of repeated params', () => {
  const { params } = parseSearchParams({ q: ['break a leg', 'other'] })
  assert.strictEqual(params.q, 'break a leg')
})

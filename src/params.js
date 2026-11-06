const MAX_SIZE = 90
const MAX_FROM = 10000 - MAX_SIZE
const MAX_SLOP = 10
const MAX_QUERY = 200

function firstString(value) {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : ''
  }
  return typeof value === 'string' ? value : ''
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(firstString(value), 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function parseSearchParams(query) {
  const q = firstString(query.q).trim().slice(0, MAX_QUERY)
  if (!q) return { error: 'q is required' }
  return {
    params: {
      q,
      from: clamp(toInt(query.from, 0), 0, MAX_FROM),
      size: clamp(toInt(query.size, 30), 1, MAX_SIZE),
      slop: clamp(toInt(query.slop, 0), 0, MAX_SLOP)
    }
  }
}

module.exports = { parseSearchParams }

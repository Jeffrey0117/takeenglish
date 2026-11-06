const crypto = require('node:crypto')

const IV_BYTES = 12
const TAG_BYTES = 16
const MAX_TOKEN_CHARS = 400
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/
const SLUG_PATTERN = /^[a-z0-9-]{1,200}$/

// 永久有效的用途(同一支片永遠同一串,給縮圖/字幕這種要長快取的網址用)
const STABLE_PURPOSES = new Set(['id'])

function deriveKey(secret, label) {
  return Buffer.from(crypto.hkdfSync('sha256', secret, Buffer.alloc(0), label, 32))
}

// 把片源的 slug 包成我們自己的不透明代號。
// 對外的網址只會出現這個代號,看不出片源是誰、原始檔名是什麼,也拼不回去。
//   id : 穩定代號,不過期,只能換縮圖和字幕
//   v  : 播放用,會過期
//   dl : 下載用,很快過期
// 每種用途互不通用(用途寫進 AAD),拿 id 去播放端點會驗不過。
function createMediaTokens({ secret, now = Date.now }) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('media token secret must be at least 32 characters')
  }
  const encKey = deriveKey(secret, 'takeenglish-media-enc')
  const ivKey = deriveKey(secret, 'takeenglish-media-iv')

  function seal(purpose, slug, { ttlMs = 0 } = {}) {
    const stable = STABLE_PURPOSES.has(purpose)
    if (stable !== (ttlMs === 0)) {
      throw new Error(`purpose "${purpose}" ${stable ? 'must not' : 'must'} expire`)
    }
    const exp = stable ? 0 : Math.floor((now() + ttlMs) / 1000)
    const plain = Buffer.from(`${exp}.${slug}`)
    // 穩定代號用內容推導 IV:同樣內容永遠同一個 IV(輸出也相同),不同內容不會撞
    const iv = stable
      ? crypto.createHmac('sha256', ivKey).update(purpose).update('\0').update(plain).digest().subarray(0, IV_BYTES)
      : crypto.randomBytes(IV_BYTES)
    const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv)
    cipher.setAAD(Buffer.from(purpose))
    const body = Buffer.concat([cipher.update(plain), cipher.final()])
    return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64url')
  }

  // 驗不過、過期、用途不對 → null
  function open(purpose, token) {
    if (typeof token !== 'string' || token.length > MAX_TOKEN_CHARS || !TOKEN_PATTERN.test(token)) {
      return null
    }
    const raw = Buffer.from(token, 'base64url')
    if (raw.length <= IV_BYTES + TAG_BYTES) return null
    let plain
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, raw.subarray(0, IV_BYTES))
      decipher.setAAD(Buffer.from(purpose))
      decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES))
      plain = Buffer.concat([
        decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)),
        decipher.final()
      ]).toString()
    } catch {
      return null
    }
    const dot = plain.indexOf('.')
    if (dot < 1) return null
    const exp = Number(plain.slice(0, dot))
    const slug = plain.slice(dot + 1)
    if (!Number.isInteger(exp) || !SLUG_PATTERN.test(slug)) return null
    const stable = STABLE_PURPOSES.has(purpose)
    if (stable !== (exp === 0)) return null
    if (!stable && exp * 1000 < now()) return null
    return slug
  }

  return { seal, open }
}

module.exports = { createMediaTokens }

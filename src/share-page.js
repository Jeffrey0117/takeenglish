const fs = require('node:fs')

const MAX_PHRASE_CHARS = 80
const LOOKUP_TIMEOUT_MS = 2500
const REMEMBER_MS = 10 * 60_000
const MAX_REMEMBERED = 1000

function escapeAttr(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// 網址上的 q → 可以放進標題的片語。控制字元拿掉、空白收成一格、過長截斷;沒東西回空字串
function cleanPhrase(raw) {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PHRASE_CHARS)
}

function setMeta(html, attr, name, content) {
  const pattern = new RegExp(`(<meta\\s+${attr}="${name}"\\s+content=")[^"]*(")`)
  return pattern.test(html)
    ? html.replace(pattern, (_, before, after) => `${before}${escapeAttr(content)}${after}`)
    : html.replace('</head>', () => `  <meta ${attr}="${name}" content="${escapeAttr(content)}">\n</head>`)
}

// 帶片語的分享連結(/?q=break+a+leg)要有自己的預覽:標題是那句片語,圖是那句的第一個片段。
// 社群網站的爬蟲不跑 JavaScript,所以要在伺服器把首頁的 <head> 換掉再送出去。
// 頁面本體完全一樣,瀏覽器裡的程式照常運作。
function createSharePage({
  indexPath,
  publicUrl = '',
  lookupImage = async () => null,
  now = Date.now,
  onError = () => {}
}) {
  const template = fs.readFileSync(indexPath, 'utf8')
  const siteTitle = (/<meta\s+property="og:title"\s+content="([^"]*)"/.exec(template) || [])[1] || ''
  const tagline = siteTitle.includes(':') ? siteTitle.slice(siteTitle.indexOf(':') + 1) : siteTitle
  const brand = siteTitle.includes(':') ? siteTitle.slice(0, siteTitle.indexOf(':')) : 'takeENGLISH'

  // 找這句片語的第一個片段當預覽圖;找不到或太慢就用全站預設那張
  // 查過的片語記十分鐘(含「查不到」),同一句被分享、被爬蟲重複抓的時候不用每次都去搜片源
  const remembered = new Map()

  function remember(key, value) {
    remembered.delete(key)
    if (remembered.size >= MAX_REMEMBERED) remembered.delete(remembered.keys().next().value)
    remembered.set(key, { value, until: now() + REMEMBER_MS })
  }

  async function imageFor(phrase) {
    const key = phrase.toLowerCase()
    const hit = remembered.get(key)
    if (hit && now() < hit.until) return hit.value

    let timer
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(undefined), LOOKUP_TIMEOUT_MS)
    })
    // 就算這次等不及,查到的結果還是記下來給下一次用
    const lookup = Promise.resolve()
      .then(() => lookupImage(phrase))
      .then((value) => {
        remember(key, value || null)
        return value || null
      })
      .catch((err) => {
        onError(err)
        remember(key, null)
        return null
      })
    try {
      return (await Promise.race([lookup, timeout])) || null
    } finally {
      clearTimeout(timer)
    }
  }

  async function render(rawQuery) {
    const phrase = cleanPhrase(rawQuery)
    if (!phrase) return null
    const title = `「${phrase}」${tagline}`
    // 替換值一律用函式:片語裡的 $ 才不會被當成替換語法
    let html = template.replace(
      /<title>[^<]*<\/title>/,
      () => `<title>${escapeAttr(title)}｜${escapeAttr(brand)}</title>`
    )
    html = setMeta(html, 'property', 'og:title', title)
    if (publicUrl) {
      html = setMeta(html, 'property', 'og:url', `${publicUrl}/?q=${encodeURIComponent(phrase)}`)
      const imagePath = await imageFor(phrase)
      if (imagePath) {
        html = setMeta(html, 'property', 'og:image', `${publicUrl}${imagePath}`)
        html = setMeta(html, 'name', 'twitter:image', `${publicUrl}${imagePath}`)
      }
    }
    return html
  }

  return { render }
}

module.exports = { createSharePage, cleanPhrase, escapeAttr }

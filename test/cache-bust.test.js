const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

// 靜態檔對外是 Cache-Control: public, max-age=14400(四小時)。
// 所以 HTML 裡的 ?v= 一定要跟著檔案內容變 —— 不然改了程式推上去,
// 使用者的瀏覽器還會抱著舊的 JS 四小時,而且完全沒有徵兆。
// (真的發生過:type.js 連改三版都還掛著 ?v=1。)
//
// 版本號用 ver2 產生:`node ../../ver2/bin/ver2.js ./public`(內容的 md5 前八碼)。
// 改完前端檔案跑一次,這個測試就會過。
const PUBLIC_DIR = path.join(__dirname, '..', 'public')
const ASSET_REF = /(?:href|src)="([^"]+\.(?:js|css))\?v=([^"]*)"/g

const hashOf = (file) => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').slice(0, 8)

const pages = fs.readdirSync(PUBLIC_DIR).filter((name) => name.endsWith('.html'))

test('有 HTML 頁面可以檢查', () => {
  assert.ok(pages.length > 0)
})

for (const page of pages) {
  test(`${page} 的 ?v= 跟檔案內容對得上`, () => {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, page), 'utf8')
    const refs = [...html.matchAll(ASSET_REF)]
    assert.ok(refs.length > 0, `${page} 一個靜態檔都沒引用?`)
    for (const [, href, version] of refs) {
      const file = path.join(PUBLIC_DIR, href.replace(/^\//, ''))
      // 外部網址(CDN)不在這裡管
      if (/^https?:/.test(href)) continue
      assert.ok(fs.existsSync(file), `${page} 指到不存在的檔案:${href}`)
      assert.equal(
        version,
        hashOf(file),
        `${page} 的 ${href}?v=${version} 過期了 — 跑 node ../../ver2/bin/ver2.js ./public 重算`
      )
    }
  })
}

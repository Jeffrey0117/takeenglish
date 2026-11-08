// LetMeUse token 驗證 + webhook 簽章。
//
// 2026-11-08：ES256 驗章的實作搬進 `jwks-verify-kit`（生態系原本有十份各自獨立
// 的拷貝，每份踩到不同的一半坑）。這裡只剩接線與 takeENGLISH 自己的 webhook
// HMAC —— 那是 app secret **正當**的用途，跟 token 驗證無關，所以留著。
//
// LetMeUse 用 ES256 簽 access token，公鑰從 JWKS 拿。這裡只收 ES256：
// HS256（app secret）一律拒收 —— secret 一外洩，任何人都能自簽任意用戶的
// token（pokkit 2026-10-25 事件）；alg none 同理。appId 沒設也一律拒收，因為
// JWKS 是所有 LetMeUse app 共用的，不比對 app claim 就等於別的 app 的 token
// 也能進來。這兩條現在由 kit 強制（appId 缺了 requiredClaims 直接回 null）。
const crypto = require('crypto')
const { verifyJwtAsync, bearerToken } = require('jwks-verify-kit')

function createAuth({ appId, secret, jwks }) {
  /**
   * 驗 token，通過回 payload，否則回 null（從不丟例外）。
   *
   * kit 負責的部分：alg 白名單、kid 必填、簽章長度與**正規化**比對（同一顆
   * token 原本有 16 種等價寫法）、金鑰曲線對照、**先驗簽才解析 payload**、
   * `exp` 必須是數字（沒 exp 或字串 exp = 永不過期，而 4h 的 exp 是這套設計
   * 唯一的撤銷機制）、`nbf`、`sub` 必須非空字串、claims 不走原型鏈。
   *
   * 用 async 版：`jwks.getKey` 在快取 miss 時會等一次抓取，所以重啟後第一個
   * 請求也不會被拒。
   */
  async function verifyToken(token) {
    if (!jwks || typeof jwks.getKey !== 'function') return null // 設定不全 → fail-closed
    return verifyJwtAsync(token, {
      getKey: jwks.getKey,
      algorithms: ['ES256'],
      requiredClaims: { app: appId },
    })
  }

  /** 從 Authorization header 取 Bearer token（scheme 依 RFC 7235 不分大小寫）。 */
  const extractBearer = bearerToken

  /**
   * LetMeUse webhook 的 HMAC 驗章。
   * ⚠️ 這裡用 app secret 是**正當的**：webhook 是 LetMeUse 主動打進來、用共享
   * 密鑰簽的，跟「驗使用者 token」是兩回事。別因為 token 改走 ES256 就把這把
   * secret 從 .env 拿掉 —— 拿掉的話 webhook 會全部驗不過。
   */
  function verifyWebhookSignature(rawBody, signature) {
    if (!secret || !signature) return false
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    const a = Buffer.from(expected)
    const b = Buffer.from(String(signature))
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  }

  return { verifyToken, extractBearer, verifyWebhookSignature }
}

module.exports = { createAuth }

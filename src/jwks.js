// LetMeUse 的 ES256 公鑰快取。
//
// 2026-11-08：實作搬進 `jwks-verify-kit`，這裡只剩接線。kit 版涵蓋原本自己寫的
// 全部行為，而且多了幾件這份沒有的：
//   - `AbortSignal.timeout` **外加**一層 `Promise.race`（注入的 fetchImpl 可能
//     不理 signal，而 node 的 fetch 對「接了連線卻不回應」會永不 settle →
//     in-flight 旗標永遠卡住、快取再也不更新、每個請求都 401 且零診斷）
//   - 那個逾時計時器**不 unref**（unref 的計時器在沒別的事撐著 event loop 時
//     不會觸發，等於沒逾時）
//   - 未知 kid 的重抓冷卻從「抓取**結束**」算起（從開始算的話，慢速或逾時的
//     抓取等於完全沒冷卻），而且用**獨立**計時（跟定時刷新共用會被洗掉）
//   - JWKS 走明文 http 直接 throw、JWK 帶私鑰材料（`d`）大聲拒絕、
//     `redirect: "error"`、金鑰數上限、`stats()` 診斷
//
// 新鮮度策略改成「定時刷新」而不是原本的「查詢時發現超過 10 分鐘就重抓」。
// 兩者對撤銷的反應時間一樣（這裡把 refreshMs 設成同樣的 10 分鐘），但定時版是
// 主動的：請求來的時候金鑰已經是新的，不必在請求路徑上等一次網路。代價是必須
// 呼叫 start()（server.js 已接），不然就只有「miss 時才抓」而不會過期。
const { createJwksCache: createKitJwksCache } = require('jwks-verify-kit')

// 原本的 MAX_AGE_MS：撤銷最慢 10 分鐘生效。保留這個節奏。
const REFRESH_MS = 10 * 60_000
const MISS_COOLDOWN_MS = 60_000
const FETCH_TIMEOUT_MS = 5_000

function defaultOnError(err) {
  process.stderr.write(`[jwks] refresh failed: ${err.message}\n`)
}

/**
 * 回傳 `{ getKey, refresh, start, stop, stats, url, ... }`。
 *
 * `getKey` 是 **async**（快取 miss 時等一次有逾時的抓取），跟改版前一樣 ——
 * 呼叫端（src/auth.js 的 verifyToken）不用改。
 */
function createJwksCache({ url, fetchImpl, now, onError = defaultOnError } = {}) {
  if (!url) {
    throw new Error(
      'takeENGLISH: 沒有設定 JWKS 網址（需要 LETMEUSE_JWKS_URL 或 '
      + 'LETMEUSE_BASE_URL）。沒有網址的驗證器會永遠拒絕每一顆 token，而服務'
      + '照樣回 200、健檢全綠 —— 那種故障最難查（areyoubot 實案跑了三個月），'
      + '所以這裡選擇啟動就失敗。',
    )
  }
  const cache = createKitJwksCache({
    url,
    algorithms: ['ES256'],
    fetchImpl,
    refreshMs: REFRESH_MS,
    missCooldownMs: MISS_COOLDOWN_MS,
    // ⚠️ maxStaleMs 刻意**不**設成 REFRESH_MS。兩者是不同的東西：
    //   refreshMs  = 新鮮度目標（多久主動抓一次）
    //   maxStaleMs = 放棄門檻（連續失敗多久之後就當作沒金鑰、全部拒絕）
    // 把放棄門檻設成 10 分鐘等於「LetMeUse 掛 10 分鐘就把所有人登出」。
    // 留 kit 的預設 24 小時：一次網路抖動不該把登入中的人全部踢掉，但也不會
    // 無限期信任一份抓不回來的舊快取。
    timeoutMs: FETCH_TIMEOUT_MS,
    onError,
    now, // 測試注入假時鐘；生產不傳 = 真實掛鐘
  })
  // getKey 對外維持 async 語意（miss 時等一次抓取）
  return { ...cache, getKey: cache.getKeyAsync, getKeySync: cache.getKey }
}

module.exports = { createJwksCache }

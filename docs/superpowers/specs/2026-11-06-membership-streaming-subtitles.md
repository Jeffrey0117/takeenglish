# 會員等級、付費訂閱、自家串流、字幕

日期:2026-11-06。狀態:已實作。

## 目標

1. 會員分三級(訪客 / 免費會員 / Pro),等級定義單一來源,之後加付費功能只改一處。
2. Pro 走 PayGate + 藍新定期定額,本站不存會員與金流資料。
3. 影片改由自家後端串流,對外不出現片源網址、slug 或任何可拼回片源的欄位。
4. 播放時顯示片源提供的字幕。

## 決定

- **等級**:`src/plans.js` 用 paywall-kit 定義 guest / free / pro。目前唯一的 Pro 專屬功能是下載。
  訪客筆數 `FREE_LIMIT`(3),免費會員筆數 `MEMBER_LIMIT`(5),Pro 全部。兩者都是設定,不用改程式。
- **誰是 Pro**:以登入 token 的 email 問 PayGate `/api/subscription/check`,快取 60 秒。
  PayGate 失聯時沿用十分鐘內的答案,否則當免費會員。不接 webhook、不建資料庫。
- **結帳**:`POST /api/billing/checkout` → PayGate `/api/newebpay/subscribe` → 回付款頁網址。
  email、方案、回跳網址全由後端決定,前端不能指定。已是 Pro 回 409。
- **退訂**:`POST /api/billing/cancel` → PayGate 終止委託,已付期間用到期。
- **價格**:只存在 PayGate 的方案上,前端顯示的數字從 `/api/config` 來。
- **代號**:AES-256-GCM,用途寫進 AAD。`id` 用內容推導 IV(同片同代號,可長快取),
  `v` / `dl` 用隨機 IV 並帶到期時間。
- **串流**:`/v/{token}` → clipcafe-api `/api/stream/{slug}` → 片源,Range 原樣帶過去。
  擋 cross-site 嵌入與網址列直開;`Cross-Origin-Resource-Policy: same-origin`。
- **下載**:Pro 先 `POST /api/clips/{id}/download` 換兩分鐘有效的 `/dl/{token}`。
- **字幕**:`/sub/{id}/{lang}.vtt` → clipcafe-api `/api/subs/{slug}/{lang}`。只給片源列出的語言。
  第一次播放才掛字幕軌。
- **clipcafe-api 上鎖**:`INTERNAL_API_KEY`,沒帶金鑰一律 401。

## 沒做

- DRM、浮水印、HLS 多畫質。能播就能錄,這層只擋直接抓網址與繞過會員限制。
- 影片磁碟快取。每次播放都即時向片源取,流量經過本機對外頻寬。
- PayGate webhook。目前靠短快取,付款完成頁會主動重問一次。

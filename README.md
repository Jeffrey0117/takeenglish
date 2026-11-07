# takeENGLISH

> 這句英文,影集都怎麼說?

面向大眾的英文片語搜尋工具站:輸入一句片語,一次看幾十部影集電影的真實用法。片源走 [clipcafe-api](../clipcafe-api)。

## 怎麼跑

```
cd ../clipcafe-api && node server.js   # 3100
cd takeenglish && npm start            # http://localhost:3300
```

## 功能

- Hero 搜尋 + 熱門片語 chips
- 結果卡片:點擊播放預覽、片語黃色高亮、劇名/季集/片長
- 卡片縮圖:`/thumb/{id}.jpg` 轉送 clipcafe-api 用 ffmpeg 抽好的首幀(長快取);拿不到圖時前端自動退回「載入影片 metadata 跳首幀」
- 字幕:播放時掛上片源的 WebVTT(`/sub/{id}/{lang}.vtt`),卡片上的 CC 鈕開關,偏好記在瀏覽器;位置由 `public/app.js` 的 `CAPTION_BOTTOM_PERCENT` 決定
- 方案區塊:首頁與「方案」視窗列出三個等級,內容來自 `/api/config`;文字集中在 `public/app.js` 的 `PLAN_COPY`
- 影片走自家串流:`/v/{token}` 由後端轉送(支援 Range),對外看不到片源網址
- 相關搜尋 chips(clip.cafe 的 related + didYouMean)
- 寬鬆搜尋(slop=3)、載入更多(分頁)、`?q=` 可分享連結
- 響應式,手機可用

## 免費/登入分層

- 未登入:每次搜尋只回前 `FREE_LIMIT` 筆(預設 3),結果帶 `limited: true`,前端顯示解鎖卡
- 登入(LetMeUse):完整結果。token 走 `Authorization: Bearer`,後端用 LetMeUse 的 JWKS 公鑰驗 ES256 簽章(src/auth.js + src/jwks.js),偽造/過期/別的 app 的 token 一律當未登入
- 只收 ES256:HS256(app secret 自簽)和 alg none 一律拒收。`LETMEUSE_APP_SECRET` 只剩驗 webhook 簽章一個用途;沒設 `LETMEUSE_APP_ID` 時所有 token 無效
- JWKS 位置預設 `{LETMEUSE_BASE_URL}/api/jwks`,同機部署可用 `LETMEUSE_JWKS_URL` 改打 localhost
- 限制做在 server 端 — 未登入連 upstream 都只要 3 筆,F12 看不到多的

## 會員等級與付費

等級定義只有一份:`src/plans.js`(用 paywall-kit)。後端用它擋功能,前端從 `/api/config` 拿同一份。

| 等級 | 誰 | 搜尋結果 | 字幕 | 下載 |
|---|---|---|---|---|
| guest | 沒登入 | 前 `FREE_LIMIT` 筆 | 有 | 無 |
| free | 登入的免費會員 | 前 `MEMBER_LIMIT` 筆(預設 5) | 有 | 無 |
| pro | 付費會員 | 全部 | 有 | 有 |

- 誰是 Pro 由 PayGate 說了算(`src/paygate.js`):每次用 email 問訂閱帳本,快取 60 秒,本站不存任何會員資料
- PayGate 連不上:十分鐘內問過的沿用上次答案,其餘當免費會員,搜尋照常
- 結帳 `POST /api/billing/checkout` 回付款頁網址(藍新定期定額,由 PayGate 建單);退訂 `POST /api/billing/cancel` 停止之後的扣款,已付期間用到期
- Pro 價格只有 PayGate 的方案一個來源(`PRO_PLAN_ID`),程式裡不寫金額
- 要加新的付費功能:在 `src/plans.js` 的 features 加欄位,後端用 `plans.can(tier, '功能')` 擋

## 片源保護

- 搜尋結果不帶 slug、mp4 網址或任何片源欄位;每支片對外只有我們自己簽的代號(`src/media-tokens.js`,AES-GCM)
- 代號分三種用途且互不通用:`id`(縮圖/字幕,不過期)、`v`(播放,6 小時)、`dl`(下載,2 分鐘)
- `/v/{token}`:過期即失效;別站嵌入、把網址貼到網址列直接開都回 403
- `/dl/{token}`:只有 Pro 經 `POST /api/clips/{id}/download` 才拿得到
- clipcafe-api 設了 `INTERNAL_API_KEY` 之後只認帶金鑰的請求,本站用 `CLIPCAFE_API_KEY` 帶同一把
- 能播就能錄,這層擋的是「拿網址直接抓」和「繞過會員限制」,不是 DRM

### 啟用登入(在有 letmeuse MCP 的機器上做一次)

1. `letmeuse_create_app`:name `takeenglish`,domains `["https://{正式網域}", "http://localhost:3300"]`,webhookUrl `https://{正式網域}/api/webhooks/letmeuse`
2. 把回傳的 id/secret 設進環境變數(本地 .env 或 CloudPipe 的 set_project_env):
   `LETMEUSE_APP_ID` / `LETMEUSE_APP_SECRET`
3. 前端會自己從 `/api/config` 拿 appId 載入 SDK,不用改 code

## 設定(.env,可省略)

| 變數 | 預設 |
|---|---|
| PORT | 3300 |
| CLIPCAFE_API_URL | http://localhost:3100 |
| FREE_LIMIT | 3(0 = 不限制) |
| LETMEUSE_APP_ID | (空 = 隱藏登入鈕) |
| LETMEUSE_APP_SECRET | (空 = 所有 token 無效) |
| LETMEUSE_BASE_URL | https://letmeuse.isnowfriend.com |

## 測試

```
npm test
```

## 付費相關設定(.env)

| 變數 | 說明 |
|---|---|
| MEDIA_SECRET | 影片/縮圖代號的簽章金鑰,至少 32 字元。沒設會每次啟動隨機產生,重啟後舊網址全失效 |
| CLIPCAFE_API_KEY | 打 clipcafe-api 用的內部金鑰,要跟對方的 `INTERNAL_API_KEY` 相同 |
| PAYGATE_URL / PAYGATE_TOKEN | PayGate 位置與管理金鑰。兩個都有才開放結帳 |
| PUBLIC_URL | 本站對外網址,付款完成後導回這裡。沒設不開放結帳 |
| PRO_PLAN_ID | PayGate 上的方案代號,預設 `takeenglish:pro:monthly` |
| MEMBER_LIMIT | 免費會員每次搜尋筆數,預設 5;設 0 = 不限 |

## 看劇學習區(/watch)

- 劇 → 季 → 每一集的標題與劇情介紹,可切中文 / English / 雙語
- 資料是離線匯入的:`node scripts/import-wiki-season.js <show-id> <季> "<英文維基頁>" "<中文維基頁>" "<英文劇名>" "<中文劇名>"`,
  產生 `data/shows/<show-id>/season-<季>.json`,commit 後部署就會出現。匯入邏輯在 `src/wiki-import.js`
- 內容來自 Wikipedia(CC BY-SA 4.0),頁尾有來源連結與授權標示,不能拿掉
- 封面不用維基上的海報(那是有版權限制的宣傳圖),改用我們自己片段的畫面(`src/show-artwork.js`),找不到就是純文字版面
- 頁面文字集中在 `public/watch.js` 的 `TEXT`

## 分享預覽

- `/?q=break+a+leg` 由伺服器改寫 `<head>`(`src/share-page.js`):標題是那句片語,預覽圖是那句的第一個片段(`/og/{id}.jpg`,1200x630)
- 搜不到片段或片源太慢時用全站預設圖 `og.png`

## 電子報同步

- LetMeUse 的 `user.registered` webhook 進來時,把新會員的 email 送到電子報的訂閱端點(`src/newsletter.js`)
- 設 `NEWSLETTER_SUBSCRIBE_URL`(完整網址)與 `NEWSLETTER_SITE_ID` 才啟用;啟用時登入按鈕旁會顯示告知文字
- 測試用網域(example.com 等)不會送出

## 逐句解析(點字就懂)

預設完全不花錢,資料有三種來源,後端回應的 `mode` 會說是哪一種:

| mode | 內容 | 成本 |
|---|---|---|
| `dictionary` | 只給原句,每個字點了查離線字典(音標、中文、常用程度) | 零 |
| `curated` | 事先人工標好的中文與重點片語(看劇區的劇情介紹) | 零 |
| `ai` | 標註引擎即時算中文與重點片語 | 每次呼叫都要錢,**預設關閉** |

- 離線字典:`data/dictionary/dictionary.json`(約 5.5 萬字 + 3.2 萬個詞形,繁體),由 `scripts/build-dictionary.js` 從開源的 [ECDICT](https://github.com/skywind3000/ECDICT)(MIT)建出來;`data/dictionary/spoken.json` 是自己補的口語寫法(gonna、wanna…),可以直接增修。查詢 `GET /api/dict/:word`,人人可用
- 事先標好的劇情解析:改 `data/shows/<劇>/season-<季>.study.src.json`,跑 `node scripts/stamp-study.js <劇> <季>` 檢查並產生站台讀的 `season-<季>.study.json`
- 要開付費的標註引擎才設 `ANNOTATE_URL`;沒設就是上面兩種免費模式

以下是開了標註引擎時的行為:

- 英文句子送去標註引擎(ReelScript 的 `POST /api/internal/annotate`),拿回每句的中文和重點片語;`src/annotator.js` 把結果存在 `cache/annotations/`,同一段只算一次(每次呼叫都要花 AI 的錢)
- 三個入口(`src/study-routes.js`):
  - 片段字幕 `GET /api/clips/:id/study`:要登入;免費會員每天 3 支不同的片段,Pro 不限
  - 每集劇情介紹 `GET /api/shows/:id/seasons/:n/episodes/:ep/study`:前 3 集人人可看,之後要 Pro
  - 整集台詞 `…/transcript?page=`:同上的集數規則,要先匯入字幕檔
- 額度都在 `src/plans.js`(`study`、`studyEpisodes`)
- 匯入整集字幕(.srt 或 .vtt),要在跑站的主機上執行,不用重新部署:
  `node scripts/import-episode-subtitles.js <show-id> <季> <集> <字幕檔>`,存到 `data/transcripts/`(不進版控)
- 畫面元件在 `public/study.js`,片語搜尋頁和看劇區共用;點片語會出現中文和「看影集怎麼講」(連到片語搜尋)

## 一張通行證(與 ReelScript)

- `PAYGATE_ALSO_PRODUCTS=reelscript`:ReelScript 的有效訂閱在本站也算 Pro
- 反方向:PayGate 上本站產品的 hook 指到 ReelScript 的 webhook,本站的 Pro 在 ReelScript 也生效
- 導覽列的「影片學習」連到 ReelScript;已登入時先跟 LetMeUse 換一次性通行碼(SSO),過去不用再登入

| 變數 | 說明 |
|---|---|
| ANNOTATE_URL / ANNOTATE_TOKEN | 標註引擎的位置與內部金鑰。沒設就不顯示逐句解析 |
| PAYGATE_ALSO_PRODUCTS | 也算 Pro 的姊妹產品,逗號分隔 |
| REELSCRIPT_URL / REELSCRIPT_APP_ID | 姊妹站網址與它的 LetMeUse app 代號 |

## 之後再說

- 部署(CloudPipe)時 clipcafe-api 要一起上
- 片語解釋/教學內容區塊(接 LLM)
- 收藏/單字本(要接 LetMeUse 登入)

## 影片學習(/lessons)

- 內容是 ReelScript 引擎已經處理好的影片(逐句中英字幕 + 重點單字),本站只讀、不觸發任何處理,不花錢
- 引擎位置 `LESSON_ENGINE_URL`(同機直連它的後端,例如 `http://127.0.0.1:5005`);影片與縮圖由本站轉送 `/lesson-media/{id}/…`,支援 Range
- 訪客看得到英文字幕、每個字可點查字典;登入後才有中文翻譯與重點片語(`src/plans.js` 的 `lessonNotes`)
- 引擎那邊的資料來源:ReelScript `GET /api/public/videos`、`GET /api/public/videos/{id}/lesson`

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
- 相關搜尋 chips(clip.cafe 的 related + didYouMean)
- 寬鬆搜尋(slop=3)、載入更多(分頁)、`?q=` 可分享連結
- 響應式,手機可用

## 免費/登入分層

- 未登入:每次搜尋只回前 `FREE_LIMIT` 筆(預設 3),結果帶 `limited: true`,前端顯示解鎖卡
- 登入(LetMeUse):完整結果。token 走 `Authorization: Bearer`,後端用 LetMeUse 的 JWKS 公鑰驗 ES256 簽章(src/auth.js + src/jwks.js),偽造/過期/別的 app 的 token 一律當未登入
- 只收 ES256:HS256(app secret 自簽)和 alg none 一律拒收。`LETMEUSE_APP_SECRET` 只剩驗 webhook 簽章一個用途;沒設 `LETMEUSE_APP_ID` 時所有 token 無效
- JWKS 位置預設 `{LETMEUSE_BASE_URL}/api/jwks`,同機部署可用 `LETMEUSE_JWKS_URL` 改打 localhost
- 限制做在 server 端 — 未登入連 upstream 都只要 3 筆,F12 看不到多的

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

## 之後再說

- 部署(CloudPipe)時 clipcafe-api 要一起上
- 片語解釋/教學內容區塊(接 LLM)
- 收藏/單字本(要接 LetMeUse 登入)

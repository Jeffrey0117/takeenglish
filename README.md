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

## 設定(.env,可省略)

| 變數 | 預設 |
|---|---|
| PORT | 3300 |
| CLIPCAFE_API_URL | http://localhost:3100 |

## 測試

```
npm test
```

## 之後再說

- 部署(CloudPipe)時 clipcafe-api 要一起上
- 片語解釋/教學內容區塊(接 LLM)
- 收藏/單字本(要接 LetMeUse 登入)

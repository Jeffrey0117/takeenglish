# 聽歌練英打:成績榜、credit、對戰、廣告

2026-11-10。使用者的話:「not pro can play a bit (like some credit limit) / pro and pro plus
can put n songs a month / make a list for score and user can see his or her history /
we can even do a battle for the same vid, maybe at the same time / not pro user could try
this, give them some credit for free / i can ad my web for make $$」

## 意圖

把 /type 從「一個人練打」變成「有成績、有對手、有回訪理由」的功能。
免費會員要摸得到全部玩法(但有額度),付費差別從「能不能玩」改成「玩多少」。

## 目標

1. 每一輪練習留成績;使用者看得到自己的歷史與每首歌的最佳。
2. 每首歌有排行榜。
3. 免費會員每天有 credit:花 1 點可以整首解鎖練一次,或打一場對戰。
4. Pro / Pro Plus 的差別是「一個月能加幾首歌」(現在是一天幾首)。
5. 同一支 MV 的即時對戰:誰先打完這一句,全場一起被推到下一句。
6. 非付費會員看得到廣告位(Pro 不看廣告)。

## 非目標

- 不做防作弊排行榜。成績由前端送上來,後端只做合理性夾擠(見下)。要真的防,
  得把打字判定搬到後端逐鍵驗證,那是另一個專案。排行榜定位是「跟自己和朋友比」。
- 不做配對大廳。對戰靠分享房號/連結,不做隨機配對。
- 不自己做播放器(見 2026-11-10 的決定:YouTube iframe API 已經夠用)。
- 不碰 PayGate 的金額。Pro Plus 的方案與價格要使用者給數字,程式只準備好接。

## 分層(改動後)

| 功能 | guest | free | pro | pro plus |
|---|---|---|---|---|
| 練打 | ✗(只看歌單) | 每首 15 句 | 不限 | 不限 |
| credit/天 | 0 | 2 | 不限 | 不限 |
| 加自己的歌 | 0 | 3 /月 | 30 /月 | 150 /月 |
| 對戰 | ✗ | 花 1 credit | 不限 | 不限 |
| 排行榜 / 歷史 | ✗ | ✓ | ✓ | ✓ |
| 廣告 | 有 | 有 | 無 | 無 |

- 1 credit = 「這一首今天整首解鎖一次」**或**「一場對戰」。同一首同一天重複解鎖不重複扣。
- 自己加的歌照舊整首都能練(牆在「一個月能加幾首」)。

## 怎麼做

### A. 成績與排行榜
- `src/scores.js`:`data/scores/users/<owner>.json`(最近 200 筆,新的在前)、
  `data/scores/songs/<songId>.json`(前 50 名,每人只留最佳)。owner 沿用 `te-<sub>`。
- `POST /api/type/scores` { songId, own, wpm, accuracy, cleared, total, peeked, seconds }
  - 夾擠:wpm ≤ 220、accuracy 0–100、cleared ≥ 3、seconds ≥ cleared × 0.8、cleared ≤ total。
    不合理的整筆丟掉(回 200 但 `recorded: false`,前端不用為此跳錯誤)。
  - 自己加的歌(own)只進個人歷史,不進公開排行榜 —— 別人沒有那首歌。
- `GET /api/type/scores` → 我的歷史 + 每首最佳。`GET /api/type/board?songId=` → 前 20。
- 顯示名字用 LetMeUse 的 `name`;沒有就用 email 遮成 `ab***`。不出 email、不出 sub。

### B. Credit(持久額度)
- `src/ledger.js`:`data/ledger/<owner>.json` = `{ day, month, buckets: { ... } }`。
  跨日/跨月自動歸零。day bucket:`credits`。month bucket:`uploads`。
  (現有的 `createDailyUsage` 是記憶體版,重啟歸零 —— credit 跟上傳額度不能這樣。)
- `POST /api/songs/:id/unlock` → 扣 1 點,回整首。付費牆多一顆「用 1 點解鎖整首」。
- 上傳額度從 `createDailyUsage` 換成 ledger 的 month bucket。

### C. Pro Plus
- `plans.js` 加 `pro_plus`;`paygate.js` 認第二個 plan id(env `PRO_PLUS_PLAN_ID`),
  `/api/subscription/check` 回的 plan 對上就是 pro_plus,否則 pro。
- **要使用者給價格**才建 PayGate 方案。沒設 env 時 pro_plus 不出現在方案頁,
  程式其他地方照常運作。

### D. 對戰
- `src/battle.js`:房間放記憶體(一場幾分鐘,重啟就散,可接受)。
  - `POST /api/battle` { songId } → 房號(6 碼)+ 我的玩家 id
  - `POST /api/battle/:code/join`
  - `GET /api/battle/:code/stream` → SSE:`roster` / `start` / `line` / `progress` / `over`
  - `POST /api/battle/:code/cleared` { line } → 第一個送到的人得 1 分,
    伺服器把房間的行數指標推到下一句並廣播 `line` → 兩邊同時跳(這就是「force next」)。
  - `POST /api/battle/:code/leave`。10 分鐘沒動靜的房間清掉;最多 200 間。
- 規則:全場共用同一個句子指標。沒打完的人會被推走(那一句沒得分),所以是搶分不是各跑各的。
- 進場先扣 credit(free),pro 不扣。

### E. 廣告
- env `ADSENSE_CLIENT` + `ADSENSE_SLOT`。只有非付費看到;只出現在歌單頁底部與成績面板下方,
  **練習進行中不插廣告**。沒設 env 就什麼都不畫。

## 留給實作者的

- 一次只上一個階段(A→B→C→D→E),每段都要 commit + 部署 + 實測。
- 前端改了就跑 ver2 重算 `?v=`(test/cache-bust.test.js 會擋)。
- 歌詞是別人的著作:`data/scores/` 不進版控(比照 `data/songs/`)。

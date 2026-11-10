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

| 等級 | 誰 | 搜尋結果 | 字幕 | 下載 | 聽歌練英打 |
|---|---|---|---|---|---|
| guest | 沒登入 | 前 `FREE_LIMIT` 筆 | 有 | 無 | 無(看得到歌單) |
| free | 登入的免費會員 | 前 `MEMBER_LIMIT` 筆(預設 5) | 有 | 無 | 每首前 15 句;自己貼 3 支/天(自己的不切句數) |
| pro | 付費會員 | 全部 | 有 | 有 | 整首不限;自己貼不限 |

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

## 改了前端檔案一定要重算 ?v=

靜態檔對外是 `Cache-Control: public, max-age=14400`(四小時)。HTML 裡的 `?v=` 不跟著變的話,
程式推上去了,使用者的瀏覽器還抱著舊的 JS 四小時 — **而且完全沒有徵兆**,看起來就是「改了沒反應」。

```
node ../../ver2/bin/ver2.js ./public
```

版本號是檔案內容的 md5 前八碼,內容沒變就不會動。`test/cache-bust.test.js` 會檢查
每個 `?v=` 對不對得上檔案內容,忘了跑就會紅 — 不要靠記性。

> 真的踩過:`type.js` 連改三版都還掛著 `?v=1`,手動維護的版本號也早就對不上
>(`index.html` 寫 `style.css?v=11`,其他頁寫 `?v=10`)。

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

## 聽歌練英打(/type)

會員專屬。挑一首歌,YouTube MV 跟著播,一句一句照著打;那句唱完還沒打完,影片就停在那裡等你,打完才繼續。

- 等級:訪客看得到歌單與 MV,但一句歌詞都拿不到(`src/plans.js` 的 `typing`);免費會員每首前 15 句(`typingLines`);Pro 整首不限。鎖住的句子後端不會送出去,F12 看不到多的
### 玩法:整句都要打,其中一兩個字蓋起來讓你用聽的

**整句每個字都要自己打**(不是只打挖掉的那幾個)。挖空的意思是那一兩個字在畫面上是點點,
你得從歌裡聽出來才打得出來;其餘的字看得到,當提示用。

- 挖哪個字:**伺服器決定**(`src/song-blanks.js`),因為離線字典在那邊 —— 字典的 `level`
  (1 最常用 … 5 少見)就是難度,挖難字才有在學東西。查不到的字(專有名詞、gonna 這種
  口語拼法)當偏難。每句送三個候選,照難度排好
- **同一句歌詞重複出現時換一個字挖**。副歌一首歌出現三四次,每次都挖同一個字的話,
  第二次之後就只是打字練習了
- 挖幾個字:前端的 `autoBlankCount` —— 七個字以下的句子挖一個、十二個字以上挖兩個,
  中間長度的大約三分之一會挖兩個。偶爾來一下才有變化,每句都兩個只是變難
- 控制列可切「自動挖空 → 挖 1 字 → 挖 2 字 → 全挖空」
- 字典沒載入時退回前端自己挑(`pickBlanks`,只看長度和停用詞)
- **大小寫不算錯**:句首大寫、專有名詞、`I` 都是聽不出來的,判錯只是在扣分

### 影片跟著句子走

換句之後影片要不要跳,規則在 `typing-core.js` 的 `needsSeek`:

- 使用者自己點的(點歌詞、上一句/下一句、重聽)→ 一定跳
- 已經播過這一句了(打太慢)→ 倒回句首。不然你在打第 5 句、影片在唱第 8 句,整個練習就散了
- 還沒播到 → 不要動,讓它自然播過去,中間的前奏/間奏照樣聽得到

打字區右上角有「重聽這句」(`.type-replay`),聽不清楚的當下手不用離開打字的地方。

### 答案不能從旁邊漏出去

這個練習唯一的價值是「你得自己聽出來」,所以會給答案的地方都要堵:

- **右欄歌詞**:還沒練到的句子糊掉(`.type-lyrics.hide-answers`),練過的留著當進度。
  不糊的話整首歌的答案就排在旁邊,照抄就好了。要看的話有「看歌詞」鈕
- **YouTube 自己的字幕**:`cc_load_policy=0` 加上載好之後 `unloadModule('captions')`。
  使用者的 YouTube 帳號如果設成「字幕一律開啟」,只靠 playerVars 擋不住 — 字幕會直接
  打在影片上,整句答案就在畫面正中間

- 畫面:左邊播放器 + 打字區 + 成績(WPM/正確率/完成句數),右邊整首歌詞(點一句就跳過去練)。打錯的位置會顯示你實際打的那個字
- 模式:慢速(1x/0.75x/0.5x)、挖幾個字、句末暫停(可關)、中文(這首有翻譯才會出現)、重聽這句、從頭開始
- **鍵盤:Enter 看答案並下一句**(聽不出來的出口,不然影片會一直停在那裡等;答案停 1.6 秒自動往下,再按一次 Enter 馬上走)、Tab 下一句、Shift+Tab 上一句、Esc 重聽這句
- 右欄歌詞:自己打出來的打 ✓,看過答案的打 …
- 練到最後一句出結算:用時、幾句看了答案、WPM、正確率、最常打錯的字
- ⚠️ 收鍵盤的那個 `<input>` 要鋪滿打字區(透明)。縮成 1px 的隱藏框在 Chrome 會把游標卡在位置 0,打出來整句是反的 — 見 `public/type.css` 的註解

### 會員自己貼 YouTube 連結(/type 的「我的歌」)

登入會員可以貼任何 YouTube 連結,伺服器用 yt-dlp 抓英文字幕、清乾淨之後變成一首可以練的歌。

- 存在 `data/songs/users/<owner>/<id>.json`,**只有加的人看得到**(owner 來自 LetMeUse 的 `sub`)
- 自己加的歌**整首都能練,不切句數** — 牆擺在「一天能加幾支」:免費會員 3 支/天,Pro 不限(`src/plans.js` 的 `songUpload`)
- 一個人最多 50 首;同一首再加一次會覆蓋(等於重抓字幕)
- `yt-dlp` 一次只跑一支(同時打太多次 YouTube 會回 429,之後每支都抓不到字幕)
- 失敗原因照實回前端:沒有英文字幕 / 不給嵌入 / 不是 YouTube 連結 / 被 YouTube 擋
- 關掉這個功能:`SONG_IMPORT=0`。yt-dlp 不在 PATH 上用 `YTDLP_PATH` 指完整路徑

兩種自動字幕都處理過(`src/song-import.js` 的 `tidy`):「先半句再整句」會併成完整的一句,
「兩行視窗往上滾」(這一句的尾巴又出現在下一句開頭)會把重疊的部分剪掉 — 不然同一段歌詞要打兩三次。

### 加一首歌到公開歌庫

```
node scripts/import-song.js <YouTube 連結或代號> [--level 中級] [--zh auto]
```

產生 `data/songs/<id>.json`。**這個資料夾不進版控**(歌詞是別人的著作,比照 `data/transcripts/`),所以要在跑站的那台主機上執行;不用重新部署,重開服務就會讀到(部署不會刪掉未進版控的檔案)。

沒給 `--lyrics` 時用 yt-dlp 去抓英文字幕,順便:

- 標題去掉 `[OFFICIAL VIDEO]`、`(Lyric Video)` 這類宣傳標記,`歌手: 歌名` 會拆開(頻道名常常是唱片公司)
- 滾動式自動字幕的半句重複會併回一句;`♪`、`[Music]`、`(汽笛聲)` 這種不是歌詞的拿掉
- 整首大寫的字幕(Believer)轉回正常大小寫 — 照著打要一直按 Shift,練的是小指不是英文
- 不能嵌入播放的影片(`playable_in_embed=False`)直接擋下來,因為在站上根本練不了

其他選項:`--id` `--title` `--artist` 自己指定,`--lyrics <.lrc/.srt/.vtt>` 用現成的歌詞檔(沒有 yt-dlp 時走這條),`--zh <檔案|auto>` 加中文翻譯(按時間重疊對回英文句),`--force` 覆蓋同名的歌。

代號會先用 `src/songs.js` 的同一個規則檢查過才寫檔 — 不然檔案寫出來了、開機時卻被無聲跳過(日文歌名 slug 會空掉)。匯完建議開 `data/songs/<id>.json` 看一下:自動字幕的斷句品質看影片。

### 這一頁「會員專屬」的範圍

鎖的是**歌詞與練習**,不是影片本身:`/api/songs` 不需要登入(歌單要能被看到才有人想登入),所以 `youtubeId` 對訪客是公開的,MV 本來也是 YouTube 上公開的影片。真正擋住的是逐句歌詞 — 鎖住的句子後端不會送出去。

播放器走 `www.youtube-nocookie.com`,訪客沒按播放之前不會被種追蹤 cookie;封面直接用 `i.ytimg.com`。這是站上唯一載入第三方資源的頁面,之後要加 CSP 的話,這頁需要 `script-src/frame-src https://www.youtube.com https://www.youtube-nocookie.com`、`img-src https://i.ytimg.com`。

## 之後再說

- 部署(CloudPipe)時 clipcafe-api 要一起上
- 片語解釋/教學內容區塊(接 LLM)
- 收藏/單字本(要接 LetMeUse 登入)

## 影片學習(/lessons)

- 內容是 ReelScript 引擎已經處理好的影片(逐句中英字幕 + 重點單字),本站只讀、不觸發任何處理,不花錢
- 引擎位置 `LESSON_ENGINE_URL`(同機直連它的後端,例如 `http://127.0.0.1:5005`);影片與縮圖由本站轉送 `/lesson-media/{id}/…`,支援 Range
- 訪客看得到英文字幕、每個字可點查字典;登入後才有中文翻譯與重點片語(`src/plans.js` 的 `lessonNotes`)
- 引擎那邊的資料來源:ReelScript `GET /api/public/videos`、`GET /api/public/videos/{id}/lesson`

// 聽歌練英打 — 進哪一頁。真正的內容在 type-list.js(歌單)與 type-song.js(練習),
// 共用的文案與工具在 type-shared.js。
(function () {
  const { TEXT, params, status } = window.teType

  async function init() {
    try {
      const id = params.get('id')
      const mine = params.get('mine')
      // ?mine= 是自己貼連結加的歌(只有本人看得到),?id= 是公開歌庫
      if (mine) await window.teTypeSong.render(mine, { mine: true })
      else if (id) await window.teTypeSong.render(id)
      else await window.teTypeList.render()
    } catch {
      status(TEXT.error)
    }
  }

  init()
})()

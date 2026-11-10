// 廣告位。只給非付費會員看 —— Pro 的賣點之一就是沒有廣告。
//
// 規矩:只擺在「看完了」的位置(歌單底部、成績面板下面),練習進行中絕對不插。
// 練到一半跳廣告會毀掉整個練習,而且影片內容旁邊插廣告也不是好主意。
(function () {
  const PAID = ['pro', 'pro_plus']
  const SCRIPT = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js'
  let scriptAdded = false

  function loadOnce(client) {
    if (scriptAdded) return
    scriptAdded = true
    const script = document.createElement('script')
    script.async = true
    script.src = `${SCRIPT}?client=${encodeURIComponent(client)}`
    script.crossOrigin = 'anonymous'
    document.head.append(script)
  }

  // tier 不確定(例如還沒問到)就當非付費 —— 訪客占多數,而付費會員的頁面
  // 本來就拿得到自己的 tier
  function render(mount, tier) {
    if (!mount) return null
    const config = (window.teSession.config() || {}).ads
    if (!config || !config.client || !config.slot) return null
    if (PAID.includes(tier)) return null
    loadOnce(config.client)
    const box = document.createElement('div')
    box.className = 'ad-slot'
    const unit = document.createElement('ins')
    unit.className = 'adsbygoogle'
    unit.style.display = 'block'
    unit.dataset.adClient = config.client
    unit.dataset.adSlot = config.slot
    unit.dataset.adFormat = 'auto'
    unit.dataset.fullWidthResponsive = 'true'
    box.append(unit)
    mount.append(box)
    try {
      ;(window.adsbygoogle = window.adsbygoogle || []).push({})
    } catch {
      /* 擋廣告的外掛會讓這行炸掉,那就讓它空著 */
    }
    return box
  }

  window.teAds = { render }
})()

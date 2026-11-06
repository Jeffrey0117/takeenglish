// 看劇區用的登入狀態:載入站台設定、掛上登入元件,給頁面一個簡單的介面。
// (片語搜尋頁的 app.js 有自己的一套,之後可以併成這一份。)
(function () {
  const WAIT_MS = 5000
  const state = { config: null, ready: false }

  function sdk() {
    return window.letmeuse
  }

  async function loadConfig() {
    try {
      const res = await fetch('/api/config')
      const body = await res.json()
      if (body.success) state.config = body.data
    } catch {
      /* 拿不到設定就當沒登入功能 */
    }
    return state.config
  }

  function waitForSdk() {
    return new Promise((resolve) => {
      if (sdk() && sdk().ready) return resolve()
      const check = setInterval(() => {
        if (sdk() && sdk().ready) {
          clearInterval(check)
          resolve()
        }
      }, 100)
      setTimeout(() => {
        clearInterval(check)
        resolve()
      }, WAIT_MS)
    })
  }

  const configReady = loadConfig()

  // 設定好了、登入元件也好了(或等不到)才算 ready
  const ready = configReady.then(async (config) => {
    const lmu = config && config.letmeuse
    if (!lmu || !lmu.appId || !lmu.baseUrl) return
    const script = document.createElement('script')
    script.src = `${lmu.baseUrl}/letmeuse.js`
    script.dataset.appId = lmu.appId
    script.dataset.theme = 'dark'
    script.dataset.accent = '#ffd60a'
    script.dataset.locale = 'zh'
    script.dataset.mode = 'modal'
    document.head.appendChild(script)
    await waitForSdk()
    state.ready = Boolean(sdk() && sdk().ready)
  })

  window.teSession = {
    configReady,
    ready,
    config: () => state.config,
    user: () => (state.ready && sdk().user) || null,
    getToken: () => (state.ready && sdk().user ? sdk().getToken() : null),
    login: () => {
      if (state.ready) sdk().login()
    },
    onChange: (callback) => {
      ready.then(() => {
        if (state.ready) sdk().onAuthChange(callback)
      })
    }
  }
})()

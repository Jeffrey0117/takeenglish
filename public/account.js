// 右上角的會員區:登入 / 名字 + 等級 + 登出。
//
// 片語搜尋頁(app.js)自己有一套,但看劇、影片學習、聽歌練打這三頁原本什麼都沒有 ——
// 登入了也看不出自己是誰、是什麼等級、要從哪裡登出。這一份給那三頁共用。
(function () {
  const TEXT = {
    login: '登入',
    logout: '登出',
    upgrade: '升級 Pro',
    manage: '管理訂閱',
    account: '我的帳號'
  }
  // 等級徽章。免費會員不給徽章,給一顆「升級 Pro」
  const BADGE = { pro: 'PRO', pro_plus: 'PRO+' }

  const el = (tag, className, text) => window.teStudy.el(tag, className, text)

  // 等級只有 /api/me 知道(訂閱帳本在 PayGate)。拿不到就先當免費會員 ——
  // 寧可多畫一顆「升級 Pro」,也不要把付費的人誤標成免費
  async function tierOf() {
    const token = window.teSession.getToken()
    if (!token) return 'guest'
    try {
      const res = await fetch('/api/me', { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } })
      const body = await res.json().catch(() => ({}))
      return (res.ok && body.success && body.data && body.data.tier) || 'free'
    } catch {
      return 'free'
    }
  }

  function render(area, tier) {
    const user = window.teSession.user()
    area.replaceChildren()
    if (!user) {
      const login = el('button', 'auth-btn', TEXT.login)
      login.type = 'button'
      login.onclick = () => window.teSession.login()
      area.append(login)
      return
    }
    if (BADGE[tier]) {
      const badge = el('a', 'pro-badge', BADGE[tier])
      badge.href = '/#plans'
      badge.title = TEXT.manage
      area.append(badge)
    } else if (tier !== 'guest') {
      const upgrade = el('a', 'auth-btn', TEXT.upgrade)
      upgrade.href = '/#plans'
      area.append(upgrade)
    }
    // 名字就是進「我的帳號」的入口
    const name = el('a', 'auth-user', user.name || user.email || '')
    name.href = '/me'
    name.title = TEXT.account
    area.append(name)
    const logout = el('button', 'auth-btn quiet', TEXT.logout)
    logout.type = 'button'
    logout.onclick = () => {
      const sdk = window.letmeuse
      if (sdk && sdk.logout) sdk.logout()
    }
    area.append(logout)
  }

  async function mount() {
    const area = document.querySelector('#auth-head')
    if (!area) return
    await window.teSession.ready
    // 先把名字和登出畫出來(等級慢一步到,不要為了它讓整個右上角空著)
    render(area, 'guest')
    render(area, await tierOf())
    window.teSession.onChange(async () => render(area, await tierOf()))
  }

  mount()
  window.teAccount = { tierOf }
})()

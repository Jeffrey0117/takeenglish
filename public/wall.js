// 撞牆時的升級視窗。影片學習、聽歌練打共用這一份:
// 每個頁面自己決定標題和賣點,按鈕、結帳、登入提示的行為都在這裡。
(function () {
  const TEXT = {
    login: '免費登入',
    upgrade: '升級 Pro',
    price: (price, cycle) => `NT$${Number(price).toLocaleString()} / ${cycle === 'yearly' ? '年' : '月'}`,
    guestHint: '先免費登入,可以多練幾句',
    plans: '看方案',
    working: '前往付款頁…',
    failed: '付款服務暫時連不上,稍後再試'
  }

  const el = (tag, className, text) => window.teStudy.el(tag, className, text)

  function loginButton(label = TEXT.login) {
    const button = el('button', 'auth-btn', label)
    button.type = 'button'
    button.onclick = () => window.teSession.login()
    return button
  }

  // 要付款頁網址。拿到就直接過去;已經是 Pro(409)就重新整理,畫面上的鎖會自己消失
  async function checkout(button, note) {
    button.disabled = true
    note.textContent = TEXT.working
    try {
      const token = window.teSession.getToken()
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: '{}'
      })
      const body = await res.json().catch(() => ({}))
      const url = body.data && body.data.checkoutUrl
      if (res.ok && typeof url === 'string' && /^https?:[/][/]/.test(url)) {
        location.href = url
        return
      }
      if (res.status === 409) {
        location.reload()
        return
      }
    } catch {
      /* 落到下面的錯誤訊息 */
    }
    button.disabled = false
    note.textContent = TEXT.failed
  }

  // 同時只開一個。signedIn=false 的人先推登入(免費的那一步),登入過的才推付款
  // extra = 升級以外的另一條路(例如用 credit 先解鎖這一首)。
  // { label, onClick(button, note) };沒傳就完全不出現
  function show({ signedIn = false, title = '', points = [], count = '', guestHint = TEXT.guestHint, extra = null } = {}) {
    if (document.querySelector('.wall')) return
    const billing = (window.teSession.config() || {}).billing || {}
    const overlay = el('div', 'modal wall')
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    const card = el('div', 'modal-card')
    const close = el('button', 'modal-close', '×')
    close.type = 'button'
    // 視窗關掉要把鍵盤焦點還回去,而且 Esc 要關視窗 —
    // 不接的話焦點還留在底下的打字框,按 Esc 會變成「重聽這句」,影片在視窗後面播起來
    const returnFocus = document.activeElement
    const dismiss = () => {
      overlay.remove()
      document.removeEventListener('keydown', onKey, true)
      if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true })
    }
    function onKey(event) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      dismiss()
    }
    document.addEventListener('keydown', onKey, true)
    close.onclick = dismiss
    overlay.onclick = (event) => {
      if (event.target === overlay) dismiss()
    }
    card.append(close, el('p', 'modal-title', title))
    if (count) card.append(el('p', 'wall-count', count))
    if (billing.enabled && billing.plan) card.append(el('p', 'modal-price', TEXT.price(billing.plan.price, billing.plan.cycle)))
    const list = el('ul', 'modal-list')
    for (const point of points) list.append(el('li', '', point))
    card.append(list)
    const note = el('p', 'modal-note', '')
    card.append(note)
    if (!signedIn) {
      note.textContent = guestHint
      const login = loginButton()
      login.onclick = () => {
        dismiss()
        window.teSession.login()
      }
      const plans = el('a', 'auth-btn quiet', TEXT.plans)
      plans.href = '/#plans'
      card.append(login, plans)
    } else {
      const buy = el('button', 'auth-btn', TEXT.upgrade)
      buy.type = 'button'
      buy.onclick = () => checkout(buy, note)
      card.append(buy)
      if (extra && extra.label) {
        const other = el('button', 'auth-btn quiet', extra.label)
        other.type = 'button'
        other.onclick = () => extra.onClick(other, note)
        card.append(other)
      }
    }
    overlay.append(card)
    document.body.append(overlay)
    close.focus({ preventScroll: true })
  }

  window.teWall = { TEXT, show, checkout, loginButton }
})()

// 聽歌練英打 — YouTube 播放器與「遮住畫面」。
//
// 跟練習引擎分開是因為這一層的麻煩事跟打字無關:iframe API 什麼時候好、
// 這支影片能不能嵌入、YouTube 自己的字幕要關掉、歌詞印在畫面上要遮起來。
(function () {
  const { TEXT, el } = window.teType

  // 遮住畫面要跨首歌、跨分頁記住 — 會用的人每首都想遮。localStorage 壞掉(無痕/擋第三方)不能讓整頁掛掉
  const COVER_KEY = 'te-type-cover'

  function coverPref() {
    try {
      return localStorage.getItem(COVER_KEY) === '1'
    } catch {
      return false
    }
  }

  function setCoverPref(on) {
    try {
      localStorage.setItem(COVER_KEY, on ? '1' : '0')
    } catch {
      /* 記不住就算了,這一次還是遮著 */
    }
  }

  // ---- YouTube 播放器 ----

  let ytLoading = null

  function loadYouTube() {
    if (ytLoading) return ytLoading
    ytLoading = new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) return resolve(window.YT)
      const timer = setTimeout(() => reject(new Error('youtube api timeout')), 12000)
      const previous = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        clearTimeout(timer)
        if (typeof previous === 'function') previous()
        resolve(window.YT)
      }
      const script = document.createElement('script')
      script.src = 'https://www.youtube.com/iframe_api'
      script.onerror = () => {
        clearTimeout(timer)
        reject(new Error('youtube api blocked'))
      }
      document.head.append(script)
    })
    return ytLoading
  }

  function createPlayer(mount, videoId, { onState, onError }) {
    return loadYouTube().then(
      (YT) =>
        new YT.Player(mount, {
          videoId,
          // nocookie 網域:沒播之前不會在訪客瀏覽器種追蹤 cookie
          host: 'https://www.youtube-nocookie.com',
          // cc_load_policy: 0 = 不要預設開字幕。YouTube 自己的字幕會把整句答案
          // 直接打在影片上,那這個練習就沒意義了
          playerVars: { rel: 0, modestbranding: 1, playsinline: 1, cc_load_policy: 0, iv_load_policy: 3, origin: location.origin },
          events: {
            // 使用者的 YouTube 帳號如果把字幕設成「一律開啟」,playerVars 擋不住 — 載好之後再關一次
            onReady: (event) => {
              try {
                event.target.unloadModule('captions')
                event.target.unloadModule('cc')
              } catch {
                /* 這支影片沒有字幕模組就算了 */
              }
            },
            onStateChange: (event) => {
              // 使用者在播放器裡自己按了字幕,或 YouTube 換畫質時把字幕模組載回來 → 每次開始播就再關一次
              if (event.data === 1) {
                try {
                  event.target.unloadModule('captions')
                  event.target.unloadModule('cc')
                } catch {
                  /* 沒有字幕模組就算了 */
                }
              }
              onState(event.data)
            },
            onError: () => onError(new Error('video not embeddable'))
          }
        })
    )
  }

  // 播放器掛上去;掛不起來就在原地說清楚,頁面其他部分照常。
  // ⚠️ 訊息要寫進外框(playerBox),不能寫進 mount:YT.Player 會把 mount 整個換成 iframe,
  // 等 onError 回來時手上那個節點早就不在畫面上了,replaceWith 會無聲無息什麼都沒發生。
  async function mountPlayer(playerBox, mount, song, { onState = () => {} }) {
    const failed = (message) => {
      const note = el('p', 'study-note', message)
      const link = el('a', 'auth-btn quiet', 'YouTube')
      link.href = `https://www.youtube.com/watch?v=${song.youtubeId}`
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      note.append(' ', link)
      playerBox.classList.add('failed')
      playerBox.replaceChildren(note)
      return null
    }
    try {
      return await createPlayer(mount, song.youtubeId, {
        onState,
        onError: () => failed(TEXT.playerBlocked)
      })
    } catch {
      return failed(TEXT.playerFailed)
    }
  }

  window.teTypePlayer = { coverPref, setCoverPref, mountPlayer }
})()

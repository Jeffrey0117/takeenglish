const createPaywall = require('paywall-kit')

const UNLIMITED = -1

// 0 或沒設 = 不限筆數(沿用原本 FREE_LIMIT=0 代表不擋的意思)
function toQuota(limit) {
  return Number.isInteger(limit) && limit > 0 ? limit : UNLIMITED
}

// 會員等級的單一來源。後端用它擋功能,前端從 /api/config 拿同一份來畫畫面。
//   guest: 沒登入
//   free : 登入的免費會員
//   pro  : 付費會員(價格以 PayGate 的方案為準,這裡不寫金額)
// 之後要加付費功能,在 features 加一個欄位、後端用 can() 擋就好。
//
// 數字型的功能是額度:study = 每天可以逐句解析幾支片段,studyEpisodes = 看劇區前幾集開放解析。
// lessonLines = 影片學習的逐字稿露出幾句;lessonModes = 學習模式(單句重複、慢速、聽寫、重點整理)
function createPlans({
  guestLimit = 3,
  memberLimit = 0,
  studyPerDay = 3,
  freeEpisodes = 3,
  guestLessonLines = 5,
  memberLessonLines = 10
} = {}) {
  const paywall = createPaywall({
    tiers: [
      {
        id: 'guest',
        name: '訪客',
        price: 0,
        features: { results: toQuota(guestLimit), subtitles: true, download: false, study: 0, studyEpisodes: freeEpisodes, lessonNotes: false, lessonLines: guestLessonLines, lessonModes: false }
      },
      {
        id: 'free',
        name: '免費會員',
        price: 0,
        features: {
          results: toQuota(memberLimit),
          subtitles: true,
          download: false,
          study: studyPerDay,
          studyEpisodes: freeEpisodes,
          lessonNotes: true,
          lessonLines: memberLessonLines,
          lessonModes: false
        }
      },
      {
        id: 'pro',
        name: 'Pro',
        price: 0,
        features: { results: UNLIMITED, subtitles: true, download: true, study: UNLIMITED, studyEpisodes: UNLIMITED, lessonNotes: true, lessonLines: UNLIMITED, lessonModes: true }
      }
    ]
  })

  // 這個等級某項額度是多少;null = 不限,0 = 沒有
  function quota(tier, feature) {
    const limit = paywall.tier(tier).features[feature]
    return limit === UNLIMITED ? null : limit
  }

  // 這個等級一次搜尋最多看幾筆;null = 不限
  function resultLimit(tier) {
    return quota(tier, 'results')
  }

  function summary() {
    return paywall.allTiers().map((tier) => ({
      id: tier.id,
      name: tier.name,
      features: {
        ...tier.features,
        results: resultLimit(tier.id),
        study: quota(tier.id, 'study'),
        studyEpisodes: quota(tier.id, 'studyEpisodes'),
        lessonLines: quota(tier.id, 'lessonLines')
      }
    }))
  }

  return { can: paywall.can, quota, resultLimit, summary }
}

module.exports = { createPlans }

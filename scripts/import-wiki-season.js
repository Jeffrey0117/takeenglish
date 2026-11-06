#!/usr/bin/env node
// 從 Wikipedia 匯入一季的集數資料(英文頁 + 中文頁),寫成 data/shows/<劇>/season-<季>.json
//
// 用法:
//   node scripts/import-wiki-season.js <show-id> <季> "<英文頁標題>" "<中文頁標題>" "<英文劇名>" "<中文劇名>"
// 例:
//   node scripts/import-wiki-season.js brooklyn-nine-nine 5 \
//     "Brooklyn Nine-Nine season 5" "荒唐分局 (第五季)" "Brooklyn Nine-Nine" "荒唐分局"
//
// 內容採 CC BY-SA 4.0,頁面上必須標示來源(看劇區頁尾已經有)。

const fs = require('node:fs')
const path = require('node:path')
const { buildSeason } = require('../src/wiki-import')

// Wikipedia 要求自動化程式用看得出是誰的 User-Agent
const USER_AGENT = 'takeENGLISH-importer/0.1 (https://phrase.pipee.tw)'
const SHOW_ID_PATTERN = /^[a-z0-9-]{1,80}$/

async function fetchPage(lang, title) {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`)
  url.search = new URLSearchParams({
    action: 'parse',
    page: title,
    prop: 'wikitext|revid',
    format: 'json',
    formatversion: '2',
    redirects: '1'
  }).toString()
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(20000)
  })
  if (!res.ok) throw new Error(`${lang}.wikipedia.org responded with ${res.status} for "${title}"`)
  const body = await res.json()
  if (!body.parse || typeof body.parse.wikitext !== 'string') {
    throw new Error(`${lang}.wikipedia.org has no page "${title}"`)
  }
  return { title: body.parse.title, revision: body.parse.revid || null, wikitext: body.parse.wikitext }
}

async function main() {
  const [showId, seasonArg, enTitle, zhTitle, enName, zhName] = process.argv.slice(2)
  const season = Number.parseInt(seasonArg, 10)
  if (!SHOW_ID_PATTERN.test(showId || '') || !Number.isInteger(season) || !enTitle || !zhTitle) {
    process.stderr.write('usage: import-wiki-season.js <show-id> <season> "<en page>" "<zh page>" "<en name>" "<zh name>"\n')
    process.exit(2)
  }

  const [en, zh] = await Promise.all([fetchPage('en', enTitle), fetchPage('zh', zhTitle)])
  const data = buildSeason({
    show: { id: showId, title: { en: enName || enTitle, zh: zhName || zhTitle } },
    season,
    en,
    zh,
    fetchedAt: new Date().toISOString().slice(0, 10)
  })
  if (data.episodes.length === 0) throw new Error('no episodes found on the English page')

  const dir = path.join(__dirname, '..', 'data', 'shows', showId)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `season-${season}.json`)
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)

  const missingZh = data.episodes.filter((ep) => !ep.summary.zh).map((ep) => ep.number)
  process.stdout.write(`wrote ${file}\n`)
  process.stdout.write(`episodes: ${data.episodes.length}; without a Chinese summary: ${missingZh.join(', ') || 'none'}\n`)
}

main().catch((err) => {
  process.stderr.write(`import failed: ${err.message}\n`)
  process.exit(1)
})

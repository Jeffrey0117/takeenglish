// 把 Wikipedia 季頁面的 wikitext 轉成看劇區要的資料。這裡全是純函式,抓網頁的部分在 scripts/。

// 從 start(指向 "{{")開始,找到成對的 "}}" 結束位置(不含)。找不到回 -1
function matchBraces(text, start) {
  let depth = 0
  for (let i = start; i < text.length - 1; i += 1) {
    const pair = text.slice(i, i + 2)
    if (pair === '{{') {
      depth += 1
      i += 1
    } else if (pair === '}}') {
      depth -= 1
      i += 1
      if (depth === 0) return i + 1
    }
  }
  return -1
}

// 取出所有名稱以 prefix 開頭的模板全文,例如 "Episode list"
function extractTemplates(text, prefix) {
  const found = []
  const needle = `{{${prefix}`
  let from = 0
  for (;;) {
    const start = text.indexOf(needle, from)
    if (start === -1) return found
    const end = matchBraces(text, start)
    if (end === -1) return found
    found.push(text.slice(start, end))
    from = end
  }
}

// 以最外層的 "|" 切開模板內容(巢狀的 {{ }} 和 [[ ]] 裡面的 | 不算)
function splitTopLevel(body) {
  const parts = []
  let depth = 0
  let current = ''
  for (let i = 0; i < body.length; i += 1) {
    const pair = body.slice(i, i + 2)
    if (pair === '{{' || pair === '[[') {
      depth += 1
      current += pair
      i += 1
    } else if (pair === '}}' || pair === ']]') {
      depth -= 1
      current += pair
      i += 1
    } else if (body[i] === '|' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += body[i]
    }
  }
  parts.push(current)
  return parts
}

// 模板 → { 欄位名: 原始值 }
function templateFields(template) {
  const fields = {}
  for (const part of splitTopLevel(template.slice(2, -2)).slice(1)) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const name = part.slice(0, eq).trim()
    if (/^[A-Za-z0-9_ ]+$/.test(name)) fields[name] = part.slice(eq + 1).trim()
  }
  return fields
}

function pad(value) {
  return String(value).padStart(2, '0')
}

// {{Start date|2017|9|26}} → 2017-09-26
function parseDate(raw) {
  const m = /\{\{\s*(?:Start|End) date\s*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})/i.exec(raw || '')
  return m ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : ''
}

// 中文維基的字詞轉換標記:-{傑克}- → 傑克;-{zh-tw:甲;zh-cn:乙}- → 甲
function resolveVariants(text) {
  return text.replace(/-\{([^{}]*)\}-/g, (_, inner) => {
    if (!inner.includes(':')) return inner
    const rules = Object.fromEntries(
      inner
        .split(';')
        .map((rule) => rule.split(':'))
        .filter((pair) => pair.length === 2)
        .map(([key, value]) => [key.trim().toLowerCase(), value.trim()])
    )
    return rules['zh-tw'] || rules['zh-hant'] || rules['zh-hk'] || Object.values(rules)[0] || ''
  })
}

// 把還留著的模板換成它要顯示的字;不認得的整個拿掉(由內而外,處理巢狀)
function replaceTemplates(text) {
  let out = text
  for (let guard = 0; guard < 50; guard += 1) {
    const next = out.replace(/\{\{([^{}]*)\}\}/g, (_, inner) => {
      const parts = inner.split('|').map((part) => part.trim())
      const name = parts[0].toLowerCase()
      if (name === 'le' || name === 'link-en' || name === 'tsl') return parts[1] || ''
      if (name === 'lang') return parts[2] || ''
      if (name === 'nowrap' || name === 'nobr') return parts.slice(1).join('|')
      return ''
    })
    if (next === out) return out
    out = next
  }
  return out
}

// wikitext → 給人看的純文字
function cleanWikitext(raw) {
  let text = String(raw || '')
  text = text.replace(/<!--[\s\S]*?-->/g, '')
  text = text.replace(/<ref[^>]*\/>/gi, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
  text = resolveVariants(text)
  text = replaceTemplates(text)
  // [[檔案:…]] 這類不是文字;[[A|B]] 顯示 B;[[A]] 顯示 A
  text = text.replace(/\[\[(?:File|Image|檔案|文件|Category|分類)\s*:[^\]]*\]\]/gi, '')
  text = text.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
  text = text.replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, '$1').replace(/\[https?:\/\/\S+\]/g, '')
  text = text.replace(/'{2,}/g, '')
  text = text.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
  text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  // 模板拿掉之後可能留下空括號,例如「第五季()由…」
  text = text.replace(/[(（]\s*[)）]/g, '')
  return text.replace(/[ \t\r\n]+/g, ' ').trim()
}

// 中文版劇情後面用 <hr/> 接著演員表,只取劇情
function splitSummary(raw) {
  const [summary, ...rest] = String(raw || '').split(/<hr\s*\/?>/i)
  return { summary: cleanWikitext(summary), credits: cleanWikitext(rest.join(' ')) }
}

// 中文標題的註腳常寫「Netflix翻譯為「監獄(一)」」,抓出來當第二個譯名
function netflixTitle(rawTitle) {
  const m = /Netflix[^「」]{0,12}「([^」]+)」/.exec(rawTitle || '')
  return m ? m[1].trim() : ''
}

function parseEpisodes(wikitext) {
  return extractTemplates(wikitext, 'Episode list')
    .map(templateFields)
    .filter((fields) => /^\d+$/.test(fields.EpisodeNumber2 || ''))
    .map((fields) => {
      const { summary, credits } = splitSummary(fields.ShortSummary)
      return {
        number: Number(fields.EpisodeNumber2),
        overall: Number(fields.EpisodeNumber) || null,
        code: cleanWikitext(fields.ProdCode),
        airDate: parseDate(fields.OriginalAirDate),
        title: cleanWikitext(fields.Title).replace(/^"|"$/g, ''),
        altTitle: cleanWikitext(fields.AltTitle),
        netflixTitle: netflixTitle(fields.Title),
        directedBy: cleanWikitext(fields.DirectedBy),
        writtenBy: cleanWikitext(fields.WrittenBy),
        summary,
        credits
      }
    })
}

// 頁首第一段介紹:跳過最前面的模板(資訊框等),取到第一個 == 標題 == 之前
function parseIntro(wikitext) {
  let rest = wikitext.trimStart()
  while (rest.startsWith('{{')) {
    const end = matchBraces(rest, 0)
    if (end === -1) break
    rest = rest.slice(end).trimStart()
  }
  const heading = rest.search(/\n==/)
  const lead = heading === -1 ? rest : rest.slice(0, heading)
  return cleanWikitext(lead.split(/\n\s*\n/)[0])
}

// 合併英文頁與中文頁(以季內集數對齊),產出看劇區的資料
function buildSeason({ show, season, en, zh, fetchedAt }) {
  const zhByNumber = new Map(parseEpisodes(zh.wikitext).map((ep) => [ep.number, ep]))
  const episodes = parseEpisodes(en.wikitext).map((ep) => {
    const z = zhByNumber.get(ep.number) || {}
    return {
      number: ep.number,
      overall: ep.overall,
      code: ep.code,
      airDate: ep.airDate,
      title: { en: ep.title, zh: z.title || '', zhNetflix: z.netflixTitle || '' },
      summary: { en: ep.summary, zh: z.summary || '' },
      directedBy: { en: ep.directedBy, zh: z.directedBy || '' },
      writtenBy: { en: ep.writtenBy, zh: z.writtenBy || '' }
    }
  })
  const source = (page, lang) => ({
    title: page.title,
    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
    revision: page.revision || null
  })
  return {
    show,
    season,
    intro: { en: parseIntro(en.wikitext), zh: parseIntro(zh.wikitext) },
    episodes,
    source: {
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      fetchedAt,
      en: source(en, 'en'),
      zh: source(zh, 'zh')
    }
  }
}

module.exports = {
  extractTemplates,
  templateFields,
  cleanWikitext,
  parseDate,
  parseEpisodes,
  parseIntro,
  netflixTitle,
  buildSeason
}

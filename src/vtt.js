const TIME_PATTERN = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/
const MAX_CUES = 5000

function toSeconds(stamp) {
  const m = TIME_PATTERN.exec(stamp || '')
  if (!m) return null
  const [, h, min, sec, ms] = m
  return Number(h || 0) * 3600 + Number(min) * 60 + Number(sec) + Number(ms.padEnd(3, '0')) / 1000
}

// 字幕文字:拿掉 <i>、<c.yellow> 這類標籤與位置設定,多行併成一行
function cleanCueText(lines) {
  return lines
    .join(' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

// WebVTT 與 SRT 都吃:以空行分段,每段找有 "-->" 的那一行當時間,後面的是文字。
// 回 [{ start, end, text }](秒);沒有文字或時間不對的段落跳過。
function parseCues(source) {
  const cues = []
  const blocks = String(source || '').replace(/^﻿/, '').replace(/\r/g, '').split(/\n{2,}/)
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
    const timing = lines.findIndex((line) => line.includes('-->'))
    if (timing === -1) continue
    const [from, to] = lines[timing].split('-->')
    const start = toSeconds(from)
    const end = toSeconds(to)
    const text = cleanCueText(lines.slice(timing + 1))
    if (start === null || end === null || end < start || !text) continue
    cues.push({ start, end, text })
    if (cues.length >= MAX_CUES) break
  }
  return cues
}

const SENTENCE_END = /[.!?…♪]["')\]]*$/
const MAX_GROUP_CHARS = 240
const MAX_GROUP_GAP_SECONDS = 2.5

// 字幕常把一句話切成好幾行(「I think we should」/「go now.」)。
// 拿半句去翻譯和解析會很差,所以先併回完整的句子:
// 一直併到句尾標點為止;太長、或兩行之間停頓太久就先斷開。
function groupCues(cues) {
  const groups = []
  let current = null
  for (const cue of cues) {
    const tooFar = current && cue.start - current.end > MAX_GROUP_GAP_SECONDS
    const tooLong = current && current.text.length + cue.text.length + 1 > MAX_GROUP_CHARS
    if (current && !tooFar && !tooLong) {
      current = { start: current.start, end: cue.end, text: `${current.text} ${cue.text}` }
    } else {
      if (current) groups.push(current)
      current = { ...cue }
    }
    if (SENTENCE_END.test(current.text)) {
      groups.push(current)
      current = null
    }
  }
  if (current) groups.push(current)
  return groups
}

// 一段文章切成句子(劇情介紹用):以句號、問號、驚嘆號收尾,引號括號跟著前一句
function splitSentences(text) {
  const parts = String(text || '').match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) || []
  return parts.map((part) => part.trim()).filter((part) => part.length > 1)
}

module.exports = { parseCues, groupCues, splitSentences }

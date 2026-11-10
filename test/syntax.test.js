const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')

// server.js 和前端的 public/*.js 沒有其他測試會載入,語法壞掉要到部署才爆 — 這裡先擋
function sourceFiles() {
  const inDir = (dir) =>
    fs
      .readdirSync(path.join(ROOT, dir))
      .filter((name) => name.endsWith('.js'))
      .map((name) => path.join(dir, name))
  return ['server.js', ...inDir('public'), ...inDir('src')]
}

for (const file of sourceFiles()) {
  test(`${file} parses`, () => {
    assert.doesNotThrow(() =>
      execFileSync(process.execPath, ['--check', path.join(ROOT, file)], {
        stdio: 'pipe',
        windowsHide: true
      })
    )
  })
}

test('no source file has a string literal broken across lines by a stray newline', () => {
  for (const file of sourceFiles()) {
    const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/)
    const broken = lines.findIndex((line) => /^[`'"]\)$/.test(line.trim()))
    assert.strictEqual(broken, -1, `${file}:${broken + 1} looks like a log line split by a raw newline`)
  }
})

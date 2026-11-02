// The view in real browsers (Chromium, WebKit): layout, fonts, keys, input
// methods, the mouse and the clipboard are what jsdom does not model. Serves
// the package, drives tests/browser/page.html with Playwright.
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { chromium, webkit } from 'playwright'

const root = join(import.meta.dirname, '..')
const output = join(root, 'tests/browser/output')
mkdirSync(output, { recursive: true })
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json' }
const server = createServer((req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (!path.startsWith(root) || !existsSync(path)) return void res.writeHead(404).end()
  res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(readFileSync(path))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/tests/browser/page.html`
const session = (name) => JSON.parse(readFileSync(join(root, 'tests/fixtures/sessions', `${name}.json`), 'utf8'))

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed++
}

for (const [name, type] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await type.launch()
  const page = await browser.newPage({ viewport: { width: 920, height: 560 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  try {
    await page.goto(base)
    await page.waitForFunction(() => window.ready)
    await page.waitForTimeout(100)
    const size = await page.evaluate(() => [window.term.cols, window.term.rows])
    check(`${name}: the box gives the size`, size[0] > 90 && size[0] < 115 && size[1] > 25 && size[1] < 35, size.join('×'))
    check(`${name}: the host is told the size`, (await page.evaluate(() => window.resized.at(-1)?.join('×'))) === size.join('×'))

    // A real program's screen: vim, at the size it was recorded.
    const vim = session('vim')
    await page.evaluate(({ cols, rows, chunks }) => {
      window.term.resize(cols, rows)
      // Up to before it quits: its own screen, split in two.
      for (const c of chunks.slice(0, -4)) window.term.write(c)
    }, vim)
    await page.waitForTimeout(150)
    const rows = await page.locator('.dsk-term-row').count()
    // The box holds fewer rows than vim was recorded with: the rows in view, not all of them.
    check(`${name}: only the rows in view are in the page`, rows >= Math.min(size[1], vim.rows) && rows <= size[1] + 2, String(rows))
    await page.screenshot({ path: join(output, `${name}-vim.png`) })
    await page.evaluate(() => window.view.fit())

    // Keys: text through the input field, keys as sequences.
    await page.evaluate(() => {
      window.term.reset()
      window.sent.length = 0
    })
    await page.locator('.dsk-term').click()
    await page.keyboard.type('ls -la')
    await page.keyboard.press('Enter')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Control+c')
    await page.keyboard.press('Tab')
    const sent = await page.evaluate(() => window.sent.join(''))
    check(`${name}: typing, Enter, an arrow, Ctrl+C, Tab`, sent === 'ls -la\r\x1b[A\x03\t', JSON.stringify(sent))
    await page.evaluate(() => window.term.write('\x1b[?1h'))
    await page.keyboard.press('ArrowDown')
    check(`${name}: the application cursor mode`, (await page.evaluate(() => window.sent.at(-1))) === '\x1bOB')

    // Scrollback: scrolled up, new output does not pull the view down.
    await page.evaluate(() => {
      window.term.reset()
      window.term.write(Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\r\n'))
    })
    await page.waitForTimeout(100)
    const last = await page.locator('.dsk-term-row').last().textContent()
    check(`${name}: at the bottom after output`, last?.trim() === 'line 299', last ?? '')
    // Scrolled to the bottom, the top row is whole, not cut by the edge.
    const edge = await page.evaluate(() => {
      const box = document.querySelector('.dsk-term').getBoundingClientRect()
      const rows = [...document.querySelectorAll('.dsk-term-row')].map((r) => r.getBoundingClientRect()).filter((r) => r.bottom > box.top)
      return rows[0].top - box.top
    })
    check(`${name}: the top row is whole at the bottom`, edge >= 0, String(edge))
    await page.locator('.dsk-term').evaluate((el) => (el.scrollTop = 0))
    await page.waitForTimeout(100)
    check(`${name}: scrolled to the top: the first lines`, (await page.locator('.dsk-term-row').first().textContent())?.trim() === 'line 0')
    await page.evaluate(() => window.term.write('\r\nmore'))
    await page.waitForTimeout(100)
    check(`${name}: new output leaves the view where it is`, (await page.locator('.dsk-term-row').first().textContent())?.trim() === 'line 0')

    // Selection with the mouse, copied as text.
    await page.evaluate(() => {
      window.term.reset()
      window.term.write('hello world\r\nsecond line')
      window.view.scrollToBottom()
    })
    await page.waitForTimeout(100)
    const row0 = page.locator('.dsk-term-row').nth(0)
    const box = await row0.boundingBox()
    const cw = await page.evaluate(() => window.view['cellW'])
    await page.mouse.move(box.x + 1, box.y + 5)
    await page.mouse.down()
    await page.mouse.move(box.x + cw * 4 + 2, box.y + 28)
    await page.mouse.up()
    check(`${name}: a selection across rows`, (await page.evaluate(() => window.view.getSelection())) === 'hello world\nseco', JSON.stringify(await page.evaluate(() => window.view.getSelection())))
    await page.mouse.dblclick(box.x + cw * 7.5, box.y + 5)
    check(`${name}: a word by a double click`, (await page.evaluate(() => window.view.getSelection())) === 'world')

    // Pasting: bracketed when asked.
    await page.evaluate(() => {
      window.term.write('\x1b[?2004h')
      window.sent.length = 0
      window.term.paste('a\nb')
    })
    check(`${name}: bracketed paste`, (await page.evaluate(() => window.sent.join(''))) === '\x1b[200~a\rb\x1b[201~')

    // The mouse for a program that asks.
    await page.evaluate(() => {
      window.term.reset()
      window.term.write('\x1b[?1000h\x1b[?1006h')
      window.sent.length = 0
    })
    await page.mouse.click(box.x + cw * 2 + 2, box.y + 5)
    check(`${name}: a click reported in SGR`, (await page.evaluate(() => window.sent.join(''))) === '\x1b[<0;3;1M\x1b[<0;3;1m', JSON.stringify(await page.evaluate(() => window.sent.join(''))))

    // Wide characters: in boxes of two cells.
    await page.evaluate(() => {
      window.term.reset()
      window.term.write('中文|ab\r\n\x1b[31mred\x1b[0m https://example.com/x ok')
    })
    await page.waitForTimeout(100)
    const wide = await page.locator('.dsk-term-wide').first().boundingBox()
    check(`${name}: a wide character takes two cells`, Math.abs(wide.width - cw * 2) < 0.5, `${wide.width} vs ${cw * 2}`)
    const red = await page.locator('.dsk-term-row').nth(1).locator('span').first().evaluate((el) => getComputedStyle(el).color)
    check(`${name}: colours`, red === 'rgb(207, 34, 46)', red)
    // A link: Cmd+click on a Mac, Ctrl+click elsewhere (the view goes by the system) hands it to the host.
    await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control')
    await page.locator('.dsk-term-link').click()
    await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control')
    check(`${name}: a link opened by the host`, (await page.evaluate(() => window.links[0])) === 'https://example.com/x')

    // Shell integration: a mark beside each command, by how it ended; Cmd+click a path.
    await page.evaluate(() => {
      window.term.reset()
      window.links.length = 0
      const A = '\x1b]133;A\x07', B = '\x1b]133;B\x07', C = '\x1b]133;C\x07', D = (c) => `\x1b]133;D;${c}\x07`, E = (t) => `\x1b]633;E;${t}\x07`
      window.term.write(`${A}$ ${B}make\r\n${E('make')}${C}src/main.ts:12 error\r\nmore\r\n${D(2)}${A}$ ${B}ls\r\n${E('ls')}${C}a b\r\n${D(0)}${A}$ ${B}sleep 9\r\n${E('sleep 9')}${C}`)
      window.view.scrollToBottom()
    })
    await page.waitForTimeout(150)
    const marks = await page.locator('.dsk-term-mark').evaluateAll((els) => els.map((e) => e.className.replace('dsk-term-mark ', '') + ':' + e.title))
    check(`${name}: a mark for each command, by how it ended`, marks.length === 3 && marks[0].startsWith('fail:make · exit 2') && marks[1].startsWith('ok:ls · exit 0') && marks[2].startsWith('running:sleep 9'), JSON.stringify(marks))
    await page.locator('.dsk-term-mark.fail').click()
    check(`${name}: a click on a mark selects the command's output`, (await page.evaluate(() => window.view.getSelection())) === 'src/main.ts:12 error\nmore', JSON.stringify(await page.evaluate(() => window.view.getSelection())))
    await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control')
    await page.locator('.dsk-term-link', { hasText: 'src/main.ts:12' }).click()
    await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control')
    check(`${name}: a path link handed to the host`, (await page.evaluate(() => window.links[0])) === 'path:src/main.ts:12')
    // Find in the buffer: every match marked, one current.
    const n = await page.evaluate(() => window.view.find(/e/i))
    await page.evaluate(() => window.view.showMatch(1))
    await page.waitForTimeout(100)
    check(`${name}: find marks the matches`, n >= 4 && (await page.locator('.dsk-term-match').count()) === n && (await page.locator('.dsk-term-match.current').count()) === 1, String(n))
    await page.evaluate(() => window.view.clearFind())
    // From command to command; then clear, the prompt kept.
    await page.evaluate(() => {
      window.term.write('\r\n' + Array.from({ length: 80 }, (_, i) => `out ${i}`).join('\r\n'))
      window.view.scrollToBottom()
    })
    await page.waitForTimeout(100)
    const moved = await page.evaluate(() => window.view.scrollToCommand(-1))
    await page.waitForTimeout(100)
    check(`${name}: to the previous command`, moved && (await page.locator('.dsk-term-row').first().textContent()).startsWith('$ sleep 9'), await page.locator('.dsk-term-row').first().textContent())
    await page.evaluate(() => window.view.clear())
    await page.waitForTimeout(100)
    check(`${name}: clear keeps the prompt row`, (await page.evaluate(() => window.term.buffer.lines.length)) === (await page.evaluate(() => window.term.rows)) && (await page.locator('.dsk-term-row').first().textContent()).startsWith('out 79'))

    // A real full-screen program in the dark theme.
    await page.goto(base + '?dark')
    await page.waitForFunction(() => window.ready)
    const htop = session('htop')
    // After a long output: the full-screen program hides the cursor; its screen is still the one in view.
    await page.evaluate(() => window.term.write(Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\r\n')))
    await page.waitForTimeout(100)
    await page.evaluate(({ chunks }) => {
      for (const c of chunks.slice(0, -2)) window.term.write(c)
    }, htop)
    await page.waitForTimeout(150)
    const scroll = await page.locator('.dsk-term').evaluate((el) => [el.scrollTop, el.scrollHeight, el.clientHeight])
    check(`${name}: a full-screen program after long output: its screen in view`, scroll[1] <= scroll[2] + 2 && (await page.locator('.dsk-term-row', { hasText: 'F1Help' }).isVisible()), scroll.join(','))
    await page.screenshot({ path: join(output, `${name}-htop-dark.png`) })
    check(`${name}: no errors`, errors.length === 0, errors.join('; '))
  } catch (e) {
    check(`${name}: ran to the end`, false, String(e).split('\n')[0])
  } finally {
    await browser.close()
  }
}
server.close()
if (failed) {
  console.log(`${failed} failed`)
  process.exit(1)
}
console.log('all checks passed')

// Records sessions of real programs as test fixtures: each run under a
// pseudo-terminal of a fixed size, the keys sent with pauses, everything the
// program wrote kept in the pieces it came in. The terminal answers the
// program's questions (where is the cursor, what are you) as it will in use.
//
//   NODE_PTY=/path/to/node_modules/node-pty node scripts/record.mjs [name…]
//
// node-pty is not a dependency of the package: it is only needed to record.
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Terminal } from '../dist/index.mjs'

const require = createRequire(import.meta.url)
const pty = require(process.env.NODE_PTY ?? 'node-pty')
const out = join(import.meta.dirname, '..', 'tests', 'fixtures', 'sessions')
mkdirSync(out, { recursive: true })

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const ESC = '\x1b'

/** name: [command, args, keys as [pause ms, text], cols, rows] */
const SESSIONS = {
  'ls-color': ['/bin/ls', ['-laG', '/usr/bin'], [], 100, 30],
  'git-log-graph': ['git', ['-C', join(import.meta.dirname, '..', '..', 'syntax'), 'log', '--graph', '--oneline', '--decorate', '--color=always', '--all', '-40'], [], 100, 30],
  vim: ['/usr/bin/vim', ['-u', 'NONE', '-N', '+syntax on', '+set number', join(import.meta.dirname, '..', 'src', 'parser.ts')], [[800, ''], [200, '20G'], [200, 'ostart typing here'], [200, ESC], [300, ':vsplit\r'], [300, ':set nonumber\r'], [300, ESC + ':qa!\r']], 100, 30],
  less: ['/usr/bin/less', ['-R', join(import.meta.dirname, '..', 'src', 'terminal.ts')], [[600, ''], [200, ' '], [200, ' '], [200, '/scroll\r'], [300, 'n'], [300, 'q']], 90, 25],
  // Only this script's own process: a list of everything running on the machine is not a fixture to publish.
  top: ['/usr/bin/top', ['-pid', String(process.pid), '-o', 'cpu'], [[1600, ''], [200, 'q']], 120, 35],
  htop: ['/opt/homebrew/bin/htop', ['-p', String(process.pid)], [[1500, ''], [300, '\x1b[B\x1b[B'], [300, 'q']], 120, 35],
  mc: ['/opt/homebrew/bin/mc', ['--nosubshell', join(import.meta.dirname, '..'), join(import.meta.dirname, '..', 'src')], [[1500, ''], [300, '\x1b[B\x1b[B'], [300, '\t'], [300, '\x1b0'], [400, 'y']], 120, 35],
  nano: ['/usr/bin/nano', [join(import.meta.dirname, '..', 'README.md')], [[800, ''], [200, 'typed in nano'], [300, '\x18'], [300, 'n']], 90, 25],
  python: ['python3', ['-q'], [[800, ''], [200, 'print("\\u4e2d\\u6587 " * 20)\r'], [300, 'for i in range(5): print(i, "x" * i * 30)\r\r'], [300, 'exit()\r']], 80, 24],
  'man-ls': ['/usr/bin/man', ['ls'], [[1200, ''], [200, ' '], [300, 'q']], 90, 30],
}

async function record(name, [cmd, args, keys, cols, rows]) {
  const term = new Terminal({ cols, rows })
  const p = pty.spawn(cmd, args, { name: 'xterm-256color', cols, rows, cwd: process.env.HOME, env: { ...process.env, TERM: 'xterm-256color', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', PAGER: 'less', MANPAGER: 'less -R' } })
  const chunks = []
  p.onData((d) => {
    chunks.push(d)
    term.write(d)
  })
  // The terminal's answers go back to the program, as in use.
  term.onData((d) => p.write(d))
  for (const [pause, text] of keys) {
    await wait(pause)
    if (text) p.write(text)
  }
  await wait(keys.length ? 600 : 1200)
  try {
    p.kill()
  } catch {
    /* gone already */
  }
  await wait(100)
  writeFileSync(join(out, `${name}.json`), JSON.stringify({ cols, rows, chunks }))
  console.log(`${name}: ${chunks.length} pieces, ${chunks.join('').length} characters`)
}

const names = process.argv.slice(2)
for (const [name, s] of Object.entries(SESSIONS)) if (names.length === 0 || names.includes(name)) await record(name, s)

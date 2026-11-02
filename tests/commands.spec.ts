import { describe, expect, it } from 'vitest'
import { Terminal } from '../src/terminal'

const A = '\x1b]133;A\x07'
const B = '\x1b]133;B\x07'
const C = '\x1b]133;C\x07'
const D = (code: number) => `\x1b]133;D;${code}\x07`
const E = (text: string) => `\x1b]633;E;${text}\x07`

/** A shell's session as shell integration writes it. */
function session(term: Terminal, runs: [string, string, number][]): void {
  for (const [cmd, out, code] of runs) {
    term.write(`${A}$ ${B}${cmd}\r\n${E(cmd)}${C}${out}${D(code)}`)
  }
  term.write(`${A}$ ${B}`)
}

describe('commands from shell integration', () => {
  it('each command: prompt, input, output, end, exit code, text, times', () => {
    const term = new Terminal({ cols: 40, rows: 10 })
    const seen: string[] = []
    term.onCommand((c) => seen.push(c.text ?? ''))
    session(term, [
      ['ls', 'a\r\nb\r\n', 0],
      ['false', '', 1],
    ])
    expect(term.commands).toHaveLength(3)
    const [ls, f, open] = term.commands
    expect(ls).toMatchObject({ prompt: 0, input: 0, output: 1, end: 3, exitCode: 0, text: 'ls' })
    expect(f).toMatchObject({ prompt: 3, output: 4, end: 4, exitCode: 1, text: 'false' })
    expect(ls!.ended! >= ls!.started!).toBe(true)
    expect(open).toEqual({ prompt: 4, input: 4 })
    expect(term.lastCommand).toBe(open)
    expect(seen.length).toBeGreaterThan(5)
  })

  it('Enter on an empty prompt is not a command; one interrupted at the prompt ends at the next', () => {
    const term = new Terminal({ cols: 40, rows: 10 })
    term.write(`${A}$ ${B}\r\n${D(0)}${A}$ ${B}sleep 9\r\n${C}^C\r\n${A}$ ${B}`)
    expect(term.commands.map((c) => [c.prompt, c.output, c.end])).toEqual([[0, undefined, undefined], [1, 2, 3], [3, undefined, undefined]])
  })

  it('an escaped command text (VS Code)', () => {
    const term = new Terminal()
    term.write(`${A}${B}${E('echo a\\x3bb \\\\ c')}`)
    expect(term.lastCommand!.text).toBe('echo a;b \\ c')
  })

  it('rows follow a resize; rows cut from the scrollback take their commands', () => {
    const term = new Terminal({ cols: 20, rows: 5, scrollback: 10 })
    session(term, [['echo', 'x'.repeat(30) + '\r\n', 0]])
    const before = term.commands.map((c) => c.prompt)
    term.resize(40, 5)
    // The output line was two rows at 20 columns, one at 40: the next prompt moved up.
    expect(term.commands.map((c) => c.prompt)).toEqual([before[0], before[1]! - 1])
    expect(term.buffer.lines[term.commands[1]!.prompt - term.trimmed]!.text()).toBe('$ ')
    session(term, Array.from({ length: 12 }, (_, i) => [`c${i}`, 'out\r\n', 0] as [string, string, number]))
    expect(term.commands.every((c) => c.prompt >= term.trimmed)).toBe(true)
    expect(term.buffer.lines[term.lastCommand!.prompt - term.trimmed]!.text()).toBe('$ ')
  })

  it('clear: the prompt row kept at the top, the commands before it gone', () => {
    const term = new Terminal({ cols: 20, rows: 5 })
    session(term, [['ls', 'a\r\nb\r\nc\r\n', 0]])
    term.write('typed')
    term.clear()
    expect(term.screenText()).toBe('$ typed')
    expect([term.buffer.x, term.buffer.y]).toEqual([7, 0])
    expect(term.commands).toHaveLength(1)
    expect(term.commands[0]!.prompt).toBe(term.trimmed)
  })

  it('a full-screen program’s marks are not the shell’s', () => {
    const term = new Terminal()
    term.write(`\x1b[?1049h${A}${B}${C}${D(0)}\x1b[?1049l`)
    expect(term.commands).toEqual([])
  })
})

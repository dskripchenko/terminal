import { describe, expect, it } from 'vitest'
import { Terminal } from '../src/terminal'
import { both, differences } from './oracle'

const output = (from: number, to: number): string => {
  let s = ''
  for (let i = from; i < to; i++) s += `line ${i} \x1b[3${i % 8}m${'x'.repeat(i % 50)}\x1b[0m\r\n`
  return s
}

describe('a full scrollback: the oldest rows go, as in xterm', () => {
  for (const [name, scrollback, lines] of [
    ['a small scrollback, cut many times over', 50, 5000],
    ['cut past the point where the rows are copied together', 1000, 6000],
    ['no scrollback at all', 0, 300],
  ] as const) {
    it(name, async () => {
      const chunks = []
      for (let i = 0; i < lines; i += 700) chunks.push(output(i, Math.min(lines, i + 700)))
      const { ours, theirs } = await both(chunks, 80, 24, scrollback)
      expect(differences(ours, theirs)).toEqual([])
      expect(ours.buffer.length).toBe(24 + scrollback)
      expect(ours.buffer.lines.length).toBe(24 + scrollback)
    })
  }

  it('rows by their index and the count of rows cut agree with the text', () => {
    const t = new Terminal({ cols: 80, rows: 5, scrollback: 2000 })
    t.write(output(0, 10000))
    // 10000 lines and the empty row after the last: 10001 rows in all, 2005 of them kept.
    expect(t.trimmed).toBe(10001 - 2005)
    expect(t.lineText(0)).toMatch(/^line 7996 /)
    expect(t.lineText(2003)).toMatch(/^line 9999 /)
    expect(t.buffer.line(-1)).toBeUndefined()
    expect(t.buffer.line(2005)).toBeUndefined()
    expect(t.buffer.line(2004)).toBe(t.buffer.row(4))
  })

  it('a long scrollback costs no more a line than a short one', () => {
    const time = (scrollback: number): number => {
      const t = new Terminal({ cols: 80, rows: 24, scrollback })
      t.write(output(0, scrollback + 24)) // filled first
      const text = output(0, 30000)
      const start = performance.now()
      t.write(text)
      return performance.now() - start
    }
    time(1000) // warm up
    const short = Math.min(time(1000), time(1000))
    const long = Math.min(time(100_000), time(100_000))
    // Cutting row by row made the long one hundreds of times slower.
    expect(long).toBeLessThan(short * 4 + 50)
  })
})

describe('synchronized output (mode 2026)', () => {
  it('set and reset; a reset ends it', () => {
    const t = new Terminal()
    t.write('\x1b[?2026h')
    expect(t.synchronized).toBe(true)
    t.write('\x1b[?2026l')
    expect(t.synchronized).toBe(false)
    t.write('\x1b[?2026h\x1bc')
    expect(t.synchronized).toBe(false)
    t.write('\x1b[?2026h\x1b[!p')
    expect(t.synchronized).toBe(false)
  })

  it('DECRQM answers whether a mode is set, reset or not known', () => {
    const t = new Terminal()
    const replies: string[] = []
    t.onData((d) => replies.push(d))
    t.write('\x1b[?2026$p\x1b[?2026h\x1b[?2026$p\x1b[?2004$p\x1b[?25$p\x1b[?1049h\x1b[?1049$p\x1b[?4242$p')
    expect(replies).toEqual(['\x1b[?2026;2$y', '\x1b[?2026;1$y', '\x1b[?2004;2$y', '\x1b[?25;1$y', '\x1b[?1049;1$y', '\x1b[?4242;0$y'])
  })
})

import { describe, expect, it } from 'vitest'
import { both, differences } from './oracle'

const prompt = Array.from({ length: 30 }, (_, i) => `${i}: ` + 'word '.repeat((i % 7) * 4)).join('\r\n') + '\r\n$ '

const steps: [string, string, [number, number][]][] = [
  ['narrower, then wider', prompt, [[50, 24], [30, 24], [120, 24], [80, 24]]],
  ['fewer rows, then more', prompt, [[80, 10], [80, 40], [80, 24]]],
  ['both at once', prompt, [[40, 12], [100, 30]]],
  ['wide characters at the new edge', '中'.repeat(50) + '\r\n$ ', [[33, 24], [17, 24], [80, 24]]],
]

describe('resizing as xterm does: lines wrapped again, the cursor kept', () => {
  for (const [name, text, sizes] of steps) {
    it(name, async () => {
      const { ours, theirs } = await both([text])
      for (const [c, r] of sizes) {
        ours.resize(c, r)
        theirs.resize(c, r)
        await new Promise<void>((done) => theirs.write('', done))
        expect(differences(ours, theirs, false), `${c}×${r}`).toEqual([])
      }
    })
  }
})

describe('where xterm loses text, the text is kept', () => {
  it('a wrapped line with the cursor in it: every character stays, the cursor stays on its character', async () => {
    const { ours } = await both(['0123456789'.repeat(20) + '\x1b[2;10H'])
    // The cursor on the 90th character (row 2, column 10 at 80 columns): a '9'.
    ours.resize(60, 24)
    expect(ours.buffer.lines.slice(0, 4).map((l) => l.text()).join('')).toBe('0123456789'.repeat(20))
    expect([ours.buffer.x, ours.buffer.y]).toEqual([29, 1])
    expect(ours.buffer.row(1).char(29)).toBe('9')
  })
})

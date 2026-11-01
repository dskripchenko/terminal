import { describe, expect, it } from 'vitest'
import { both, differences } from './oracle'

const cases: [string, string[], number?, number?][] = [
  ['plain text and line ends', ['hello\r\nworld\r\n']],
  ['wrap at the edge', ['x'.repeat(100) + '\r\nnext']],
  ['cursor moves', ['abc\x1b[2;5Hxy\x1b[A\x1b[2Cz\x1b[10G!\x1b[3d?']],
  ['erase in line and display', ['line1\r\nline2\r\nline3\x1b[2;3H\x1b[K\x1b[1J']],
  ['colours: 16, 256, true, colon forms', ['\x1b[31mred\x1b[42mon green\x1b[0m \x1b[38;5;208mx\x1b[48;2;10;20;30my\x1b[38:2::1:2:3mz\x1b[38:5:99mw\x1b[1;3;4;7;9ms\x1b[22;23;24;27;29mt\x1b[m']],
  ['background colour erase', ['\x1b[44m\x1b[2J\x1b[H\x1b[Kab\x1b[0m']],
  ['scroll region', ['\x1b[2;4r\x1b[4;1H1\n2\n3\n4\x1b[r\x1b[Hdone'], 20, 6],
  ['insert and delete lines and chars', ['aaaa\r\nbbbb\r\ncccc\x1b[2;1H\x1b[L\x1b[3;2H\x1b[2P\x1b[1;2H\x1b[3@\x1b[M']],
  ['tabs', ['a\tb\tc\x1b[3g\x1b[1;5H\x1bH\r\tX']],
  ['wide characters', ['日本語テキスト|\r\n' + '中'.repeat(45)]],
  ['wide at the edge', ['x'.repeat(79) + '中']],
  ['combining marks', ['é e\u0301 a\u0308\u0301 |']],
  ['DEC line drawing', ['\x1b(0lqqk\r\nx  x\r\nmqqj\x1b(B ok']],
  ['save and restore', ['\x1b[5;5Habc\x1b7\x1b[1;1Hz\x1b8d\x1b[s\x1b[Hq\x1b[ue']],
  ['alternate screen', ['normal\r\n\x1b[?1049h\x1b[Halt screen\x1b[?1049lback']],
  ['reverse index at top', ['\x1b[Htop\x1bMabove']],
  ['scrollback', [Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\r\n')]],
  ['autowrap off', ['\x1b[?7l' + 'y'.repeat(90) + '\x1b[?7h'], 20, 4],
  ['origin mode', ['\x1b[3;5r\x1b[?6h\x1b[Hin region\x1b[?6l\x1b[r']],
  ['REP and ECH', ['ab\x1b[5b\r\nhello world\x1b[1;2H\x1b[3X']],
  ['split in the middle of sequences', ['\x1b[3', '1mre', 'd\x1b', '[0m \x1b]0;ti', 'tle\x07ok é', '́']],
  ['erase below and above', ['1\r\n2\r\n3\r\n4\x1b[2;1H\x1b[J']],
  ['insert mode', ['hello\x1b[1;1H\x1b[4hXY\x1b[4l']],
  ['line feed mode', ['\x1b[20ha\nb\x1b[20l']],
  ['CNL CPL HPR VPR', ['\x1b[3E1\x1b[F2\x1b[5a3\x1b[2e4']],
  ['scroll up and down', ['1\r\n2\r\n3\r\n4\r\n5\x1b[2S\x1b[1T'], 10, 5],
]

describe('the same screen as xterm', () => {
  for (const [name, chunks, cols, rows] of cases) {
    it(name, async () => {
      const { ours, theirs } = await both(chunks, cols, rows)
      expect(differences(ours, theirs)).toEqual([])
    })
  }
})

describe('clusters by Unicode 15 (xterm counts by Unicode 6)', () => {
  it('an emoji sequence, a skin tone, a variation selector: one cell each', async () => {
    const { ours } = await both(['👍🏽|👨‍👩‍👧|✔️|'])
    const line = ours.buffer.row(0)
    expect(line.char(0)).toBe('👍🏽')
    expect(line.width(0)).toBe(2)
    expect(line.char(2)).toBe('|')
    expect(line.char(3)).toBe('👨‍👩‍👧')
    expect(line.char(5)).toBe('|')
    expect(line.text()).toBe('👍🏽|👨‍👩‍👧|✔️|')
  })
})

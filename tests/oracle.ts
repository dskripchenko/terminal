import xterm from '@xterm/headless'
import { BOLD, COLOR_KIND, DIM, INVERSE, ITALIC, PALETTE, RGB, STRIKE, UNDERLINE } from '../src/line'
import { Terminal } from '../src/terminal'

const { Terminal: XTerm } = xterm as unknown as { Terminal: new (o: object) => import('@xterm/headless').Terminal }

/** Both terminals fed the same, in the same pieces. */
export async function both(chunks: string[], cols = 80, rows = 24, scrollback = 1000): Promise<{ ours: Terminal; theirs: import('@xterm/headless').Terminal }> {
  const ours = new Terminal({ cols, rows, scrollback })
  const theirs = new XTerm({ cols, rows, scrollback, allowProposedApi: true })
  for (const c of chunks) {
    ours.write(c)
    await new Promise<void>((r) => theirs.write(c, r))
  }
  return { ours, theirs }
}

const colorOf = (kind: 'palette' | 'rgb' | 'default', value: number): string => (kind === 'default' ? 'd' : kind === 'palette' ? `p${value}` : `#${value.toString(16).padStart(6, '0')}`)

function ourColor(c: number): string {
  const kind = c & COLOR_KIND
  return kind === 0 ? 'd' : kind === PALETTE ? `p${c & 0xff}` : kind === RGB ? `#${(c & 0xffffff).toString(16).padStart(6, '0')}` : '?'
}

/** The differences between the two, as readable lines (empty: the same). */
export function differences(ours: Terminal, theirs: import('@xterm/headless').Terminal, cells = true): string[] {
  const out: string[] = []
  const tb = theirs.buffer.active
  const ob = ours.buffer
  if (ob.lines.length !== tb.length) out.push(`rows in all: ours ${ob.lines.length}, xterm ${tb.length}`)
  const n = Math.max(ob.lines.length, tb.length)
  for (let i = 0; i < n; i++) {
    const a = ob.lines[i]?.text() ?? '∅'
    const b = tb.getLine(i)?.translateToString(true) ?? '∅'
    if (a !== b) out.push(`row ${i}: ours ${JSON.stringify(a)}\n        xterm ${JSON.stringify(b)}`)
    if (out.length > 12) return out
  }
  // xterm keeps a cursor past the last column as `cols`: the same place.
  if (ob.x !== Math.min(tb.cursorX, ours.cols - 1) || ob.y !== tb.cursorY) out.push(`cursor: ours ${ob.x},${ob.y}, xterm ${tb.cursorX},${tb.cursorY}`)
  if (!cells) return out
  for (let y = 0; y < ours.rows; y++) {
    const ol = ob.row(y)
    const tl = tb.getLine(tb.baseY + y)
    if (!tl) continue
    for (let x = 0; x < ours.cols; x++) {
      const tc = tl.getCell(x)
      if (!tc || ol.width(x) === 0) continue
      const f = ol.flags(x)
      const mine = [ourColor(ol.fg(x)), ourColor(ol.bg(x)), f & BOLD ? 'b' : '', f & DIM ? 'd' : '', f & ITALIC ? 'i' : '', f & UNDERLINE ? 'u' : '', f & INVERSE ? 'r' : '', f & STRIKE ? 's' : ''].join('')
      const fg = tc.isFgDefault() ? colorOf('default', 0) : tc.isFgPalette() ? colorOf('palette', tc.getFgColor()) : colorOf('rgb', tc.getFgColor())
      const bg = tc.isBgDefault() ? colorOf('default', 0) : tc.isBgPalette() ? colorOf('palette', tc.getBgColor()) : colorOf('rgb', tc.getBgColor())
      const theirsAttrs = [fg, bg, tc.isBold() ? 'b' : '', tc.isDim() ? 'd' : '', tc.isItalic() ? 'i' : '', tc.isUnderline() ? 'u' : '', tc.isInverse() ? 'r' : '', tc.isStrikethrough() ? 's' : ''].join('')
      // A blank cell's style is not seen; its background is.
      const blank = ol.isBlank(x) && tc.getChars() === ''
      if (blank ? ourColor(ol.bg(x)) !== bg : mine !== theirsAttrs) {
        out.push(`cell ${x},${y} ${JSON.stringify(ol.char(x))}: ours ${mine}, xterm ${theirsAttrs}`)
        if (out.length > 20) return out
      }
    }
  }
  return out
}

/**
 * A row of cells, packed: four numbers a cell — the character and its width,
 * the foreground, the background, the style — so a scrollback of thousands of
 * rows is a few typed arrays, not millions of objects. A character of more
 * than one code point (an accent joined to a letter, an emoji sequence) keeps
 * its text beside the row.
 */

/** Numbers per cell. */
const CELL = 4
const CP_MASK = 0x1fffff
const WIDTH_SHIFT = 21
const COMBINED = 1 << 23

/** Colours: 0 is the default; a palette index or an RGB value tagged by its kind. */
export const PALETTE = 1 << 24
export const RGB = 2 << 24
export const COLOR_KIND = 3 << 24

/** Styles. Bits 16 and up hold a link's id. */
export const BOLD = 1
export const DIM = 2
export const ITALIC = 4
export const UNDERLINE = 8
export const BLINK = 16
export const INVERSE = 32
export const HIDDEN = 64
export const STRIKE = 128
export const DOUBLE_UNDERLINE = 256
export const OVERLINE = 512
export const CURLY_UNDERLINE = 1024
export const LINK_SHIFT = 16

/** The pen: what newly written cells look like. */
export interface Attr {
  fg: number
  bg: number
  flags: number
}

export const DEFAULT_ATTR: Readonly<Attr> = { fg: 0, bg: 0, flags: 0 }

/** A blank cell: width 1, no character. */
const BLANK = 1 << WIDTH_SHIFT

export class Line {
  data: Uint32Array
  /** The row continues on the next one (the text ran past the right edge). */
  wrapped = false
  /** Characters of more than one code point, by column. */
  extra: Map<number, string> | null = null

  constructor(
    public cols: number,
    attr: Attr = DEFAULT_ATTR,
  ) {
    this.data = new Uint32Array(cols * CELL)
    this.fill(0, cols, attr)
  }

  /** The character in a cell: '' for the right half of a wide one, ' ' for a blank. */
  char(x: number): string {
    const c = this.data[x * CELL]!
    if (c & COMBINED) return this.extra?.get(x) ?? ' '
    const cp = c & CP_MASK
    if (cp === 0) return (c >>> WIDTH_SHIFT) & 3 ? ' ' : ''
    return String.fromCodePoint(cp)
  }

  /** 0 for the right half of a wide character. */
  width(x: number): number {
    return (this.data[x * CELL]! >>> WIDTH_SHIFT) & 3
  }

  isBlank(x: number): boolean {
    const c = this.data[x * CELL]!
    return (c & CP_MASK) === 0 && !(c & COMBINED) && ((c >>> WIDTH_SHIFT) & 3) === 1
  }

  fg(x: number): number {
    return this.data[x * CELL + 1]!
  }

  bg(x: number): number {
    return this.data[x * CELL + 2]!
  }

  flags(x: number): number {
    return this.data[x * CELL + 3]!
  }

  /** Write a character (one code point, or a cluster) of a width into a cell. */
  set(x: number, text: string, width: number, attr: Attr): void {
    const i = x * CELL
    const cp = text.codePointAt(0) ?? 0
    const single = text.length === (cp > 0xffff ? 2 : 1)
    this.data[i] = (single ? cp : COMBINED) | (width << WIDTH_SHIFT)
    if (!single) (this.extra ??= new Map()).set(x, text)
    else this.extra?.delete(x)
    this.data[i + 1] = attr.fg
    this.data[i + 2] = attr.bg
    this.data[i + 3] = attr.flags
  }

  /** A mark joined to the character in a cell (an accent, a variation selector). */
  join(x: number, mark: string): void {
    const i = x * CELL
    const text = this.char(x) + mark
    ;(this.extra ??= new Map()).set(x, text)
    this.data[i] = (this.data[i]! & ~CP_MASK) | COMBINED
  }

  /** The right half of a wide character. */
  setContinuation(x: number, attr: Attr): void {
    const i = x * CELL
    this.data[i] = 0
    this.extra?.delete(x)
    this.data[i + 1] = attr.fg
    this.data[i + 2] = attr.bg
    this.data[i + 3] = attr.flags
  }

  /** Blank cells from `from` to `to` (excluded), in the pen's background (erase keeps the colour, not the style). */
  fill(from: number, to: number, attr: Attr = DEFAULT_ATTR): void {
    for (let x = Math.max(0, from); x < Math.min(to, this.cols); x++) {
      const i = x * CELL
      this.data[i] = BLANK
      this.data[i + 1] = attr.fg
      this.data[i + 2] = attr.bg
      this.data[i + 3] = 0
      this.extra?.delete(x)
    }
  }

  /** Insert `n` blank cells at `x`, the rest moving right (and off the edge). */
  insert(x: number, n: number, attr: Attr): void {
    if (x >= this.cols) return
    n = Math.min(n, this.cols - x)
    this.data.copyWithin((x + n) * CELL, x * CELL, (this.cols - n) * CELL)
    this.shiftExtra(x, n)
    this.fill(x, x + n, attr)
  }

  /** Delete `n` cells at `x`, the rest moving left, blanks coming in at the edge. */
  delete(x: number, n: number, attr: Attr): void {
    if (x >= this.cols) return
    n = Math.min(n, this.cols - x)
    this.data.copyWithin(x * CELL, (x + n) * CELL, this.cols * CELL)
    this.shiftExtra(x, -n)
    this.fill(this.cols - n, this.cols, attr)
  }

  private shiftExtra(from: number, by: number): void {
    if (!this.extra || this.extra.size === 0) return
    const next = new Map<number, string>()
    for (const [x, s] of this.extra) {
      if (x < from) next.set(x, s)
      else if (by < 0 && x < from - by) continue
      else if (x + by < this.cols) next.set(x + by, s)
    }
    this.extra = next
  }

  /** The same row, a copy. */
  clone(): Line {
    const l = new Line(0)
    l.cols = this.cols
    l.data = this.data.slice()
    l.wrapped = this.wrapped
    l.extra = this.extra ? new Map(this.extra) : null
    return l
  }

  /** Cut or pad to a width (no reflow: that is the buffer's work). */
  resize(cols: number, attr: Attr = DEFAULT_ATTR): void {
    if (cols === this.cols) return
    const data = new Uint32Array(cols * CELL)
    data.set(this.data.subarray(0, Math.min(cols, this.cols) * CELL))
    const old = this.cols
    this.data = data
    this.cols = cols
    if (cols > old) this.fill(old, cols, attr)
    else if (this.extra) for (const x of [...this.extra.keys()]) if (x >= cols) this.extra.delete(x)
    // A wide character cut in half at the new edge.
    if (cols < old && cols > 0 && this.width(cols - 1) === 2) this.fill(cols - 1, cols, attr)
  }

  /** Where the text ends: the column after the last cell that is not blank. */
  length(): number {
    for (let x = this.cols - 1; x >= 0; x--) if (!this.isBlank(x)) return x + 1
    return 0
  }

  /** The row's text, from `from` to `to`; trailing blanks dropped unless asked. */
  text(from = 0, to = this.cols, trim = true): string {
    const end = trim ? Math.min(to, this.length()) : to
    let out = ''
    for (let x = from; x < end; x++) out += this.char(x)
    return out
  }

  /** Copy cells into another row (for reflow). */
  copyTo(target: Line, from: number, to: number, at: number): void {
    target.data.set(this.data.subarray(from * CELL, to * CELL), at * CELL)
    if (this.extra) for (const [x, s] of this.extra) if (x >= from && x < to) (target.extra ??= new Map()).set(x - from + at, s)
  }
}

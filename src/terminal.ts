/**
 * The terminal itself, without a screen to draw on: what the program wrote,
 * read as the xterm family reads it, kept as rows of cells — the screen and
 * the scrollback above it, or the alternate screen of a full-screen program —
 * with the cursor, the modes and the answers a program asks for. A view (or a
 * test) reads the rows; `onData` carries what goes back to the program.
 */
import { BLINK, BOLD, CURLY_UNDERLINE, DEFAULT_ATTR, DIM, DOUBLE_UNDERLINE, HIDDEN, INVERSE, ITALIC, Line, LINK_SHIFT, OVERLINE, PALETTE, RGB, STRIKE, UNDERLINE, type Attr } from './line'
import { Parser, type ParserHandler } from './parser'
import { charWidth } from './width'

export interface TerminalOptions {
  cols?: number
  rows?: number
  /** Rows kept above the screen (1000). */
  scrollback?: number
  /** Answered when a program asks for the colours (OSC 10, 11): `#rrggbb`. */
  foreground?: string
  background?: string
}

export type CursorStyle = 'block' | 'underline' | 'bar'

export type MouseTracking = 'none' | 'click' | 'drag' | 'any'

export type Listener<T> = (value: T) => void

/**
 * A command as the shell marks it (OSC 133, or VS Code's 633): where its
 * prompt starts, where what was typed starts, where its output starts and
 * ends, its exit code and times. Rows are absolute — a row's index in the
 * buffer plus `trimmed` — so they stay put while the scrollback is cut.
 */
export interface Command {
  prompt: number
  input?: number
  output?: number
  end?: number
  /** What was run, when the shell says (633;E). */
  text?: string
  exitCode?: number
  /** Milliseconds since the epoch. */
  started?: number
  ended?: number
}

/** The cursor as saved by DECSC / ESC 7. */
interface Saved {
  x: number
  y: number
  attr: Attr
  wrapNext: boolean
  origin: boolean
  charsets: [string, string]
  shift: 0 | 1
}

/** A screen's rows (the normal one with its scrollback, or the alternate) and its cursor. */
export class ScreenBuffer {
  lines: Line[] = []
  x = 0
  y = 0
  top = 0
  bottom: number
  saved: Saved | null = null

  constructor(
    public cols: number,
    public rows: number,
    readonly scrollback: boolean,
  ) {
    this.bottom = rows - 1
    for (let i = 0; i < rows; i++) this.lines.push(new Line(cols))
  }

  /** Index of the screen's first row among `lines`. */
  get base(): number {
    return this.lines.length - this.rows
  }

  /** A row of the screen (0 at its top). */
  row(y: number): Line {
    return this.lines[this.base + y]!
  }
}

/** DEC special graphics: the line drawing set (`ESC ( 0`), for `j`…`x` and the rest. */
const DEC_GRAPHICS: Record<string, string> = {
  '`': '◆', a: '▒', b: '␉', c: '␌', d: '␍', e: '␊', f: '°', g: '±', h: '␤', i: '␋', j: '┘', k: '┐', l: '┌', m: '└', n: '┼',
  o: '⎺', p: '⎻', q: '─', r: '⎼', s: '⎽', t: '├', u: '┤', v: '┴', w: '┬', x: '│', y: '≤', z: '≥', '{': 'π', '|': '≠', '}': '£', '~': '·',
}

export class Terminal implements ParserHandler {
  cols: number
  rows: number
  readonly normal: ScreenBuffer
  alt: ScreenBuffer
  buffer: ScreenBuffer
  private readonly maxScrollback: number
  private readonly parser: Parser
  private readonly fgColor: string
  private readonly bgColor: string

  // The pen and the modes.
  attr: Attr = { ...DEFAULT_ATTR }
  private wrapNext = false
  insertMode = false
  newlineMode = false
  applicationCursor = false
  applicationKeypad = false
  originMode = false
  autowrap = true
  cursorVisible = true
  cursorBlink = true
  cursorStyle: CursorStyle = 'block'
  bracketedPaste = false
  mouseTracking: MouseTracking = 'none'
  mouseSgr = false
  focusEvents = false
  reverseVideo = false
  title = ''
  /** The program's working folder, when its shell says (OSC 7). */
  cwd: string | null = null
  private charsets: [string, string] = ['B', 'B']
  private shift: 0 | 1 = 0
  private tabs = new Set<number>()
  private lastChar = ''
  /** The joiner was the last thing printed: the next character belongs to the same cluster. */
  private joining = false
  /** Hyperlinks (OSC 8) by id; 0 is "none". */
  readonly links: string[] = ['']
  private link = 0
  /** Rows dropped from the top of the scrollback, in all: a view's absolute row numbers move by it. */
  trimmed = 0

  private readonly dataListeners: Listener<string>[] = []
  private readonly changeListeners: Listener<void>[] = []
  private readonly titleListeners: Listener<string>[] = []
  private readonly bellListeners: Listener<void>[] = []
  private readonly cwdListeners: Listener<string>[] = []
  private readonly markListeners: Listener<{ kind: string; row: number }>[] = []
  private readonly commandListeners: Listener<Command>[] = []
  /** The commands of the normal screen, oldest first (shell integration). */
  commands: Command[] = []

  constructor(o: TerminalOptions = {}) {
    this.cols = Math.max(2, o.cols ?? 80)
    this.rows = Math.max(1, o.rows ?? 24)
    this.maxScrollback = Math.max(0, o.scrollback ?? 1000)
    this.fgColor = o.foreground ?? '#000000'
    this.bgColor = o.background ?? '#ffffff'
    this.normal = new ScreenBuffer(this.cols, this.rows, true)
    this.alt = new ScreenBuffer(this.cols, this.rows, false)
    this.buffer = this.normal
    this.resetTabs()
    this.parser = new Parser(this)
  }

  // Events --------------------------------------------------------------------------

  /** What goes back to the program: answers to its questions, and the keys typed through a view. */
  onData(listener: Listener<string>): () => void {
    return on(this.dataListeners, listener)
  }

  /** Something on the screen changed. */
  onChange(listener: Listener<void>): () => void {
    return on(this.changeListeners, listener)
  }

  onTitle(listener: Listener<string>): () => void {
    return on(this.titleListeners, listener)
  }

  onBell(listener: Listener<void>): () => void {
    return on(this.bellListeners, listener)
  }

  onCwd(listener: Listener<string>): () => void {
    return on(this.cwdListeners, listener)
  }

  /** Shell integration (OSC 133): a prompt starts (`A`), a command starts (`B`, `C`), ends (`D`). */
  onMark(listener: Listener<{ kind: string; row: number }>): () => void {
    return on(this.markListeners, listener)
  }

  /** A command began, ran or ended (shell integration). */
  onCommand(listener: Listener<Command>): () => void {
    return on(this.commandListeners, listener)
  }

  /** The command running now, or the last one. */
  get lastCommand(): Command | null {
    return this.commands[this.commands.length - 1] ?? null
  }

  /** Send to the program (a view's keys, a paste). */
  input(data: string): void {
    for (const l of this.dataListeners) l(data)
  }

  /** Text pasted: wrapped in the bracketed paste marks when the program asked for them. */
  paste(text: string): void {
    const clean = text.replace(/\r?\n/g, '\r')
    this.input(this.bracketedPaste ? `\x1b[200~${clean.split('\x1b[201~').join('')}\x1b[201~` : clean)
  }

  // Writing -------------------------------------------------------------------------

  /** What the program wrote. */
  write(data: string): void {
    this.parser.parse(data)
    for (const l of this.changeListeners) l()
  }

  /** The text of a row (an absolute index into the buffer, scrollback included). */
  lineText(index: number): string {
    return this.buffer.lines[index]?.text() ?? ''
  }

  /** The screen as text, a row per line (for tests and for copying). */
  screenText(): string {
    const b = this.buffer
    const out: string[] = []
    for (let y = 0; y < this.rows; y++) out.push(b.row(y).text())
    return out.join('\n').replace(/\n+$/, '')
  }

  /** Back to the state at start (RIS). */
  reset(): void {
    this.parser.reset()
    this.normal.lines = []
    for (let i = 0; i < this.rows; i++) this.normal.lines.push(new Line(this.cols))
    this.alt = new ScreenBuffer(this.cols, this.rows, false)
    this.buffer = this.normal
    this.commands = []
    for (const b of [this.normal, this.alt]) {
      b.x = b.y = 0
      b.top = 0
      b.bottom = this.rows - 1
      b.saved = null
    }
    this.softReset()
    this.cursorStyle = 'block'
    this.cursorBlink = true
    this.title = ''
    this.resetTabs()
    this.mouseTracking = 'none'
    this.mouseSgr = false
    this.focusEvents = false
    this.reverseVideo = false
  }

  private softReset(): void {
    this.attr = { ...DEFAULT_ATTR }
    this.wrapNext = false
    this.insertMode = false
    this.newlineMode = false
    this.applicationCursor = false
    this.applicationKeypad = false
    this.originMode = false
    this.autowrap = true
    this.cursorVisible = true
    this.bracketedPaste = false
    this.charsets = ['B', 'B']
    this.shift = 0
    this.link = 0
    this.buffer.top = 0
    this.buffer.bottom = this.rows - 1
  }

  private resetTabs(): void {
    this.tabs = new Set()
    for (let x = 8; x < this.cols; x += 8) this.tabs.add(x)
  }

  private reply(data: string): void {
    this.input(data)
  }

  /** Erasing paints the pen's background, not its style (as xterm). */
  private eraseAttr(): Attr {
    return { fg: 0, bg: this.attr.bg, flags: 0 }
  }

  private pen(): Attr {
    return this.link ? { fg: this.attr.fg, bg: this.attr.bg, flags: this.attr.flags | (this.link << LINK_SHIFT) } : this.attr
  }

  // The parser's handler ----------------------------------------------------------------

  print(text: string): void {
    const b = this.buffer
    const g = this.charsets[this.shift]
    for (const ch of text) {
      let s = ch
      if (g === '0' && DEC_GRAPHICS[s]) s = DEC_GRAPHICS[s]!
      const cp = s.codePointAt(0)!
      const w = this.joining ? 0 : charWidth(cp)
      this.joining = cp === 0x200d
      if (w === 0) {
        // Joined to the character before: an accent, a variation selector, an emoji sequence.
        let x = this.wrapNext ? b.x : b.x - 1
        const line = b.row(b.y)
        if (x >= 0 && line.width(x) === 0 && x > 0) x--
        if (x >= 0) line.join(x, s)
        continue
      }
      if (this.wrapNext) {
        if (this.autowrap) {
          b.row(b.y).wrapped = true
          b.x = 0
          this.lineFeed()
        }
        this.wrapNext = false
      }
      let line = b.row(b.y)
      if (w === 2 && b.x === this.cols - 1) {
        if (this.autowrap) {
          line.fill(b.x, b.x + 1, this.eraseAttr())
          line.wrapped = true
          b.x = 0
          this.lineFeed()
          line = b.row(b.y)
        } else b.x = this.cols - 2
      }
      if (this.insertMode) line.insert(b.x, w, this.eraseAttr())
      // Writing over half of a wide character blanks its other half.
      if (line.width(b.x) === 0 && b.x > 0) line.fill(b.x - 1, b.x, this.eraseAttr())
      if (line.width(b.x) === 2 && w === 1 && b.x + 1 < this.cols) line.fill(b.x + 1, b.x + 2, this.eraseAttr())
      const pen = this.pen()
      line.set(b.x, s, w, pen)
      if (w === 2) {
        if (b.x + 2 < this.cols && line.width(b.x + 2) === 0) line.fill(b.x + 2, b.x + 3, this.eraseAttr())
        line.setContinuation(b.x + 1, pen)
      }
      this.lastChar = s
      b.x += w
      if (b.x >= this.cols) {
        b.x = this.cols - 1
        this.wrapNext = this.autowrap
      }
    }
  }

  execute(code: number): void {
    const b = this.buffer
    switch (code) {
      case 0x07:
        for (const l of this.bellListeners) l()
        break
      case 0x08:
        if (this.wrapNext) this.wrapNext = false
        else if (b.x > 0) b.x--
        break
      case 0x09:
        this.tabForward(1)
        break
      case 0x0a:
      case 0x0b:
      case 0x0c:
        this.lineFeed()
        if (this.newlineMode) b.x = 0
        break
      case 0x0d:
        b.x = 0
        this.wrapNext = false
        break
      case 0x0e:
        this.shift = 1
        break
      case 0x0f:
        this.shift = 0
        break
      case 0x84:
        this.lineFeed()
        break
      case 0x85:
        this.lineFeed()
        b.x = 0
        break
      case 0x88:
        this.tabs.add(b.x)
        break
      case 0x8d:
        this.reverseIndex()
        break
    }
  }

  esc(intermediates: string, final: string): void {
    const b = this.buffer
    if (intermediates === '') {
      switch (final) {
        case '7':
          this.saveCursor()
          return
        case '8':
          this.restoreCursor()
          return
        case 'D':
          this.lineFeed()
          return
        case 'E':
          this.lineFeed()
          b.x = 0
          return
        case 'H':
          this.tabs.add(b.x)
          return
        case 'M':
          this.reverseIndex()
          return
        case 'c':
          this.reset()
          return
        case '=':
          this.applicationKeypad = true
          return
        case '>':
          this.applicationKeypad = false
          return
      }
      return
    }
    if (intermediates === '(' || intermediates === ')') {
      this.charsets[intermediates === '(' ? 0 : 1] = final
      return
    }
    if (intermediates === '#' && final === '8') {
      // DECALN: the screen filled with E (an alignment test).
      for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.cols; x++) b.row(y).set(x, 'E', 1, DEFAULT_ATTR)
      b.x = b.y = 0
    }
  }

  osc(data: string): void {
    const semi = data.indexOf(';')
    const code = semi < 0 ? data : data.slice(0, semi)
    const rest = semi < 0 ? '' : data.slice(semi + 1)
    switch (code) {
      case '0':
      case '2':
        this.title = rest
        for (const l of this.titleListeners) l(rest)
        return
      case '7': {
        // file://host/path, percent-encoded.
        const m = /^file:\/\/[^/]*(\/.*)$/.exec(rest)
        if (!m) return
        try {
          this.cwd = decodeURIComponent(m[1]!)
        } catch {
          this.cwd = m[1]!
        }
        for (const l of this.cwdListeners) l(this.cwd)
        return
      }
      case '8': {
        // 8;params;uri — an empty uri ends the link.
        const uri = rest.slice(rest.indexOf(';') + 1)
        if (uri === '') this.link = 0
        else {
          let id = this.links.indexOf(uri)
          if (id < 0) {
            // Ids are 16 bits: past that, the oldest go round.
            if (this.links.length >= 0xffff) this.links.length = 1
            id = this.links.push(uri) - 1
          }
          this.link = id
        }
        return
      }
      case '10':
      case '11':
        if (rest === '?') this.reply(`\x1b]${code};${xColor(code === '10' ? this.fgColor : this.bgColor)}\x1b\\`)
        return
      case '133':
      case '633': {
        const kind = rest.charAt(0)
        const row = this.buffer.base + this.buffer.y + this.trimmed
        if (kind) for (const l of this.markListeners) l({ kind, row })
        this.mark(kind, rest.slice(2), row)
        return
      }
    }
  }

  csi(params: number[][], prefix: string, intermediates: string, final: string): void {
    const b = this.buffer
    // A parameter, with its default; 0 counts as the default for counts.
    const p = (i: number, def: number): number => {
      const v = params[i]?.[0] ?? -1
      return v <= 0 ? def : v
    }
    const raw = (i: number): number => params[i]?.[0] ?? -1
    if (intermediates === ' ' && final === 'q') {
      const s = raw(0) < 0 ? 0 : raw(0)
      this.cursorStyle = s <= 2 ? 'block' : s <= 4 ? 'underline' : 'bar'
      this.cursorBlink = s === 0 || s % 2 === 1
      return
    }
    if (intermediates === '!' && final === 'p') {
      this.softReset()
      return
    }
    if (intermediates !== '') return
    if (prefix === '?') {
      if (final === 'h' || final === 'l') for (const prm of params) this.privateMode(prm[0]!, final === 'h')
      else if (final === 'n' && raw(0) === 6) this.reply(`\x1b[?${b.y + 1 - (this.originMode ? b.top : 0)};${b.x + 1}R`)
      else if (final === 'J') this.eraseDisplay(raw(0) < 0 ? 0 : raw(0))
      else if (final === 'K') this.eraseLine(raw(0) < 0 ? 0 : raw(0))
      return
    }
    if (prefix === '>') {
      if (final === 'c') this.reply('\x1b[>0;10;1c')
      return
    }
    if (prefix !== '') return
    switch (final) {
      case '@':
        b.row(b.y).insert(b.x, p(0, 1), this.eraseAttr())
        this.wrapNext = false
        break
      case 'A':
        this.moveTo(b.x, Math.max(b.y - p(0, 1), b.y >= b.top ? b.top : 0))
        break
      case 'B':
        this.moveTo(b.x, Math.min(b.y + p(0, 1), b.y <= b.bottom ? b.bottom : this.rows - 1))
        break
      case 'C':
      case 'a':
        this.moveTo(b.x + p(0, 1), b.y)
        break
      case 'D':
        this.moveTo(b.x - p(0, 1), b.y)
        break
      case 'E':
        this.moveTo(0, Math.min(b.y + p(0, 1), b.bottom))
        break
      case 'F':
        this.moveTo(0, Math.max(b.y - p(0, 1), b.top))
        break
      case 'G':
      case '`':
        this.moveTo(p(0, 1) - 1, b.y)
        break
      case 'H':
      case 'f':
        this.moveTo(p(1, 1) - 1, (this.originMode ? b.top : 0) + p(0, 1) - 1)
        break
      case 'I':
        this.tabForward(p(0, 1))
        break
      case 'J':
        this.eraseDisplay(raw(0) < 0 ? 0 : raw(0))
        break
      case 'K':
        this.eraseLine(raw(0) < 0 ? 0 : raw(0))
        break
      case 'L':
        if (b.y >= b.top && b.y <= b.bottom) {
          this.scrollDownAt(b.y, p(0, 1))
          b.x = 0
        }
        break
      case 'M':
        if (b.y >= b.top && b.y <= b.bottom) {
          this.scrollUpAt(b.y, p(0, 1), false)
          b.x = 0
        }
        break
      case 'P':
        b.row(b.y).delete(b.x, p(0, 1), this.eraseAttr())
        this.wrapNext = false
        break
      case 'S':
        // Scrolled by the program: what leaves the top is gone, not kept above (as xterm).
        this.scrollUpAt(b.top, p(0, 1), false)
        break
      case 'T':
        this.scrollDownAt(b.top, p(0, 1))
        break
      case 'X':
        b.row(b.y).fill(b.x, b.x + p(0, 1), this.eraseAttr())
        this.wrapNext = false
        break
      case 'Z':
        for (let n = p(0, 1); n > 0 && b.x > 0; n--) {
          do b.x--
          while (b.x > 0 && !this.tabs.has(b.x))
        }
        break
      case 'b':
        if (this.lastChar) this.print(this.lastChar.repeat(Math.min(p(0, 1), 0xffff)))
        break
      case 'c':
        if (raw(0) <= 0) this.reply('\x1b[?1;2c')
        break
      case 'd':
        this.moveTo(b.x, (this.originMode ? b.top : 0) + p(0, 1) - 1)
        break
      case 'e':
        this.moveTo(b.x, b.y + p(0, 1))
        break
      case 'g':
        if (raw(0) <= 0) this.tabs.delete(b.x)
        else if (raw(0) === 3) this.tabs.clear()
        break
      case 'h':
      case 'l':
        for (const prm of params) {
          if (prm[0] === 4) this.insertMode = final === 'h'
          else if (prm[0] === 20) this.newlineMode = final === 'h'
        }
        break
      case 'm':
        this.sgr(params)
        break
      case 'n':
        if (raw(0) === 5) this.reply('\x1b[0n')
        else if (raw(0) === 6) this.reply(`\x1b[${b.y + 1 - (this.originMode ? b.top : 0)};${b.x + 1}R`)
        break
      case 'r': {
        const top = p(0, 1) - 1
        const bottom = Math.min(p(1, this.rows), this.rows) - 1
        if (top < bottom) {
          b.top = top
          b.bottom = bottom
          this.moveTo(0, this.originMode ? top : 0)
        }
        break
      }
      case 's':
        this.saveCursor()
        break
      case 'u':
        this.restoreCursor()
        break
      case 't':
        if (raw(0) === 18) this.reply(`\x1b[8;${this.rows};${this.cols}t`)
        break
    }
  }

  /** Shell integration: A a prompt, B the command typed, C it runs, D it ended (`D;code`), E its text. */
  private mark(kind: string, arg: string, row: number): void {
    // A full-screen program's own marks are not the shell's.
    if (this.buffer !== this.normal) return
    let c = this.lastCommand
    switch (kind) {
      case 'A':
        // The last one never said it ended (Ctrl+C at the prompt): it ends here.
        if (c && c.output !== undefined && c.end === undefined) c.end = row
        c = { prompt: row }
        this.commands.push(c)
        if (this.commands.length > 5000) this.commands.splice(0, this.commands.length - 5000)
        break
      case 'B':
        if (!c) return
        c.input = row
        break
      case 'C':
        if (!c) return
        c.output = row
        c.started = Date.now()
        break
      case 'D': {
        if (!c || c.end !== undefined) return
        // A prompt that ran nothing (Enter on an empty line) is not a command.
        if (c.output === undefined) return
        c.end = row
        c.ended = Date.now()
        const code = Number.parseInt(arg, 10)
        if (Number.isFinite(code)) c.exitCode = code
        break
      }
      case 'E':
        if (!c) return
        // VS Code's escaping: \\ and \xAB.
        c.text = arg.split(';')[0]!.replace(/\\x([0-9a-fA-F]{2})|\\\\/g, (_m, hex: string | undefined) => (hex ? String.fromCharCode(parseInt(hex, 16)) : '\\'))
        break
      default:
        return
    }
    for (const l of this.commandListeners) l(c)
  }

  /**
   * Clear (Cmd+K): the scrollback and the screen gone, the row with the cursor
   * — the prompt — kept at the top.
   */
  clear(): void {
    const b = this.normal
    if (this.buffer !== b) return
    const keep = b.row(b.y).clone()
    const removed = b.base + b.y
    b.lines = [keep, ...Array.from({ length: this.rows - 1 }, () => new Line(this.cols))]
    b.y = 0
    this.trimmed += removed
    this.commands = this.commands.filter((c) => c.prompt >= this.trimmed)
    for (const l of this.changeListeners) l()
  }

  // Modes -----------------------------------------------------------------------------

  private privateMode(mode: number, on: boolean): void {
    switch (mode) {
      case 1:
        this.applicationCursor = on
        break
      case 5:
        this.reverseVideo = on
        break
      case 6:
        this.originMode = on
        this.moveTo(0, on ? this.buffer.top : 0)
        break
      case 7:
        this.autowrap = on
        if (!on) this.wrapNext = false
        break
      case 12:
        this.cursorBlink = on
        break
      case 25:
        this.cursorVisible = on
        break
      case 9:
      case 1000:
        this.mouseTracking = on ? 'click' : 'none'
        break
      case 1002:
        this.mouseTracking = on ? 'drag' : 'none'
        break
      case 1003:
        this.mouseTracking = on ? 'any' : 'none'
        break
      case 1004:
        this.focusEvents = on
        break
      case 1006:
        this.mouseSgr = on
        break
      case 2004:
        this.bracketedPaste = on
        break
      case 47:
      case 1047:
        this.switchBuffer(on, false)
        break
      case 1048:
        if (on) this.saveCursor()
        else this.restoreCursor()
        break
      case 1049:
        this.switchBuffer(on, true)
        break
    }
  }

  /** To the alternate screen (cleared) and back; 1049 saves and restores the cursor around it. */
  private switchBuffer(alt: boolean, withCursor: boolean): void {
    if (alt === (this.buffer === this.alt)) return
    if (alt) {
      if (withCursor) this.saveCursor()
      this.alt = new ScreenBuffer(this.cols, this.rows, false)
      this.alt.x = this.normal.x
      this.alt.y = this.normal.y
      this.buffer = this.alt
    } else {
      this.buffer = this.normal
      if (withCursor) this.restoreCursor()
    }
    this.wrapNext = false
  }

  private saveCursor(): void {
    const b = this.buffer
    b.saved = { x: b.x, y: b.y, attr: { ...this.attr }, wrapNext: this.wrapNext, origin: this.originMode, charsets: [...this.charsets], shift: this.shift }
  }

  private restoreCursor(): void {
    const b = this.buffer
    const s = b.saved
    if (!s) {
      b.x = b.y = 0
      this.attr = { ...DEFAULT_ATTR }
      return
    }
    b.x = Math.min(s.x, this.cols - 1)
    b.y = Math.min(s.y, this.rows - 1)
    this.attr = { ...s.attr }
    this.wrapNext = s.wrapNext
    this.originMode = s.origin
    this.charsets = [...s.charsets]
    this.shift = s.shift
  }

  // Colours and styles ------------------------------------------------------------------

  private sgr(params: number[][]): void {
    if (params.length === 0) {
      this.attr = { ...DEFAULT_ATTR }
      return
    }
    const a = this.attr
    for (let i = 0; i < params.length; i++) {
      const prm = params[i]!
      const n = prm[0]! < 0 ? 0 : prm[0]!
      if (n === 38 || n === 48 || n === 58) {
        // 38;5;n — 38;2;r;g;b — or the same with colons: 38:5:n, 38:2::r:g:b.
        let color: number | null = null
        if (prm.length > 1) {
          const sub = prm.slice(1)
          if (sub[0] === 5) color = PALETTE | clamp(sub[1] ?? 0, 255)
          else if (sub[0] === 2) {
            const rgb = sub.length >= 5 ? sub.slice(2, 5) : sub.slice(1, 4)
            color = RGB | (clamp(rgb[0] ?? 0, 255) << 16) | (clamp(rgb[1] ?? 0, 255) << 8) | clamp(rgb[2] ?? 0, 255)
          }
        } else {
          const kind = params[i + 1]?.[0]
          if (kind === 5) {
            color = PALETTE | clamp(params[i + 2]?.[0] ?? 0, 255)
            i += 2
          } else if (kind === 2) {
            color = RGB | (clamp(params[i + 2]?.[0] ?? 0, 255) << 16) | (clamp(params[i + 3]?.[0] ?? 0, 255) << 8) | clamp(params[i + 4]?.[0] ?? 0, 255)
            i += 4
          }
        }
        if (color !== null && n === 38) a.fg = color
        else if (color !== null && n === 48) a.bg = color
        continue
      }
      if (n === 0) {
        a.fg = a.bg = a.flags = 0
      } else if (n === 1) a.flags |= BOLD
      else if (n === 2) a.flags |= DIM
      else if (n === 3) a.flags |= ITALIC
      else if (n === 4) {
        const style = prm[1] ?? 1
        a.flags &= ~(UNDERLINE | DOUBLE_UNDERLINE | CURLY_UNDERLINE)
        if (style === 2) a.flags |= DOUBLE_UNDERLINE
        else if (style === 3) a.flags |= CURLY_UNDERLINE
        else if (style !== 0) a.flags |= UNDERLINE
      } else if (n === 5 || n === 6) a.flags |= BLINK
      else if (n === 7) a.flags |= INVERSE
      else if (n === 8) a.flags |= HIDDEN
      else if (n === 9) a.flags |= STRIKE
      else if (n === 21) a.flags |= DOUBLE_UNDERLINE
      else if (n === 22) a.flags &= ~(BOLD | DIM)
      else if (n === 23) a.flags &= ~ITALIC
      else if (n === 24) a.flags &= ~(UNDERLINE | DOUBLE_UNDERLINE | CURLY_UNDERLINE)
      else if (n === 25) a.flags &= ~BLINK
      else if (n === 27) a.flags &= ~INVERSE
      else if (n === 28) a.flags &= ~HIDDEN
      else if (n === 29) a.flags &= ~STRIKE
      else if (n >= 30 && n <= 37) a.fg = PALETTE | (n - 30)
      else if (n === 39) a.fg = 0
      else if (n >= 40 && n <= 47) a.bg = PALETTE | (n - 40)
      else if (n === 49) a.bg = 0
      else if (n === 53) a.flags |= OVERLINE
      else if (n === 55) a.flags &= ~OVERLINE
      else if (n >= 90 && n <= 97) a.fg = PALETTE | (n - 90 + 8)
      else if (n >= 100 && n <= 107) a.bg = PALETTE | (n - 100 + 8)
    }
  }

  // Moving and scrolling ----------------------------------------------------------------

  private moveTo(x: number, y: number): void {
    const b = this.buffer
    const minY = this.originMode ? b.top : 0
    const maxY = this.originMode ? b.bottom : this.rows - 1
    b.x = Math.max(0, Math.min(x, this.cols - 1))
    b.y = Math.max(minY, Math.min(y, maxY))
    this.wrapNext = false
  }

  private tabForward(n: number): void {
    const b = this.buffer
    for (; n > 0; n--) {
      let x = b.x + 1
      while (x < this.cols - 1 && !this.tabs.has(x)) x++
      b.x = Math.min(x, this.cols - 1)
    }
  }

  /** Down a row; at the bottom of the scrolling region, the region scrolls. */
  private lineFeed(): void {
    const b = this.buffer
    this.wrapNext = false
    if (b.y === b.bottom) this.scrollUpAt(b.top, 1, true)
    else if (b.y < this.rows - 1) b.y++
  }

  private reverseIndex(): void {
    const b = this.buffer
    this.wrapNext = false
    if (b.y === b.top) this.scrollDownAt(b.top, 1)
    else if (b.y > 0) b.y--
  }

  /**
   * Scroll the rows from `at` to the region's bottom up by `n`. When the region
   * is the whole normal screen, the rows that leave the top go to the scrollback.
   */
  private scrollUpAt(at: number, n: number, keep: boolean): void {
    const b = this.buffer
    n = Math.min(n, b.bottom - at + 1)
    if (n <= 0) return
    const blank = (): Line => new Line(this.cols, this.eraseAttr())
    if (keep && b.scrollback && at === 0 && b.top === 0 && b.bottom === this.rows - 1) {
      for (let i = 0; i < n; i++) b.lines.push(blank())
      const extra = b.lines.length - this.rows - this.maxScrollback
      if (extra > 0) {
        b.lines.splice(0, extra)
        this.trimmed += extra
        if (this.commands.length && this.commands[0]!.prompt < this.trimmed) this.commands = this.commands.filter((c) => c.prompt >= this.trimmed)
      }
      return
    }
    // The base before the splices: they change the length it is counted from.
    const base = b.base
    b.lines.splice(base + at, n)
    b.lines.splice(base + b.bottom - n + 1, 0, ...Array.from({ length: n }, blank))
  }

  private scrollDownAt(at: number, n: number): void {
    const b = this.buffer
    n = Math.min(n, b.bottom - at + 1)
    if (n <= 0) return
    const base = b.base
    b.lines.splice(base + b.bottom - n + 1, n)
    b.lines.splice(base + at, 0, ...Array.from({ length: n }, () => new Line(this.cols, this.eraseAttr())))
  }

  private eraseDisplay(mode: number): void {
    const b = this.buffer
    const attr = this.eraseAttr()
    if (mode === 0) {
      this.eraseLine(0)
      for (let y = b.y + 1; y < this.rows; y++) this.clearRow(y, attr)
    } else if (mode === 1) {
      this.eraseLine(1)
      for (let y = 0; y < b.y; y++) this.clearRow(y, attr)
    } else if (mode === 2) {
      for (let y = 0; y < this.rows; y++) this.clearRow(y, attr)
    } else if (mode === 3 && b.scrollback) {
      // The scrollback goes; the screen stays.
      const removed = b.base
      b.lines.splice(0, removed)
      this.trimmed += removed
    }
  }

  private clearRow(y: number, attr: Attr): void {
    const line = this.buffer.row(y)
    line.fill(0, this.cols, attr)
    line.wrapped = false
  }

  private eraseLine(mode: number): void {
    const b = this.buffer
    const line = b.row(b.y)
    const attr = this.eraseAttr()
    if (mode === 0) {
      line.fill(b.x, this.cols, attr)
      line.wrapped = false
    } else if (mode === 1) line.fill(0, b.x + 1, attr)
    else if (mode === 2) {
      line.fill(0, this.cols, attr)
      line.wrapped = false
    }
    this.wrapNext = false
  }

  // Resizing ----------------------------------------------------------------------------

  /** A new size. The normal screen's rows are wrapped again to the new width; the alternate one is cut or padded. */
  resize(cols: number, rows: number): void {
    cols = Math.max(2, Math.floor(cols))
    rows = Math.max(1, Math.floor(rows))
    if (cols === this.cols && rows === this.rows) return
    this.reflow(this.normal, cols, rows)
    this.fit(this.alt, cols, rows)
    this.cols = cols
    this.rows = rows
    for (const b of [this.normal, this.alt]) {
      b.cols = cols
      b.rows = rows
      b.top = 0
      b.bottom = rows - 1
    }
    this.wrapNext = false
    this.resetTabs()
    for (const l of this.changeListeners) l()
  }

  private fit(b: ScreenBuffer, cols: number, rows: number): void {
    for (const line of b.lines) line.resize(cols)
    while (b.lines.length < rows) b.lines.push(new Line(cols))
    if (b.lines.length > rows) {
      // Rows cut from the bottom first, the cursor kept on the screen.
      const below = b.lines.length - 1 - b.y
      const cut = Math.min(b.lines.length - rows, below)
      b.lines.splice(b.lines.length - cut, cut)
      const more = b.lines.length - rows
      if (more > 0) {
        b.lines.splice(0, more)
        b.y -= more
      }
    }
    b.x = Math.min(b.x, cols - 1)
    b.y = Math.max(0, Math.min(b.y, rows - 1))
  }

  private reflow(b: ScreenBuffer, cols: number, rows: number): void {
    const cursorRow = b.base + b.y
    // Blank rows below the cursor are not content: dropped, so the text does not climb.
    let last = b.lines.length - 1
    while (last > cursorRow && b.lines[last]!.length() === 0 && !b.lines[last]!.wrapped) last--
    const lines = b.lines.slice(0, last + 1)

    // Logical lines: rows joined where they wrapped.
    const out: Line[] = []
    // Each old row's new place (its logical line's first row): for the commands' marks.
    const moved = new Map<number, number>()
    let newCursorRow = 0
    let newCursorX = 0
    for (let i = 0; i < lines.length; ) {
      const group: Line[] = [lines[i]!]
      while (lines[i]!.wrapped && i + 1 < lines.length) group.push(lines[++i]!)
      const groupStart = i - group.length + 1
      i++
      // The cells of the logical line, up to the end of its text.
      const cells: { line: Line; x: number }[] = []
      group.forEach((l, k) => {
        const end = k === group.length - 1 ? l.length() : l.cols
        for (let x = 0; x < end; x++) {
          // A blank cell left where a wide character did not fit: not content.
          if (k < group.length - 1 && x === l.cols - 1 && l.isBlank(x) && group[k + 1]!.width(0) === 2) continue
          cells.push({ line: l, x })
        }
      })
      // Where the cursor falls, if it is on this logical line.
      let cursorAt = -1
      if (cursorRow >= groupStart && cursorRow < groupStart + group.length) {
        const k = cursorRow - groupStart
        let before = 0
        for (let j = 0; j < k; j++) before += group[j]!.cols
        cursorAt = before + b.x
      }
      // Laid out again to the new width.
      const first = out.length
      for (let k = 0; k < group.length; k++) moved.set(groupStart + k, first)
      let row = new Line(cols)
      let x = 0
      for (let c = 0; c < cells.length; c++) {
        const { line, x: from } = cells[c]!
        const w = line.width(from)
        if (w === 0) continue
        if (x + w > cols) {
          row.wrapped = true
          out.push(row)
          row = new Line(cols)
          x = 0
        }
        line.copyTo(row, from, from + w, x)
        x += w
      }
      out.push(row)
      if (cursorAt >= 0) {
        newCursorRow = first + Math.floor(cursorAt / cols)
        newCursorX = cursorAt % cols
        while (out.length <= newCursorRow) out.push(new Line(cols))
      }
    }
    while (out.length < rows) out.push(new Line(cols))
    // The screen: the last `rows` rows, but always with the cursor on it.
    let base = Math.max(0, out.length - rows)
    if (newCursorRow < base) base = newCursorRow
    // Rows past the screen's bottom (the cursor high up after a shrink): dropped.
    out.length = base + rows
    const extra = base - this.maxScrollback
    if (extra > 0) {
      out.splice(0, extra)
      this.trimmed += extra
      newCursorRow -= extra
      base -= extra
    }
    b.lines = out
    b.x = Math.min(newCursorX, cols - 1)
    b.y = newCursorRow - base
    if (b === this.normal && this.commands.length) {
      const before = this.trimmed - Math.max(0, extra)
      const place = (row: number | undefined): number | undefined => {
        if (row === undefined) return undefined
        const old = row - before
        const next = moved.get(old) ?? (old > last ? moved.get(last) ?? old : old)
        return next - Math.max(0, extra) + this.trimmed
      }
      this.commands = this.commands
        .map((c) => ({ ...c, prompt: place(c.prompt)!, input: place(c.input), output: place(c.output), end: place(c.end) }))
        .filter((c) => c.prompt >= this.trimmed)
    }
  }
}

function on<T>(list: Listener<T>[], listener: Listener<T>): () => void {
  list.push(listener)
  return () => {
    const i = list.indexOf(listener)
    if (i >= 0) list.splice(i, 1)
  }
}

function clamp(n: number, max: number): number {
  return Math.max(0, Math.min(max, n < 0 ? 0 : n))
}

/** `#rrggbb` as X11 writes a colour: `rgb:rrrr/gggg/bbbb`. */
function xColor(hex: string): string {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex) ?? ['', '00', '00', '00']
  return `rgb:${m[1]}${m[1]}/${m[2]}${m[2]}/${m[3]}${m[3]}`
}

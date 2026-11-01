/**
 * The terminal drawn in an element: the rows in view only (the scrollback is
 * a scroll of its own height, the rows placed where they fall), each row as
 * runs of text in their colours; the cursor over them; a selection made with
 * the mouse; keys, input methods, pasting and the mouse turned into what the
 * program reads. The element's size gives the columns and rows (`fit`).
 */
import { keySequence, mouseSequence } from './input'
import { BLINK, BOLD, COLOR_KIND, CURLY_UNDERLINE, DIM, DOUBLE_UNDERLINE, HIDDEN, INVERSE, ITALIC, LINK_SHIFT, OVERLINE, PALETTE, RGB, STRIKE, UNDERLINE, type Line } from './line'
import type { Terminal } from './terminal'

export interface TerminalTheme {
  foreground: string
  background: string
  cursor: string
  selection: string
  /** The 16 colours: black, red, green, yellow, blue, magenta, cyan, white, then their bright forms. */
  ansi: string[]
}

export const LIGHT_THEME: TerminalTheme = {
  foreground: '#1f2328',
  background: '#ffffff',
  cursor: '#1f2328',
  selection: 'rgba(9, 105, 218, 0.25)',
  ansi: ['#24292f', '#cf222e', '#116329', '#4d2d00', '#0969da', '#8250df', '#1b7c83', '#6e7781', '#57606a', '#a40e26', '#1a7f37', '#633c01', '#218bff', '#a475f9', '#3192aa', '#8c959f'],
}

export const DARK_THEME: TerminalTheme = {
  foreground: '#e6edf3',
  background: '#0d1117',
  cursor: '#e6edf3',
  selection: 'rgba(56, 139, 253, 0.35)',
  ansi: ['#484f58', '#ff7b72', '#3fb950', '#d29922', '#58a6ff', '#bc8cff', '#39c5cf', '#b1bac4', '#6e7681', '#ffa198', '#56d364', '#e3b341', '#79c0ff', '#d2a8ff', '#56d4dd', '#ffffff'],
}

export interface TerminalViewOptions {
  fontFamily?: string
  /** In pixels (13). */
  fontSize?: number
  /** A row's height as a multiple of the font size (1.25). */
  lineHeight?: number
  theme?: TerminalTheme
  /** Option (Alt) sends ESC before the key; off on a Mac by default, where Option types characters. */
  altIsMeta?: boolean
  /** A link clicked with Cmd (Ctrl): open it — the host decides how. */
  onLink?: (url: string) => void
  /** The size changed (`fit`): the pseudo-terminal behind should change too. */
  onResize?: (cols: number, rows: number) => void
}

const CSS = `
.dsk-term { position: relative; overflow-y: auto; overflow-x: hidden; box-sizing: border-box; height: 100%; padding: 4px 8px; background: var(--dsk-term-bg); color: var(--dsk-term-fg); cursor: text; outline: none; }
.dsk-term.reverse { background: var(--dsk-term-fg); color: var(--dsk-term-bg); }
.dsk-term-rows { position: absolute; left: 8px; right: 8px; top: 0; }
.dsk-term-row { white-space: pre; overflow: hidden; }
.dsk-term-row span { white-space: pre; }
.dsk-term-wide { display: inline-block; text-align: center; overflow: visible; }
.dsk-term-cursor { position: absolute; pointer-events: none; box-sizing: border-box; }
.dsk-term-cursor.block { background: var(--dsk-term-cursor); color: var(--dsk-term-bg); white-space: pre; text-align: center; }
.dsk-term-cursor.underline { border-bottom: 2px solid var(--dsk-term-cursor); }
.dsk-term-cursor.bar { border-left: 2px solid var(--dsk-term-cursor); }
.dsk-term:not(.focused) .dsk-term-cursor.block { background: transparent; color: inherit; outline: 1px solid var(--dsk-term-cursor); outline-offset: -1px; }
.dsk-term.focused .dsk-term-cursor.blink { animation: dsk-term-blink 1.06s step-end infinite; }
@keyframes dsk-term-blink { 50% { opacity: 0; } }
.dsk-term-sel { position: absolute; pointer-events: none; background: var(--dsk-term-selection); }
.dsk-term-input { position: absolute; width: 1px; height: 1px; padding: 0; border: 0; margin: 0; opacity: 0; resize: none; overflow: hidden; white-space: pre; z-index: -1; }
.dsk-term-link { text-decoration: underline; cursor: pointer; }
.dsk-term.bell { animation: dsk-term-bell 0.2s; }
@keyframes dsk-term-bell { from { filter: brightness(1.6); } }
.dsk-term-blink { animation: dsk-term-blink 1s step-end infinite; }
`

let styled = false
function addStyle(): void {
  if (styled || typeof document === 'undefined') return
  styled = true
  const style = document.createElement('style')
  style.dataset.dskTerminal = ''
  style.textContent = CSS
  document.head.prepend(style)
}

/** The 256-colour palette past the first 16: a 6×6×6 cube, then 24 greys. */
function palette256(n: number): string {
  if (n >= 232) {
    const v = 8 + (n - 232) * 10
    return `rgb(${v},${v},${v})`
  }
  const i = n - 16
  const level = (k: number): number => (k === 0 ? 0 : 55 + k * 40)
  return `rgb(${level(Math.floor(i / 36))},${level(Math.floor(i / 6) % 6)},${level(i % 6)})`
}

function colorCss(c: number, bright: boolean): string | null {
  const kind = c & COLOR_KIND
  if (kind === PALETTE) {
    let n = c & 0xff
    if (bright && n < 8) n += 8
    return n < 16 ? `var(--dsk-term-${n})` : palette256(n)
  }
  if (kind === RGB) return `#${(c & 0xffffff).toString(16).padStart(6, '0')}`
  return null
}

const escapeHtml = (s: string): string => s.replace(/[&<>"]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;'))

/** Web addresses in a row's text, found as a terminal finds them. */
const URL_RE = /\b(?:https?|ftp|file):\/\/[^\s"'<>`]*[^\s"'<>`.,;:!?)\]}]/g

interface Point {
  /** A row by its number since the start (scrollback trimmed counted): stable while the scrollback is cut. */
  row: number
  col: number
}

export class TerminalView {
  readonly element: HTMLElement
  private readonly rowsEl: HTMLElement
  private readonly spacer: HTMLElement
  private readonly cursorEl: HTMLElement
  private readonly selLayer: HTMLElement
  private readonly input: HTMLTextAreaElement
  private cellW = 8
  private rowH = 16
  private readonly o: Required<Pick<TerminalViewOptions, 'fontFamily' | 'fontSize' | 'lineHeight'>> & TerminalViewOptions
  private drawn: string[] = []
  private first = -1
  private pending = false
  private atBottom = true
  private trimmed: number
  private composing = false
  private anchor: Point | null = null
  private head: Point | null = null
  private selecting = false
  private mouseButton = -1
  private readonly off: (() => void)[] = []
  private readonly observer: ResizeObserver

  constructor(
    readonly term: Terminal,
    host: HTMLElement,
    options: TerminalViewOptions = {},
  ) {
    addStyle()
    this.o = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace', fontSize: 13, lineHeight: 1.25, ...options }
    this.trimmed = term.trimmed
    this.element = document.createElement('div')
    this.element.className = 'dsk-term'
    this.element.setAttribute('role', 'log')
    this.element.style.font = `${this.o.fontSize}px ${this.o.fontFamily}`
    this.setTheme(this.o.theme ?? LIGHT_THEME)
    this.spacer = document.createElement('div')
    this.rowsEl = document.createElement('div')
    this.rowsEl.className = 'dsk-term-rows'
    this.selLayer = document.createElement('div')
    this.cursorEl = document.createElement('div')
    this.cursorEl.className = 'dsk-term-cursor'
    this.input = document.createElement('textarea')
    this.input.className = 'dsk-term-input'
    this.input.setAttribute('autocapitalize', 'off')
    this.input.setAttribute('autocomplete', 'off')
    this.input.setAttribute('autocorrect', 'off')
    this.input.spellcheck = false
    this.input.setAttribute('aria-label', 'Terminal input')
    this.rowsEl.append(this.selLayer, this.cursorEl)
    this.element.append(this.spacer, this.rowsEl, this.input)
    host.append(this.element)
    this.measure()

    this.off.push(term.onChange(() => this.schedule()))
    this.off.push(term.onBell(() => this.bell()))
    this.listen()
    this.observer = new ResizeObserver(() => this.fit())
    this.observer.observe(this.element)
    this.fit()
    this.render()
  }

  // Public ------------------------------------------------------------------------------

  focus(): void {
    this.input.focus({ preventScroll: true })
  }

  setTheme(theme: TerminalTheme): void {
    const s = this.element.style
    s.setProperty('--dsk-term-fg', theme.foreground)
    s.setProperty('--dsk-term-bg', theme.background)
    s.setProperty('--dsk-term-cursor', theme.cursor)
    s.setProperty('--dsk-term-selection', theme.selection)
    theme.ansi.forEach((c, i) => s.setProperty(`--dsk-term-${i}`, c))
  }

  /** The columns and rows the element holds; the terminal (and `onResize`) told when they change. */
  fit(): { cols: number; rows: number } {
    this.measure()
    const style = getComputedStyle(this.element)
    const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
    const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
    const scrollbar = this.element.offsetWidth - this.element.clientWidth
    const cols = Math.max(2, Math.floor((this.element.clientWidth - padX - Math.max(0, 12 - scrollbar)) / this.cellW))
    const rows = Math.max(1, Math.floor((this.element.clientHeight - padY) / this.rowH))
    if (this.element.clientWidth > 0 && (cols !== this.term.cols || rows !== this.term.rows)) {
      this.term.resize(cols, rows)
      this.o.onResize?.(cols, rows)
    }
    this.schedule()
    return { cols: this.term.cols, rows: this.term.rows }
  }

  /** The selected text (rows that wrapped joined without a line break). */
  getSelection(): string {
    const range = this.range()
    if (!range) return ''
    const [a, b] = range
    const out: string[] = []
    for (let r = a.row; r <= b.row; r++) {
      const line = this.lineAt(r)
      if (!line) continue
      const from = r === a.row ? a.col : 0
      const to = r === b.row ? b.col : this.term.cols
      out.push(line.text(from, to, r !== b.row || to >= line.length()))
      if (r < b.row && !line.wrapped) out.push('\n')
    }
    return out.join('')
  }

  hasSelection(): boolean {
    return this.range() !== null
  }

  clearSelection(): void {
    this.anchor = this.head = null
    this.schedule()
  }

  selectAll(): void {
    this.anchor = { row: this.trimmed, col: 0 }
    this.head = { row: this.trimmed + this.term.buffer.lines.length - 1, col: this.term.cols }
    this.schedule()
  }

  scrollToBottom(): void {
    this.atBottom = true
    this.element.scrollTop = this.element.scrollHeight
    this.schedule()
  }

  dispose(): void {
    for (const f of this.off) f()
    this.observer.disconnect()
    this.element.remove()
  }

  // Drawing -----------------------------------------------------------------------------

  private measure(): void {
    const probe = document.createElement('span')
    probe.textContent = 'W'.repeat(40)
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre'
    this.element.append(probe)
    const w = probe.getBoundingClientRect().width / 40
    probe.remove()
    this.cellW = w > 0 ? w : this.o.fontSize * 0.6
    this.rowH = Math.round(this.o.fontSize * this.o.lineHeight)
    this.rowsEl.style.lineHeight = `${this.rowH}px`
  }

  private schedule(): void {
    if (this.pending) return
    this.pending = true
    requestAnimationFrame(() => {
      this.pending = false
      this.render()
    })
  }

  private lineAt(row: number): Line | undefined {
    return this.term.buffer.lines[row - this.term.trimmed]
  }

  private render(): void {
    const term = this.term
    const b = term.buffer
    const total = b.lines.length
    // The scrollback was cut at the top: what is in view stays in view.
    const cut = term.trimmed - this.trimmed
    this.trimmed = term.trimmed
    if (cut > 0 && !this.atBottom) this.element.scrollTop = Math.max(0, this.element.scrollTop - cut * this.rowH)
    const style = getComputedStyle(this.element)
    this.spacer.style.height = `${total * this.rowH}px`
    if (this.atBottom) this.element.scrollTop = this.element.scrollHeight
    const visible = Math.ceil(this.element.clientHeight / this.rowH) + 1
    // The scroll position may still be the old one (the buffer just shrank): never past the rows there are.
    const top = Math.max(0, Math.min(Math.floor((this.element.scrollTop - parseFloat(style.paddingTop)) / this.rowH), total - visible + 1))
    const count = Math.max(0, Math.min(total - top, visible))
    if (top !== this.first) {
      this.first = top
      this.drawn = []
    }
    this.rowsEl.style.top = `${parseFloat(style.paddingTop) + top * this.rowH}px`
    this.element.classList.toggle('reverse', term.reverseVideo)

    // The rows: replaced only when their markup changed.
    const rowEls = this.rowsEl.querySelectorAll<HTMLElement>(':scope > .dsk-term-row')
    for (let i = 0; i < count; i++) {
      const html = this.rowHtml(b.lines[top + i]!)
      let el = rowEls[i]
      if (!el) {
        el = document.createElement('div')
        el.className = 'dsk-term-row'
        el.style.height = `${this.rowH}px`
        this.rowsEl.insertBefore(el, this.selLayer)
      }
      el.style.height = `${this.rowH}px`
      if (this.drawn[i] !== html) {
        el.innerHTML = html
        this.drawn[i] = html
      }
    }
    for (let i = count; i < rowEls.length; i++) rowEls[i]!.remove()
    this.drawn.length = count

    // The cursor, where it is in view.
    const cy = b.base + b.y - top
    const show = term.cursorVisible && cy >= 0 && cy < count && !(b === term.normal && b.base + b.y >= total)
    this.cursorEl.hidden = !show
    if (show) {
      const line = b.row(b.y)
      const wide = line.width(b.x) === 2
      this.cursorEl.className = `dsk-term-cursor ${term.cursorStyle}${term.cursorBlink ? ' blink' : ''}`
      Object.assign(this.cursorEl.style, { left: `${b.x * this.cellW}px`, top: `${cy * this.rowH}px`, width: `${this.cellW * (wide ? 2 : 1)}px`, height: `${this.rowH}px` })
      this.cursorEl.textContent = term.cursorStyle === 'block' ? line.char(b.x) || ' ' : ''
      // The input field at the cursor: an input method's window opens there.
      Object.assign(this.input.style, { left: `${8 + b.x * this.cellW}px`, top: `${parseFloat(style.paddingTop) + (b.base + b.y) * this.rowH}px` })
    }
    this.drawSelection(top, count)
  }

  private rowHtml(line: Line): string {
    let html = ''
    let run = ''
    let key = -1
    let style = ''
    let link = 0
    const flush = (): void => {
      if (run === '') return
      const text = escapeHtml(run)
      html += style || link ? `<span${style ? ` style="${style}"` : ''}${link ? ` class="dsk-term-link" data-link="${link}"` : ''}>${text}</span>` : text
      run = ''
    }
    for (let x = 0; x < line.cols; x++) {
      const w = line.width(x)
      if (w === 0) continue
      const fg = line.fg(x)
      const bg = line.bg(x)
      const flags = line.flags(x)
      const k = fg * 31 + bg * 17 + flags
      if (k !== key || w === 2) {
        flush()
        key = w === 2 ? -1 : k
        style = this.styleOf(fg, bg, flags)
        link = flags >>> LINK_SHIFT
      }
      const ch = line.char(x)
      if (w === 2) {
        // A wide character in a box of two cells: fonts do not all draw it that wide.
        html += `<span class="dsk-term-wide" style="width:${this.cellW * 2}px;${style}">${escapeHtml(ch)}</span>`
        key = -1
      } else run += ch
    }
    flush()
    return this.withLinks(html, line)
  }

  /** Addresses in plain text made links (OSC 8 links are marked already). */
  private withLinks(html: string, line: Line): string {
    if (!this.o.onLink) return html
    const text = line.text()
    if (!/:\/\//.test(text)) return html
    // Only where the row is plain text around the address: a run in one style.
    return html.replace(URL_RE, (url) => `<span class="dsk-term-link" data-url="${url}">${url}</span>`)
  }

  private styleOf(fg: number, bg: number, flags: number): string {
    let f = colorCss(fg, (flags & BOLD) !== 0)
    let b = colorCss(bg, false)
    if (flags & INVERSE) {
      ;[f, b] = [b ?? 'var(--dsk-term-bg)', f ?? 'var(--dsk-term-fg)']
    }
    const parts: string[] = []
    if (f) parts.push(`color:${f}`)
    if (b) parts.push(`background:${b}`)
    if (flags & BOLD) parts.push('font-weight:bold')
    if (flags & DIM) parts.push('opacity:.6')
    if (flags & ITALIC) parts.push('font-style:italic')
    const lines: string[] = []
    if (flags & (UNDERLINE | DOUBLE_UNDERLINE | CURLY_UNDERLINE)) lines.push('underline')
    if (flags & STRIKE) lines.push('line-through')
    if (flags & OVERLINE) lines.push('overline')
    if (lines.length) parts.push(`text-decoration:${lines.join(' ')}${flags & DOUBLE_UNDERLINE ? ' double' : flags & CURLY_UNDERLINE ? ' wavy' : ''}`)
    if (flags & HIDDEN) parts.push('color:transparent')
    if (flags & BLINK) parts.push('animation:dsk-term-blink 1s step-end infinite')
    return parts.join(';')
  }

  // Selection ----------------------------------------------------------------------------

  /** The selection, start before end; null when there is none. */
  private range(): [Point, Point] | null {
    if (!this.anchor || !this.head) return null
    const [a, b] = this.anchor.row < this.head.row || (this.anchor.row === this.head.row && this.anchor.col <= this.head.col) ? [this.anchor, this.head] : [this.head, this.anchor]
    if (a.row === b.row && a.col === b.col) return null
    return [a, b]
  }

  private drawSelection(top: number, count: number): void {
    const range = this.range()
    this.selLayer.replaceChildren()
    if (!range) return
    const [a, b] = range
    for (let i = 0; i < count; i++) {
      const row = top + i + this.term.trimmed
      if (row < a.row || row > b.row) continue
      const from = row === a.row ? a.col : 0
      const to = row === b.row ? b.col : this.term.cols
      if (to <= from) continue
      const d = document.createElement('div')
      d.className = 'dsk-term-sel'
      Object.assign(d.style, { left: `${from * this.cellW}px`, top: `${i * this.rowH}px`, width: `${(to - from) * this.cellW}px`, height: `${this.rowH}px` })
      this.selLayer.append(d)
    }
  }

  /** The cell under a point of the window. */
  private cellAt(clientX: number, clientY: number): Point {
    const r = this.rowsEl.getBoundingClientRect()
    const col = Math.max(0, Math.min(this.term.cols, Math.round((clientX - r.left) / this.cellW - 0.25)))
    const index = Math.max(0, Math.min(this.term.buffer.lines.length - 1, this.first + Math.floor((clientY - r.top) / this.rowH)))
    return { row: index + this.term.trimmed, col }
  }

  private wordAt(p: Point): [number, number] {
    const line = this.lineAt(p.row)
    if (!line) return [p.col, p.col]
    const word = (x: number): boolean => /[\p{L}\p{N}_\-./~:@]/u.test(line.char(x))
    let s = Math.min(p.col, this.term.cols - 1)
    let e = s
    if (!word(s)) return [s, s + 1]
    while (s > 0 && word(s - 1)) s--
    while (e < this.term.cols && word(e)) e++
    return [s, e]
  }

  // Input ----------------------------------------------------------------------------------

  private send(data: string): void {
    this.clearSelection()
    this.scrollToBottom()
    this.term.input(data)
  }

  private copy(): boolean {
    const text = this.getSelection()
    if (!text) return false
    void navigator.clipboard?.writeText(text).catch(() => undefined)
    return true
  }

  private listen(): void {
    const el = this.element
    const input = this.input
    const add = <K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      target.addEventListener(type, fn as EventListener, opts)
      this.off.push(() => target.removeEventListener(type, fn as EventListener, opts))
    }
    const mac = /Mac|iPhone|iPad/.test(navigator.platform)

    add(input, 'keydown', (e) => {
      if (this.composing || e.isComposing) return
      const copyKey = mac ? e.metaKey && e.key === 'c' : e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')
      if (copyKey) {
        if (this.copy()) e.preventDefault()
        return
      }
      if (mac ? e.metaKey && e.key === 'a' : e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        e.preventDefault()
        this.selectAll()
        return
      }
      const seq = keySequence(e, { applicationCursor: this.term.applicationCursor, altIsMeta: this.o.altIsMeta ?? !mac })
      if (seq === null) return
      e.preventDefault()
      this.send(seq)
    })
    add(input, 'compositionstart', () => (this.composing = true))
    add(input, 'compositionend', (e) => {
      this.composing = false
      if (e.data) this.send(e.data)
      input.value = ''
    })
    add(input, 'input', (e) => {
      if (this.composing || (e as InputEvent).isComposing) return
      const value = input.value
      input.value = ''
      if (value) this.send(value.replace(/\n/g, '\r'))
    })
    add(input, 'paste', (e) => {
      e.preventDefault()
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (text) {
        this.clearSelection()
        this.scrollToBottom()
        this.term.paste(text)
      }
    })
    add(input, 'focus', () => {
      el.classList.add('focused')
      if (this.term.focusEvents) this.term.input('\x1b[I')
    })
    add(input, 'blur', () => {
      el.classList.remove('focused')
      if (this.term.focusEvents) this.term.input('\x1b[O')
    })

    add(el, 'scroll', () => {
      this.atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2
      this.schedule()
    })

    const tracking = (e: MouseEvent): boolean => this.term.mouseTracking !== 'none' && !e.shiftKey
    const report = (kind: 'down' | 'up' | 'move' | 'wheel', button: number, e: MouseEvent): void => {
      const p = this.cellAt(e.clientX, e.clientY)
      const row = p.row - this.term.trimmed - this.term.buffer.base
      if (row < 0 || row >= this.term.rows) return
      this.term.input(mouseSequence(kind, button, Math.min(p.col, this.term.cols - 1), row, { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey }, this.term.mouseSgr))
    }

    add(el, 'mousedown', (e) => {
      // Keep the focus in the input field; the selection is drawn by the view.
      e.preventDefault()
      this.focus()
      const target = e.target as HTMLElement
      const link = target.closest<HTMLElement>('.dsk-term-link')
      if (link && (mac ? e.metaKey : e.ctrlKey) && this.o.onLink) {
        const url = link.dataset.url ?? this.term.links[Number(link.dataset.link)] ?? ''
        if (url) this.o.onLink(url)
        return
      }
      if (tracking(e)) {
        this.mouseButton = e.button
        report('down', e.button, e)
        return
      }
      if (e.button !== 0) return
      const p = this.cellAt(e.clientX, e.clientY)
      if (e.detail === 2) {
        const [s, end] = this.wordAt(p)
        this.anchor = { row: p.row, col: s }
        this.head = { row: p.row, col: end }
      } else if (e.detail >= 3) {
        this.anchor = { row: p.row, col: 0 }
        this.head = { row: p.row, col: this.term.cols }
      } else if (e.shiftKey && this.anchor) this.head = p
      else {
        this.anchor = p
        this.head = p
      }
      this.selecting = true
      this.schedule()
    })
    const move = (e: MouseEvent): void => {
      if (this.mouseButton >= 0 && (this.term.mouseTracking === 'drag' || this.term.mouseTracking === 'any')) report('move', this.mouseButton, e)
      else if (this.mouseButton < 0 && this.term.mouseTracking === 'any' && el.contains(e.target as Node)) report('move', 3, e)
      if (!this.selecting) return
      this.head = this.cellAt(e.clientX, e.clientY)
      this.schedule()
    }
    const up = (e: MouseEvent): void => {
      if (this.mouseButton >= 0) {
        report('up', this.mouseButton, e)
        this.mouseButton = -1
      }
      this.selecting = false
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
    this.off.push(() => document.removeEventListener('mousemove', move), () => document.removeEventListener('mouseup', up))

    add(
      el,
      'wheel',
      (e) => {
        if (tracking(e)) {
          e.preventDefault()
          report('wheel', e.deltaY < 0 ? 0 : 1, e)
          return
        }
        // A full-screen program has no scrollback: the wheel scrolls it by its arrows.
        if (this.term.buffer === this.term.alt && !e.shiftKey) {
          e.preventDefault()
          const lines = Math.max(1, Math.round(Math.abs(e.deltaY) / this.rowH))
          const arrow = e.deltaY < 0 ? 'A' : 'B'
          this.term.input(`${this.term.applicationCursor ? '\x1bO' : '\x1b['}${arrow}`.repeat(Math.min(lines, 10)))
        }
      },
      { passive: false },
    )
    add(el, 'contextmenu', (e) => {
      if (tracking(e)) e.preventDefault()
    })
  }

  private bell(): void {
    this.element.classList.remove('bell')
    void this.element.offsetWidth
    this.element.classList.add('bell')
  }
}

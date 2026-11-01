/**
 * Keys as a program reads them: arrows and function keys as the xterm family
 * sends them (with the application cursor mode, and modifiers as `1;5`),
 * Ctrl with a letter as a control character — by the key's place, so Ctrl+C
 * is ^C in any layout — and Alt as an ESC before the key.
 */

export interface KeyLike {
  key: string
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

export interface KeyModes {
  applicationCursor: boolean
  /** Alt (Option on a Mac) sends ESC before the key, rather than the character the layout gives. */
  altIsMeta: boolean
}

const CURSOR: Record<string, string> = { ArrowUp: 'A', ArrowDown: 'B', ArrowRight: 'C', ArrowLeft: 'D', Home: 'H', End: 'F' }
const TILDE: Record<string, number> = { Insert: 2, Delete: 3, PageUp: 5, PageDown: 6, F5: 15, F6: 17, F7: 18, F8: 19, F9: 20, F10: 21, F11: 23, F12: 24 }
const SS3: Record<string, string> = { F1: 'P', F2: 'Q', F3: 'R', F4: 'S' }

/** xterm's modifier parameter: 1 + Shift 1 + Alt 2 + Ctrl 4. */
function modifier(e: KeyLike): number {
  return 1 + (e.shiftKey ? 1 : 0) + (e.altKey ? 2 : 0) + (e.ctrlKey ? 4 : 0)
}

/** The letter or sign of a key by its place (`KeyC` → `c`), whatever the layout prints. */
function physical(e: KeyLike): string | null {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase()
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5)
  const signs: Record<string, string> = { BracketLeft: '[', BracketRight: ']', Backslash: '\\', Slash: '/', Minus: '-', Equal: '=', Space: ' ', Backquote: '`' }
  return signs[e.code] ?? null
}

/**
 * The sequence for a key, or null when the key is not the terminal's (a
 * printable character — it comes through the text input, so layouts and
 * input methods work — or a shortcut of the application, Cmd on a Mac).
 */
export function keySequence(e: KeyLike, m: KeyModes): string | null {
  if (e.metaKey) return null
  const mod = modifier(e)
  const cursor = CURSOR[e.key]
  if (cursor) {
    if (mod > 1) return `\x1b[1;${mod}${cursor}`
    return `${m.applicationCursor ? '\x1bO' : '\x1b['}${cursor}`
  }
  const tilde = TILDE[e.key]
  if (tilde !== undefined) return mod > 1 ? `\x1b[${tilde};${mod}~` : `\x1b[${tilde}~`
  const ss3 = SS3[e.key]
  if (ss3) return mod > 1 ? `\x1b[1;${mod}${ss3}` : `\x1bO${ss3}`

  const meta = e.altKey && m.altIsMeta ? '\x1b' : ''
  switch (e.key) {
    case 'Enter':
      return meta + '\r'
    case 'Backspace':
      return meta + (e.ctrlKey ? '\x08' : '\x7f')
    case 'Tab':
      return e.shiftKey ? '\x1b[Z' : meta + '\t'
    case 'Escape':
      return meta + '\x1b'
  }

  if (e.ctrlKey && !e.altKey) {
    const k = physical(e) ?? e.key.toLowerCase()
    if (k.length === 1) {
      if (k >= 'a' && k <= 'z') return String.fromCharCode(k.charCodeAt(0) - 96)
      const controls: Record<string, string> = { ' ': '\x00', '2': '\x00', '@': '\x00', '[': '\x1b', '3': '\x1b', '\\': '\x1c', '4': '\x1c', ']': '\x1d', '5': '\x1d', '6': '\x1e', '^': '\x1e', '-': '\x1f', '/': '\x1f', '7': '\x1f', '8': '\x7f', '?': '\x7f' }
      if (controls[k] !== undefined) return controls[k]!
    }
    return null
  }
  if (e.altKey && m.altIsMeta) {
    // Alt+key: ESC and the key (Alt+Ctrl+key: ESC and the control character).
    const k = e.ctrlKey ? physical(e) : e.key.length === 1 ? e.key : physical(e)
    if (k && k.length === 1) {
      if (e.ctrlKey && k >= 'a' && k <= 'z') return '\x1b' + String.fromCharCode(k.charCodeAt(0) - 96)
      return '\x1b' + k
    }
  }
  return null
}

/** A mouse event as the program asked for it: SGR (`1006`) or the old X10 bytes. */
export function mouseSequence(kind: 'down' | 'up' | 'move' | 'wheel', button: number, col: number, row: number, mods: { shift: boolean; alt: boolean; ctrl: boolean }, sgr: boolean): string {
  let code = kind === 'wheel' ? 64 + button : kind === 'move' ? 32 + (button === 3 ? 3 : button) : button
  if (mods.shift) code += 4
  if (mods.alt) code += 8
  if (mods.ctrl) code += 16
  if (sgr) return `\x1b[<${code};${col + 1};${row + 1}${kind === 'up' ? 'm' : 'M'}`
  if (kind === 'up') code = 3 + (code & ~3)
  const enc = (n: number): string => String.fromCharCode(Math.min(n + 32, 255))
  return `\x1b[M${enc(code)}${enc(col + 1)}${enc(row + 1)}`
}

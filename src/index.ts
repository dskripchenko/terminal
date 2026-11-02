/**
 * @dskripchenko/terminal — a terminal emulator for the browser with no
 * runtime dependencies.
 *
 *     import { Terminal } from '@dskripchenko/terminal'
 *     const term = new Terminal({ cols: 80, rows: 24 })
 *     term.onData((data) => pty.write(data))
 *     pty.onData((data) => term.write(data))
 *
 * `Terminal` reads what a program writes — the escape sequences of the
 * xterm family — into rows of cells; `TerminalView` draws it in an element
 * and turns keys, the mouse and pasting into what the program reads.
 */
export { Terminal, ScreenBuffer, type Command, type TerminalOptions, type CursorStyle, type MouseTracking, type Listener } from './terminal'
export { Line, type Attr, BOLD, DIM, ITALIC, UNDERLINE, DOUBLE_UNDERLINE, CURLY_UNDERLINE, BLINK, INVERSE, HIDDEN, STRIKE, OVERLINE, LINK_SHIFT, PALETTE, RGB, COLOR_KIND } from './line'
export { Parser, type ParserHandler } from './parser'
export { charWidth } from './width'
export { TerminalView, LIGHT_THEME, DARK_THEME, type TerminalTheme, type TerminalViewOptions, type LinkProvider } from './view'
export { keySequence, mouseSequence, type KeyLike, type KeyModes } from './input'

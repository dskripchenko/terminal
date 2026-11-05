# Getting started

## A program behind it

The terminal does not run programs: it shows one that runs elsewhere and
talks to it in text both ways. In a desktop app the program runs in a
pseudo-terminal of the main process:

```ts
// main process (Electron, Node): node-pty
import { spawn } from 'node-pty'
const pty = spawn(process.env.SHELL ?? 'bash', [], { name: 'xterm-256color', cols: 80, rows: 24, cwd })
pty.onData((data) => window.webContents.send('pty:data', data))
ipcMain.on('pty:input', (_e, data) => pty.write(data))
ipcMain.on('pty:resize', (_e, cols, rows) => pty.resize(cols, rows))
```

```ts
// the page
import { Terminal, TerminalView } from '@dskripchenko/terminal'

const term = new Terminal()
const view = new TerminalView(term, element, { onResize: (c, r) => ipc.send('pty:resize', c, r) })
ipc.on('pty:data', (data) => term.write(data))
term.onData((data) => ipc.send('pty:input', data))
```

On a server the same two streams travel over a WebSocket. Set `TERM` to
`xterm-256color` for the program: that is the family the terminal speaks.

## `Terminal`

```ts
new Terminal({ cols?: 80, rows?: 24, scrollback?: 1000, foreground?: '#000000', background?: '#ffffff' })
```

`foreground` and `background` are what a program is told when it asks for the
colours (OSC 10/11: `vim` does, to choose a light or dark scheme).

| | |
|---|---|
| `write(data)` | what the program wrote — any piece, a sequence may be split between two |
| `onData(fn)` | what goes to the program: the keys typed in the view, pastes, answers to its questions |
| `input(data)` | send to the program yourself (a button that types `ls`) |
| `paste(text)` | send text as pasted: in the bracketed-paste marks when the program asked for them |
| `resize(cols, rows)` | a new size; rows of the normal screen are wrapped again to the new width, the cursor kept on its character |
| `reset()` | back to the state at start |
| `onTitle(fn)`, `title` | the title the program set (OSC 0/2) |
| `onCwd(fn)`, `cwd` | the working folder the shell reported (OSC 7) |
| `onBell(fn)` | BEL |
| `onMark(fn)` | shell integration (OSC 133): `A` a prompt starts, `B`/`C` a command, `D` it ended — with the row |
| `onChange(fn)` | something on the screen changed |
| `screenText()`, `lineText(i)` | the screen, or a row of the buffer, as text |
| `buffer` | the active screen: `lines` (the scrollback and the screen), `x`, `y`, `base` (the screen's first row among `lines`) |
| `normal`, `alt` | the two screens; `buffer === alt` while a full-screen program runs |
| `trimmed` | rows dropped from the top of the scrollback so far: absolute row numbers move by it |

Modes a program set are readable too: `applicationCursor`, `bracketedPaste`,
`mouseTracking`, `cursorVisible`, `cursorStyle`, `reverseVideo` and others.

A row (`Line`) gives each cell's `char(x)`, `width(x)` (0 for the right half
of a wide character), `fg(x)`, `bg(x)` (0 the default, `PALETTE | n`,
`RGB | 0xrrggbb`) and `flags(x)` (`BOLD`, `ITALIC`, `UNDERLINE`…; a link's id
from bit 16, its address in `terminal.links`), and `text()`; `wrapped` says
the row continues on the next.

## `TerminalView`

```ts
new TerminalView(term, host, {
  fontFamily?, fontSize?: 13, lineHeight?: 1.25,
  theme?: LIGHT_THEME,
  altIsMeta?,            // Alt sends ESC before the key; off on a Mac by default (Option types characters)
  onLink?: (url) => {},  // a link clicked with Cmd (Ctrl)
  onResize?: (cols, rows) => {},
  wheelLines?: 3,       // the most rows one wheel event scrolls; 0 leaves the wheel to the browser
})
```

The view fills `host`; its size gives the columns and rows, and changes of
it are followed (`fit()` does the same by hand). Only the rows in view are in
the page: the scrollback scrolls with the wheel by rows — never more than
`wheelLines` at a time, so a turn of a mouse's wheel sped up by the system
or a flick of a trackpad moves a few lines, not a screen — and new output
keeps the view where it is unless it is at the bottom.

| | |
|---|---|
| `focus()` | the keyboard to the terminal |
| `getSelection()`, `hasSelection()`, `selectAll()`, `clearSelection()` | the selection (rows that wrapped are joined) |
| `scrollToBottom()` | to the newest output |
| `setTheme(theme)` | colours: `foreground`, `background`, `cursor`, `selection` and the 16 `ansi` |
| `dispose()` | the view's element and listeners gone (the terminal stays) |

**Keys.** Text comes through a hidden input field, so keyboard layouts and
input methods work; arrows, Home/End, Page Up/Down, Insert/Delete and F1–F12
are sent as xterm sends them, with modifiers (`ESC [1;5C` for Ctrl+→); Ctrl
with a letter is the control character of the key's place (Ctrl+C is ^C in
any layout); Alt sends ESC before the key when `altIsMeta`. Cmd+C / Cmd+A on
a Mac, Ctrl+Shift+C / Ctrl+Shift+A elsewhere copy and select; pasting is the
browser's.

**The mouse.** Dragging selects; a double click selects a word, a triple a
row; Shift extends. When a program asks for the mouse (`htop`, `mc`, `vim`
with `mouse=a`) clicks, drags and the wheel are its — Shift keeps them the
terminal's. In a full-screen program without mouse reporting the wheel sends
arrows, one a row, at most `wheelLines` an event.

**Colours** are CSS custom properties on the view's element:
`--dsk-term-fg`, `--dsk-term-bg`, `--dsk-term-cursor`, `--dsk-term-selection`,
`--dsk-term-0` … `--dsk-term-15`. `LIGHT_THEME` and `DARK_THEME` are ready.

## Shell integration

A shell that marks its commands — OSC 133 (`A` a prompt, `B` the command
typed, `C` it runs, `D;code` it ended), the same from VS Code's 633, and
`633;E;text` for what was run — gets them read: `term.commands` lists them
(rows, exit code, text, start and end times), `term.onCommand` tells each
change. The view puts a mark beside each command's prompt — running, done,
failed, with the command, its exit code and how long it took on hover; a click
on a mark selects the command's output — and `view.scrollToCommand(-1 | 1)`
brings the previous or the next prompt to the top. The scripts that make zsh,
bash or PowerShell mark their commands are the host's.

## Links, finding, clearing

```ts
new TerminalView(term, host, {
  onLink: (url) => openInBrowser(url),
  links: [{ pattern: /[\w./-]+\.\w+:\d+/g, activate: (text) => openAtLine(text) }],
})
```

Web addresses and OSC 8 hyperlinks go to `onLink`; each of `links` finds its
own kind in the text (a path with a line, an issue number) and opens it with
Cmd (Ctrl) and a click. `view.find(pattern)` marks every match in the
scrollback and the screen and returns how many; `view.showMatch(i)` makes one
current and scrolls to it; `view.clearFind()`. `view.clear()` empties the
scrollback and the screen, keeping the prompt's row at the top.

## Not supported

Pictures in the terminal (sixel, iTerm2, Kitty graphics), the Kitty keyboard
protocol, double-width and double-height rows (DECDWL, DECDHL), 132-column
mode, right-to-left text, writing the clipboard from output (OSC 52, refused
on purpose). DCS strings (`tmux` passthrough, `DECRQSS`) are read and dropped.

# @dskripchenko/terminal

[![CI](https://github.com/dskripchenko/terminal/actions/workflows/ci.yml/badge.svg)](https://github.com/dskripchenko/terminal/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@dskripchenko/terminal.svg)](https://www.npmjs.com/package/@dskripchenko/terminal)
[![license](https://img.shields.io/npm/l/@dskripchenko/terminal.svg)](LICENSE)

A terminal emulator for the browser with **no runtime dependencies**: put a
shell, `vim`, `htop` or `less` in a page. It reads what a program writes — the
escape sequences of the xterm family — and draws it; keys, input methods, the
mouse and pasting go back to the program as it expects them.

```ts
import { Terminal, TerminalView, DARK_THEME } from '@dskripchenko/terminal'

const term = new Terminal({ scrollback: 5000 })
const view = new TerminalView(term, document.getElementById('console')!, {
  theme: DARK_THEME,
  onResize: (cols, rows) => pty.resize(cols, rows),
  onLink: (url) => window.open(url),
})

pty.onData((data) => term.write(data)) // what the program writes
term.onData((data) => pty.write(data)) // keys, pastes, answers to its questions
term.onTitle((title) => (document.title = title))
view.focus()
```

The program itself runs elsewhere: in a pseudo-terminal of a desktop app's
main process (`node-pty`), on a server over a WebSocket, in a container.

**What it reads.** Printing with wrapping and the pending wrap at the edge;
wide characters (CJK, emoji) and clusters (accents, skin tones, emoji
sequences) by Unicode 15; cursor movement, scrolling regions, inserting and
deleting characters and lines, erasing in the pen's background; tab stops;
16, 256 and true colours in both forms (`38;2;r;g;b` and `38:2::r:g:b`), bold,
dim, italic, underline (single, double, curly), blinking, inverse, hidden,
strike-through, overline; the alternate screen (`1049`) and saving the cursor;
the DEC line-drawing set; origin mode, autowrap, insert mode; the application
cursor and keypad; bracketed paste; mouse reporting (`1000`/`1002`/`1003`,
SGR `1006`); focus events; answers to the cursor position, device attributes,
the size and the colours; the title (OSC 0/2), the working folder (OSC 7),
hyperlinks (OSC 8) and shell integration marks (OSC 133).

**What it draws.** Only the rows in view — a scrollback of thousands of rows
costs what a screen costs; rows of the normal screen wrapped again when the
width changes; the cursor as a block, an underline or a bar, blinking or not;
a selection with the mouse (a word on a double click, a row on a triple) and
copying it; links opened with Cmd (Ctrl) and a click.

## What it promises

- **The same screen as xterm.** Every sequence above is checked against
  xterm.js, cell by cell and with the cursor, and so are recorded sessions of
  real programs — `vim` split in two, `htop`, `top`, `less`, `man`, `mc`,
  `nano`, `git log --graph`, a Python prompt — after every piece of their
  output.
- **Keys as programs read them.** Ctrl with a letter by its key, so Ctrl+C is
  ^C in any layout; text through the input field, so layouts and input methods
  (Japanese, Chinese, accents) work; Alt as an ESC before the key where asked.
- **Small.** About 20 KB gzipped, no dependencies, no canvas, no WebGL.
- **Checked in real browsers.** Chromium and WebKit: sizes, keys, selection,
  scrollback, pasting, the mouse, colours.

## Documentation

[English](docs/en/getting-started.md) · [Русский](docs/ru/getting-started.md) · [Deutsch](docs/de/getting-started.md) · [中文](docs/zh/getting-started.md)

## Install

```sh
npm install @dskripchenko/terminal
```

## License

MIT

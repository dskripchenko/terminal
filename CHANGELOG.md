# Changelog

## 0.8.0

### Minor Changes

- 80af9ee: Pictures in the output: sixel (DCS q, decoded here, the VT340 palette and the picture's own colours) and the kitty graphics protocol (APC G: PNG and raw RGB/RGBA, sent whole or in pieces, shown at once or kept by id and shown later, deleted; answers unless quiet; only what comes in the stream — a file or shared memory named by a program is refused, as is compression). A picture covers the cells its size takes, scrolls with the text, goes with the scrollback cut, with a cleared screen and with `clear()`; the alternate screen has its own. The view draws the pictures in view (an image or a canvas) and tells the core its cell size in pixels; a program asking gets it (CSI 14 t, 16 t), DA1 says sixel is there (`?62;4;22c`), XTSMGRAPHICS answers. The parser hands DCS and APC strings over (`dcs`, `apc` on the handler), up to 48 MB.

## 0.7.0

### Minor Changes

- 277597b: Commands as blocks for the host: `onCommand(command, event)` when a command's mark is clicked or its block right-clicked (with nothing selected, and not while a program reads the mouse); `commandAt(x, y)` finds the command whose block holds a point; `commandText(command)` gives its text and its output as text.

## 0.6.0

### Minor Changes

- ebd5efd: Marks of the host's own in the output: a `LinkProvider` with `highlight` (a CSS colour) and no `activate` paints what its pattern finds, not as a link — as a trigger's highlight. `TerminalView.setLinks()` replaces the host's links and marks at once (its settings changed) and draws the rows again. Only a colour goes into a mark's style.

## 0.5.0

### Minor Changes

- 4ca8bba: The kitty keyboard protocol's "disambiguate" flag: a program that pushes it (`CSI > 1 u`) gets Esc as `CSI 27 u` and keys with Ctrl or Alt as `CSI code;mods u` (by the key's place, in any layout), and Enter, Tab and Backspace with a modifier as their own — Shift+Enter is no longer Enter. The flags are asked (`CSI ? u`), pushed, popped and set, a stack for each screen; `Terminal.kittyFlags` says the ones in force.

## 0.4.1

### Patch Changes

- 62c77c3: A view made before its element is in the page — a hidden tab's, kept alive
  while it is not shown — no longer throws ("Invalid array length") when it
  draws: it waits until the element is put in a page, and the resize observer
  draws it then. Copy (Cmd+C, Ctrl+Shift+C) and select all (Cmd+A,
  Ctrl+Shift+A) go by the key's place, so they work on a Russian layout too,
  where those keys type «с» and «ф».

## 0.4.0

### Minor Changes

- 3aa78a5: A full scrollback no longer slows output down: rows cut from its top only move
  a start index, and the rows are copied together once in a while, so a line of
  output costs the same with a scrollback of a thousand rows or of a hundred
  thousand (long output was up to five times slower than xterm.js, and slower
  still the longer the scrollback). `buffer.length` and `buffer.line(i)` read the
  rows without copying them; `buffer.lines` stays as it was.

  Synchronized output (mode 2026): while a program draws a frame between
  `CSI ? 2026 h` and `CSI ? 2026 l`, the view waits and shows the frame whole —
  at most 150 ms, in case the end never comes. Agents such as Claude Code draw
  every frame this way; half a frame no longer flashes when it arrives in two
  pieces. DECRQM (`CSI ? Ps $ p`) answers whether a private mode is set.

## 0.3.0

### Minor Changes

- 21d8639: The wheel scrolls the output by rows, never more than `wheelLines` (3) at a time: a turn of a mouse's wheel sped up by the system, or a flick of a trackpad, moves a few lines instead of a screen, so long output can be read. In a full-screen program the arrows it sends add up short moves to whole rows and are capped the same way; `wheelLines: 0` leaves the wheel to the browser.

## 0.2.0

### Minor Changes

- 9c225ea: Shell integration: commands read from OSC 133 / 633 (`term.commands`, `term.onCommand`, `term.lastCommand`) — rows kept through reflow and a cut scrollback — and shown in the view as marks beside the prompts (running, done, failed; the command, exit code and duration on hover; a click selects the output), with `view.scrollToCommand(-1 | 1)`. Link providers (`links`: a pattern and an `activate`), finding in the buffer (`view.find`, `showMatch`, `clearFind`), clearing (`term.clear`, `view.clear`) keeping the prompt's row.

## 0.1.0

### Minor Changes

- 6e2b569: First release: `Terminal` (the xterm family's escape sequences into rows of cells: colours, styles, wide characters and clusters, scrolling regions, the alternate screen, modes, answers, OSC title/folder/links/marks, reflow on resize) and `TerminalView` (drawn in the DOM, only the rows in view; keys, input methods, pasting, selection, the mouse, links, fitting the element). Checked against xterm.js on sequences and on recorded sessions of real programs, and in Chromium and WebKit.

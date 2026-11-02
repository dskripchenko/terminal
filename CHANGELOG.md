# Changelog

## 0.2.0

### Minor Changes

- 9c225ea: Shell integration: commands read from OSC 133 / 633 (`term.commands`, `term.onCommand`, `term.lastCommand`) — rows kept through reflow and a cut scrollback — and shown in the view as marks beside the prompts (running, done, failed; the command, exit code and duration on hover; a click selects the output), with `view.scrollToCommand(-1 | 1)`. Link providers (`links`: a pattern and an `activate`), finding in the buffer (`view.find`, `showMatch`, `clearFind`), clearing (`term.clear`, `view.clear`) keeping the prompt's row.

## 0.1.0

### Minor Changes

- 6e2b569: First release: `Terminal` (the xterm family's escape sequences into rows of cells: colours, styles, wide characters and clusters, scrolling regions, the alternate screen, modes, answers, OSC title/folder/links/marks, reflow on resize) and `TerminalView` (drawn in the DOM, only the rows in view; keys, input methods, pasting, selection, the mouse, links, fitting the element). Checked against xterm.js on sequences and on recorded sessions of real programs, and in Chromium and WebKit.

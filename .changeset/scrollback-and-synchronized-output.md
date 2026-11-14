---
"@dskripchenko/terminal": minor
---

A full scrollback no longer slows output down: rows cut from its top only move
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

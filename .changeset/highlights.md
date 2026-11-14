---
'@dskripchenko/terminal': minor
---

Marks of the host's own in the output: a `LinkProvider` with `highlight` (a CSS colour) and no `activate` paints what its pattern finds, not as a link — as a trigger's highlight. `TerminalView.setLinks()` replaces the host's links and marks at once (its settings changed) and draws the rows again. Only a colour goes into a mark's style.

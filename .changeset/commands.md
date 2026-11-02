---
'@dskripchenko/terminal': minor
---

Shell integration: commands read from OSC 133 / 633 (`term.commands`, `term.onCommand`, `term.lastCommand`) — rows kept through reflow and a cut scrollback — and shown in the view as marks beside the prompts (running, done, failed; the command, exit code and duration on hover; a click selects the output), with `view.scrollToCommand(-1 | 1)`. Link providers (`links`: a pattern and an `activate`), finding in the buffer (`view.find`, `showMatch`, `clearFind`), clearing (`term.clear`, `view.clear`) keeping the prompt's row.

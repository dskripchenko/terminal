# Security

`@dskripchenko/terminal` draws what a program writes. Programs are not always
trusted — a file shown with `cat`, a remote log, a server one logged in to —
so the terminal must not let their output act in the page.

## What it guarantees

- **Text, never markup.** Every character a program writes is escaped before
  it is drawn; the only markup is the view's own.
- **No clipboard or window access from output.** OSC 52 (writing the
  clipboard), window titles stacked or reported back, and font or window
  changes are not acted on; the title is handed to the host to show as text.
- **Links only by the user.** A hyperlink (OSC 8) or an address in the text is
  opened only on Cmd (Ctrl) and a click, and only through the host's
  `onLink`, which decides whether and how.
- **Bounded memory.** The scrollback has a limit; OSC strings are cut at 1 MB;
  parameters past 32 are dropped.

## Reporting a vulnerability

Please report security issues privately through GitHub's
[security advisories](https://github.com/dskripchenko/terminal/security/advisories/new)
rather than in a public issue.

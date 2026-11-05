---
"@dskripchenko/terminal": minor
---

The wheel scrolls the output by rows, never more than `wheelLines` (3) at a time: a turn of a mouse's wheel sped up by the system, or a flick of a trackpad, moves a few lines instead of a screen, so long output can be read. In a full-screen program the arrows it sends add up short moves to whole rows and are capped the same way; `wheelLines: 0` leaves the wheel to the browser.

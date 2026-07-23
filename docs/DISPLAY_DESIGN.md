# G2 display design — live translator HUD

Recommendation from a multi-agent design workflow (2 display researchers → 3
designers with distinct lenses → an "Even G2 expert" synthesis). Applied to
`src/main.ts` / `src/config.ts`.

## The screen (constraints that drive everything)

- 576 × 288 px, 4-bit greyscale — **16 shades of green**, monocular waveguide.
- Essentially unusable outdoors without the tinted clip → **legibility &
  glanceability are the governing constraints**, not capacity.
- **Font size is NOT settable** via the SDK (`TextContainerProperty` has no font
  field) — the firmware renders a fixed font. So line-count is the real lever,
  not px.
- `textContainerUpgrade` (content-only) is the flicker-free primitive. A full
  `createStartUpPageContainer` rebuild flashes the screen → quarantined to
  language/mode switches, never per sentence.

## Layout (applied)

Two containers, absolute, top-left aligned:

| Container | id | capture | geometry | role |
|---|---|---|---|---|
| Status strip | 2 | no (0) | x0 y0 w576 h28, border 1 / color 5, pad 12 | `SRC>TGT  LIVE/MUTE` |
| Transcript body | 1 | yes (1) | x0 y30 w576 h258, border 0, pad 12 | translation only |

## Behavior (applied)

- **Translation only** on glass. Source text is NOT rendered (you can't truly
  dim a second stream with fixed intensity; it just halves legibility). Source
  language lives in the strip as `EN>RU`.
- **Bottom-anchored rolling buffer**: newest sentence on the bottom line; keep
  ~6 lines; trim from the front. Buffer owned in JS; re-push the visible block
  via `textContainerUpgrade`.
- **Provisional marker**: a phrase being translated shows a trailing ASCII
  `...`; on finalize it's overwritten in place (partial → final).
- **No motion**: replacement is an instant jump-cut (peripheral motion in the
  lens is a walking hazard). ~150 ms debounce coalesces BLE-slow bursts.
- **Status strip**: `EN>RU  LIVE`, `EN>RU  MUTE`, or `OFFLINE`. ASCII only,
  packed left. **No persistent ms ping** — a live counter is cognitive noise
  while walking. Lag surfaces **by exception**: `LAG 1.4s` when a translation
  round-trip exceeds 1 s. (Flip `RENDER.showPersistentPing = true` for an
  always-on readout.)
- **ASCII only** — no emoji / box-drawing / arrows / `…`. The firmware LVGL font's
  Cyrillic + punctuation coverage is UNVERIFIED — confirm on-device; ASCII `...`
  and `>` are chosen to dodge missing glyphs.

## Deferred / to verify on device

- **Font size** is fixed by firmware — the 17px/32px-leading target can't be set;
  6 lines is an estimate for the 258 px body. Tune `RENDER.maxLines` on-device if
  it clips or reads too sparse.
- **Pixel-accurate trimming** (fabioglimb/even-toolkit `measureGlassText`) instead
  of the current char-count approximation — the font is proportional, so char
  counts are only a rough guide.
- **Cyrillic/punctuation glyph coverage** in the firmware font — confirm before
  shipping or Russian output can degrade silently.

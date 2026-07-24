// G2 display canvas (px). See Even Hub docs: 576 x 288, 4-bit greyscale.
export const CANVAS = { width: 576, height: 288 } as const

export function backendWsUrl(): string {
  // Same-origin by default: the backend serves this app AND the WebSocket at
  // `/ws` on one port, so wherever the app is loaded from, the WS follows.
  //   • Server/prod: app served by the backend → ws://<host>:<port>/ws directly.
  //   • Dev (vite :5173): vite proxies /ws → the backend (see vite.config.ts).
  // Override with VITE_BACKEND_URL=ws://host:port/ws only for exotic setups.
  const configured = import.meta.env.VITE_BACKEND_URL
  if (configured) return configured
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/ws`
}

import type { WidthMode } from '../shared/protocol'

// Manual wrap column per width setting. "full" ≈ the firmware's real full-width
// capacity (observed: ~24 chars fills only ~half the screen → full ≈ ~48). Lower
// values force a narrower text column by wrapping earlier.
export const WIDTH_CPL: Record<WidthMode, number> = { full: 46, medium: 32, narrow: 20 }

// Glasses render tuning — per the G2 display-design workflow recommendation.
export const RENDER = {
  // BLE render queue is slow — coalesce display writes. Kept short so the live
  // provisional line still feels responsive; bursts still collapse to one write.
  debounceMs: 120,
  // Soft character budget per line (firmware font is fixed & proportional;
  // this is an approximation until pixel-accurate measurement is wired in).
  maxCharsPerLine: 46,

  // --- Rolling-caption model (stt-even-g2: finalTranscript + provisionalSuffix) ---
  // The LIVE view (follow-newest) is a single flowing running caption: committed
  // Russian, char-tailed, with the interim SOURCE shown as a marked bottom line.
  // The primary readable band is ~3 lines (24 chars/line). Newest at the bottom.
  //
  // Committed-translation tail when idle (no speech in progress): ~3 lines.
  liveCharTail: 72,
  // Committed tail while a live provisional line is showing: shrink to ~2 lines
  // so committed + live stays a tight ~3–4-line band with the eye at the bottom.
  liveCharTailSpeaking: 46,
  // Max interim-SOURCE chars on the live line (~2 lines).
  provChars: 46,
  // ASCII markers (firmware renders Latin + Cyrillic; keep these ASCII).
  provMarker: '> ', // prefixes the live "currently hearing" line
  ellipsis: '...', // truncation prefix, per stt-even-g2

  // --- Ring-scroll history (unchanged, sentence-paged) ---
  // Bottom-anchored buffer: page through the newest ~6 committed sentences.
  maxLines: 6,

  // Designers advise against a live ms counter (cognitive noise while walking):
  // show latency ONLY by exception. Flip to true for an always-on ping readout.
  showPersistentPing: false,
  // Surface "LAG x.xs" when a translation round-trip exceeds this.
  lagThresholdMs: 1000,
} as const

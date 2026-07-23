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

// Glasses render tuning — per the G2 display-design workflow recommendation.
export const RENDER = {
  // BLE render queue is slow — coalesce display writes (~150ms).
  debounceMs: 150,
  // Bottom-anchored rolling buffer: keep the newest ~6 sentences visible.
  maxLines: 6,
  // Soft character budget per line (firmware font is fixed & proportional;
  // this is an approximation until pixel-accurate measurement is wired in).
  maxCharsPerLine: 24,
  // Designers advise against a live ms counter (cognitive noise while walking):
  // show latency ONLY by exception. Flip to true for an always-on ping readout.
  showPersistentPing: false,
  // Surface "LAG x.xs" when a translation round-trip exceeds this.
  lagThresholdMs: 1000,
} as const

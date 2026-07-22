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

// Glasses render tuning.
export const RENDER = {
  // BLE render queue is slow — coalesce display writes.
  debounceMs: 120,
  // Rough character budget for the 576x288 text container at default font.
  maxChars: 240,
  // How many finalized lines to keep on screen at once.
  maxLines: 4,
} as const

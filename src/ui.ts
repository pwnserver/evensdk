// Companion-app WebView UI. Mirrors what's on the glasses and surfaces
// connection status, so you can debug without the glasses on your face.

type StatusState = 'connecting' | 'ready' | 'listening' | 'error'

let statusEl: HTMLDivElement
let partialEl: HTMLDivElement
let linesEl: HTMLDivElement

const STYLE = `
  :root { color-scheme: dark; }
  #app { display: flex; flex-direction: column; gap: 12px; padding: 16px; box-sizing: border-box; height: 100%; }
  .chip { align-self: flex-start; font-size: 12px; padding: 4px 10px; border-radius: 999px; background: #333; color: #E5E5E5; }
  .chip.ready { background: #204020; color: #9AE6A0; }
  .chip.listening { background: #1f3a4d; color: #7ac6ff; }
  .chip.error { background: #4d1f1f; color: #ff9a9a; }
  #partial { min-height: 20px; font-size: 14px; color: #8a8a8a; font-style: italic; }
  #lines { flex: 1; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
  .line { display: flex; flex-direction: column; gap: 2px; padding-bottom: 8px; border-bottom: 1px solid #2a2a2a; }
  .line .src { font-size: 12px; color: #7a7a7a; }
  .line .tgt { font-size: 17px; color: #E5E5E5; line-height: 1.35; }
  .hint { font-size: 11px; color: #666; }
`

export function mountUi() {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.appendChild(style)

  const app = document.getElementById('app')!
  app.textContent = ''
  app.innerHTML = `
    <div id="status" class="chip">Connecting…</div>
    <div id="partial"></div>
    <div id="lines"></div>
    <div class="hint">Foreign speech → Russian on the glasses. Double-tap a temple to exit.</div>
  `
  statusEl = document.getElementById('status') as HTMLDivElement
  partialEl = document.getElementById('partial') as HTMLDivElement
  linesEl = document.getElementById('lines') as HTMLDivElement
}

const STATUS_TEXT: Record<StatusState, string> = {
  connecting: 'Connecting to backend…',
  ready: 'Backend connected',
  listening: 'Listening · translating',
  error: 'Error',
}

export function setStatus(state: StatusState, message?: string) {
  if (!statusEl) return
  statusEl.className = `chip ${state === 'connecting' ? '' : state}`.trim()
  statusEl.textContent = message ?? STATUS_TEXT[state]
}

export function setPartial(text: string) {
  if (partialEl) partialEl.textContent = text
}

export function addSegment(source: string, target: string) {
  if (!linesEl) return
  setPartial('')
  const line = document.createElement('div')
  line.className = 'line'
  const src = document.createElement('div')
  src.className = 'src'
  src.textContent = source
  const tgt = document.createElement('div')
  tgt.className = 'tgt'
  tgt.textContent = target
  line.append(src, tgt)
  linesEl.appendChild(line)
  // Keep the newest line in view.
  linesEl.scrollTop = linesEl.scrollHeight
}

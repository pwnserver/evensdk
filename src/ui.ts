// Companion-app WebView UI. Settings (source/target language) + a live mirror
// of what's on the glasses and the connection status.

import { LANGUAGES, type ClientConfig } from '../shared/protocol'

type StatusState = 'connecting' | 'ready' | 'listening' | 'error'

let statusEl: HTMLDivElement
let partialEl: HTMLDivElement
let linesEl: HTMLDivElement

const STYLE = `
  :root { color-scheme: dark; }
  #app { display: flex; flex-direction: column; gap: 12px; padding: 16px; box-sizing: border-box; height: 100%; }
  .settings { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; }
  .field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 120px; }
  .field label { font-size: 11px; color: #8a8a8a; }
  .field select {
    appearance: none; background: #2a2a2a; color: #E5E5E5; border: 1px solid #3a3a3a;
    border-radius: 8px; padding: 8px 10px; font-size: 15px; width: 100%;
  }
  .arrow { color: #666; padding-bottom: 8px; font-size: 18px; }
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

function option(value: string, label: string, selected: boolean): string {
  return `<option value="${value}"${selected ? ' selected' : ''}>${label}</option>`
}

export function mountUi(opts: { config: ClientConfig; onConfig: (cfg: ClientConfig) => void }) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.appendChild(style)

  const srcOptions = [option('auto', 'Авто', opts.config.sourceLang === 'auto')]
    .concat(LANGUAGES.map(l => option(l.code, l.label, l.code === opts.config.sourceLang)))
    .join('')
  const tgtOptions = LANGUAGES.map(l => option(l.code, l.label, l.code === opts.config.targetLang)).join('')

  const app = document.getElementById('app')!
  app.innerHTML = `
    <div class="settings">
      <div class="field">
        <label for="src">Слышу</label>
        <select id="src">${srcOptions}</select>
      </div>
      <div class="arrow">→</div>
      <div class="field">
        <label for="tgt">Показываю</label>
        <select id="tgt">${tgtOptions}</select>
      </div>
    </div>
    <div id="status" class="chip">Connecting…</div>
    <div id="partial"></div>
    <div id="lines"></div>
    <div class="hint">Двойной тап по дужке — выход.</div>
  `
  statusEl = document.getElementById('status') as HTMLDivElement
  partialEl = document.getElementById('partial') as HTMLDivElement
  linesEl = document.getElementById('lines') as HTMLDivElement

  const src = document.getElementById('src') as HTMLSelectElement
  const tgt = document.getElementById('tgt') as HTMLSelectElement
  const emit = () => opts.onConfig({ sourceLang: src.value, targetLang: tgt.value })
  src.addEventListener('change', emit)
  tgt.addEventListener('change', emit)
}

const STATUS_TEXT: Record<StatusState, string> = {
  connecting: 'Подключение к серверу…',
  ready: 'Сервер на связи',
  listening: 'Слушаю · перевожу',
  error: 'Ошибка',
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
  linesEl.scrollTop = linesEl.scrollHeight
}

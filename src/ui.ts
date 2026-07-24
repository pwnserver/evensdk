// Companion-app WebView UI: language + latency + mute controls, connection
// status, and a live mirror of the glasses text.

import { LANGUAGES, type ClientConfig, type LatencyMode, type StatusMode, type WidthMode } from '../shared/protocol'

type StatusState = 'connecting' | 'ready' | 'listening' | 'error'

const LATENCY_LABELS: Record<LatencyMode, string> = {
  fast: 'Быстро',
  balanced: 'Баланс',
  accurate: 'Точно',
}
const WIDTH_LABELS: Record<WidthMode, string> = { full: 'Полная', medium: 'Средняя', narrow: 'Узкая' }
const STATUS_LABELS: Record<StatusMode, string> = { normal: 'Обычно', off: 'Скрыть', ping: 'Пинг' }

let statusEl: HTMLDivElement
let partialEl: HTMLDivElement
let linesEl: HTMLDivElement
let srcEl: HTMLSelectElement
let tgtEl: HTMLSelectElement
let latEl: HTMLSelectElement
let nlinesEl: HTMLSelectElement
let widthEl: HTMLSelectElement
let streamEl: HTMLSelectElement
let statusModeEl: HTMLSelectElement
let muteEl: HTMLButtonElement

const STYLE = `
  :root { color-scheme: dark; }
  #app { display: flex; flex-direction: column; gap: 12px; padding: 16px; box-sizing: border-box; height: 100%; }
  .row { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; }
  details.submenu { border: 1px solid #2a2a2a; border-radius: 8px; }
  details.submenu > summary { cursor: pointer; padding: 10px 12px; font-size: 13px; color: #b5b5b5; list-style: none; }
  details.submenu > summary::-webkit-details-marker { display: none; }
  details.submenu[open] > summary { border-bottom: 1px solid #2a2a2a; }
  details.submenu .row { padding: 10px 12px; }
  .field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 100px; }
  .field label { font-size: 11px; color: #8a8a8a; }
  .field select {
    appearance: none; background: #2a2a2a; color: #E5E5E5; border: 1px solid #3a3a3a;
    border-radius: 8px; padding: 8px 10px; font-size: 15px; width: 100%;
  }
  .arrow { color: #666; padding-bottom: 8px; font-size: 18px; }
  #mute {
    appearance: none; border: 1px solid #3a3a3a; border-radius: 8px; padding: 10px 12px;
    font-size: 15px; background: #2a2a2a; color: #E5E5E5; cursor: pointer; white-space: nowrap;
  }
  #mute.muted { background: #4d1f1f; color: #ff9a9a; border-color: #5a2a2a; }
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

export function mountUi(opts: {
  config: ClientConfig
  muted: boolean
  onConfig: (cfg: ClientConfig) => void
  onToggleMute: () => void
}) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.appendChild(style)

  const srcOptions = [option('auto', 'Авто', opts.config.sourceLang === 'auto')]
    .concat(LANGUAGES.map(l => option(l.code, l.label, l.code === opts.config.sourceLang)))
    .join('')
  const tgtOptions = LANGUAGES.map(l => option(l.code, l.label, l.code === opts.config.targetLang)).join('')
  const latOptions = (Object.keys(LATENCY_LABELS) as LatencyMode[])
    .map(m => option(m, LATENCY_LABELS[m], m === opts.config.latency))
    .join('')
  const linesOptions = ([2, 3, 4] as const).map(n => option(String(n), `${n} строки`, n === opts.config.lines)).join('')
  const widthOptions = (Object.keys(WIDTH_LABELS) as WidthMode[])
    .map(w => option(w, WIDTH_LABELS[w], w === opts.config.width))
    .join('')
  const streamOptions = option('on', 'Вкл', opts.config.interim) + option('off', 'Выкл', !opts.config.interim)
  const statusOptions = (Object.keys(STATUS_LABELS) as StatusMode[])
    .map(s => option(s, STATUS_LABELS[s], s === opts.config.status))
    .join('')

  const app = document.getElementById('app')!
  app.innerHTML = `
    <details class="submenu">
      <summary>⚙ Языки и задержка</summary>
      <div class="row">
        <div class="field"><label for="src">Слышу</label><select id="src">${srcOptions}</select></div>
        <div class="arrow">→</div>
        <div class="field"><label for="tgt">Показываю</label><select id="tgt">${tgtOptions}</select></div>
      </div>
      <div class="row">
        <div class="field"><label for="lat">Задержка</label><select id="lat">${latOptions}</select></div>
      </div>
    </details>
    <details class="submenu">
      <summary>⚙ Экран</summary>
      <div class="row">
        <div class="field"><label for="nlines">Строк</label><select id="nlines">${linesOptions}</select></div>
        <div class="field"><label for="width">Ширина</label><select id="width">${widthOptions}</select></div>
      </div>
      <div class="row">
        <div class="field"><label for="stream">Бегущая строка</label><select id="stream">${streamOptions}</select></div>
        <div class="field"><label for="statusmode">Верх. строка</label><select id="statusmode">${statusOptions}</select></div>
      </div>
    </details>
    <div class="row"><button id="mute" type="button">🎙️ Слушаю</button></div>
    <div id="status" class="chip">Connecting…</div>
    <div id="partial"></div>
    <div id="lines"></div>
    <div class="hint">Кольцо R1: крути — прокрутка текста, нажатие — мьют, двойное — выход.</div>
  `
  statusEl = document.getElementById('status') as HTMLDivElement
  partialEl = document.getElementById('partial') as HTMLDivElement
  linesEl = document.getElementById('lines') as HTMLDivElement
  srcEl = document.getElementById('src') as HTMLSelectElement
  tgtEl = document.getElementById('tgt') as HTMLSelectElement
  latEl = document.getElementById('lat') as HTMLSelectElement
  nlinesEl = document.getElementById('nlines') as HTMLSelectElement
  widthEl = document.getElementById('width') as HTMLSelectElement
  streamEl = document.getElementById('stream') as HTMLSelectElement
  statusModeEl = document.getElementById('statusmode') as HTMLSelectElement
  muteEl = document.getElementById('mute') as HTMLButtonElement

  const emit = () =>
    opts.onConfig({
      sourceLang: srcEl.value,
      targetLang: tgtEl.value,
      latency: latEl.value as LatencyMode,
      interim: streamEl.value === 'on',
      lines: Number(nlinesEl.value) as 2 | 3 | 4,
      width: widthEl.value as WidthMode,
      status: statusModeEl.value as StatusMode,
    })
  for (const el of [srcEl, tgtEl, latEl, nlinesEl, widthEl, streamEl, statusModeEl]) {
    el.addEventListener('change', emit)
  }
  muteEl.addEventListener('click', () => opts.onToggleMute())
  setMuted(opts.muted)
}

/** Reflect config that changed elsewhere (e.g. via the R1 ring). */
export function syncConfig(cfg: ClientConfig) {
  if (srcEl) srcEl.value = cfg.sourceLang
  if (tgtEl) tgtEl.value = cfg.targetLang
  if (latEl) latEl.value = cfg.latency
  if (nlinesEl) nlinesEl.value = String(cfg.lines)
  if (widthEl) widthEl.value = cfg.width
  if (streamEl) streamEl.value = cfg.interim ? 'on' : 'off'
  if (statusModeEl) statusModeEl.value = cfg.status
}

export function setMuted(muted: boolean) {
  if (!muteEl) return
  muteEl.classList.toggle('muted', muted)
  muteEl.textContent = muted ? '🔇 Мьют' : '🎙️ Слушаю'
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

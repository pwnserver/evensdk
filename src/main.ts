import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import { CANVAS, RENDER } from './config'
import { DEFAULT_CONFIG, LANGUAGES, type ClientConfig } from '../shared/protocol'
import { BackendLink } from './net'
import { mountUi, setStatus, setPartial, addSegment, setMuted, syncConfig } from './ui'

// ---- Persisted language/latency config ----
const CONFIG_KEY = 'even-translate-config'
function loadConfig(): ClientConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (raw) return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<ClientConfig>) }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_CONFIG }
}
let config = loadConfig()
let muted = false
let rtt: number | null = null // network round-trip ms
let lastLatency: number | null = null // server STT+translate ms
let lastSrcCode: string | null = null // detected source (for the EN>RU strip)
let scrollOffset = 0 // ring-driven: 0 = follow newest, >0 = scrolled back into history

const bridge = await waitForEvenAppBridge()

// ---- Single full-canvas container (proven-working layout) ----
// Status is rendered as the top line inside the same container; translations
// below. One container = no multi-container rendering pitfalls.
const screen = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: CANVAS.width,
  height: CANVAS.height,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: 1,
  containerName: 'main',
  content: 'Наведите слух...',
  isEventCapture: 1,
})

const created = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [screen] }),
)
if (created !== 0) {
  setStatus('error', `createStartUpPageContainer failed: ${created}`)
  console.error('Failed to create startup page', created)
}

// ---- Glasses rendering: one container = [status line] + [translations] ----
const sentences: string[] = []
let provisional = false // a phrase is being translated → show trailing "..."
let renderPending = ''
let renderLast = ''
let renderTimer: number | null = null

function whisperToCode(name: string): string {
  const m = LANGUAGES.find(l => l.en.toLowerCase() === name.toLowerCase())
  return m?.code ?? name.slice(0, 2)
}

function composeStatus(): string {
  if (!link.isOpen) return 'OFFLINE'
  const src = (config.sourceLang !== 'auto' ? config.sourceLang : (lastSrcCode ?? 'auto')).toUpperCase()
  const tgt = config.targetLang.toUpperCase()
  let s = `${src}>${tgt}  ${muted ? 'MUTE' : 'LIVE'}`
  if (scrollOffset > 0) s += '  HIST'
  if (RENDER.showPersistentPing) {
    s += `  net ${rtt ?? '-'}ms  tr ${lastLatency ?? '-'}ms`
  } else if (lastLatency != null && lastLatency > RENDER.lagThresholdMs) {
    s += `  LAG ${(lastLatency / 1000).toFixed(1)}s`
  }
  return s
}

function maxOffset(): number {
  return Math.max(0, sentences.length - RENDER.maxLines)
}

function scrollBy(delta: number) {
  const next = Math.min(Math.max(0, scrollOffset + delta), maxOffset())
  if (next === scrollOffset) return
  scrollOffset = next
  render()
}

function composeBody(): string {
  const maxStart = maxOffset()
  const start = Math.max(0, maxStart - scrollOffset)
  const visible = sentences.slice(start, start + RENDER.maxLines)
  let text = visible.join('\n')
  if (provisional && scrollOffset === 0) text = text ? `${text}\n...` : '...'
  if (!text) return 'Наведите слух...'
  const cap = RENDER.maxLines * RENDER.maxCharsPerLine
  return text.length > cap ? text.slice(text.length - cap) : text
}

function render() {
  renderPending = `${composeStatus()}\n\n${composeBody()}`
  if (renderTimer !== null) return
  renderTimer = window.setTimeout(async () => {
    renderTimer = null
    if (renderPending === renderLast) return
    renderLast = renderPending
    try {
      await bridge.textContainerUpgrade(
        new TextContainerUpgrade({ containerID: 1, containerName: 'main', content: renderPending }),
      )
    } catch (err) {
      console.error('render failed', err)
    }
  }, RENDER.debounceMs)
}

// ---- Backend link ----
const link = new BackendLink({
  onOpen: () => {
    setStatus('ready')
    link.send({ type: 'config', ...config })
    render()
  },
  onClose: () => {
    setStatus('connecting')
    render() // → OFFLINE
  },
  onMessage: msg => {
    switch (msg.type) {
      case 'status':
        setStatus(msg.state, msg.message)
        break
      case 'partial':
        setPartial(msg.source)
        provisional = true
        render()
        break
      case 'segment':
        sentences.push(msg.target)
        provisional = false
        lastLatency = msg.latencyMs
        lastSrcCode = whisperToCode(msg.sourceLang)
        // If the user has scrolled back, keep their view anchored (don't yank).
        if (scrollOffset > 0) scrollOffset = Math.min(scrollOffset + 1, maxOffset())
        addSegment(msg.source, msg.target)
        render()
        break
      case 'pong':
        rtt = Math.max(0, Date.now() - msg.t)
        render()
        break
      case 'error':
        setStatus('error', msg.message)
        break
    }
  },
})

// ---- Config + mute helpers ----
function applyConfig(next: ClientConfig, reflectInUi: boolean) {
  config = next
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
  } catch {
    /* ignore */
  }
  link.send({ type: 'config', ...config })
  if (reflectInUi) syncConfig(config)
  render()
}

function toggleMute() {
  muted = !muted
  setMuted(muted)
  render()
}

mountUi({
  config,
  muted,
  onConfig: cfg => applyConfig(cfg, false),
  onToggleMute: toggleMute,
})

link.connect()

// ---- Mic + latency ping ----
await bridge.audioControl(true)
setStatus('listening')
render()

const pingTimer = window.setInterval(() => {
  if (link.isOpen) link.send({ type: 'ping', t: Date.now() })
}, 2000)

let cleanedUp = false
function cleanup() {
  if (cleanedUp) return
  cleanedUp = true
  window.clearInterval(pingTimer)
  bridge.audioControl(false)
  link.close()
  unsubscribe()
}

// ---- Events: mic PCM + R1 ring / temple control ----
//   • audioEvent.audioPcm → backend (unless muted).
//   • sysEvent CLICK (0, arrives undefined) → toggle mute.
//   • sysEvent/textEvent DOUBLE_CLICK → exit.
//   • textEvent SCROLL_TOP / SCROLL_BOTTOM (ring rotate) → cycle target language.
const unsubscribe = bridge.onEvenHubEvent(event => {
  const pcm = event.audioEvent?.audioPcm
  if (pcm && !muted) link.sendPcm(pcm)

  const sysType = event.sysEvent ? (event.sysEvent.eventType ?? OsEventTypeList.CLICK_EVENT) : null
  const textType = event.textEvent?.eventType ?? null

  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    bridge.shutDownPageContainer(1)
    return
  }
  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    cleanup()
    return
  }
  if (sysType === OsEventTypeList.CLICK_EVENT) {
    toggleMute()
    return
  }
  // Ring rotate → scroll the translation history (up = older, down = newer).
  if (textType === OsEventTypeList.SCROLL_TOP_EVENT) scrollBy(1)
  else if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) scrollBy(-1)
})

window.addEventListener('beforeunload', cleanup)

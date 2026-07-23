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
let scrollOffset = 0 // ring: 0 = follow newest, >0 = scrolled back into history

const bridge = await waitForEvenAppBridge()

// ---- Two containers (per the G2 display-design workflow) ----
// Status strip: slim, non-capture, top. Transcript body: the capture container.
const STATUS_H = 28
const statusBar = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: CANVAS.width,
  height: STATUS_H,
  borderWidth: 1,
  borderColor: 5, // subtle bottom rule
  paddingLength: 2, // small — 12 clipped the glyphs on this thin strip
  containerID: 2,
  containerName: 'status',
  content: 'AUTO>RU  LIVE',
  isEventCapture: 0,
})
const transBox = new TextContainerProperty({
  xPosition: 0,
  yPosition: STATUS_H + 2,
  width: CANVAS.width,
  height: CANVAS.height - STATUS_H - 2,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 12,
  containerID: 1,
  containerName: 'translation',
  content: 'Наведите слух...',
  isEventCapture: 1,
})

const created = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({ containerTotalNum: 2, textObject: [statusBar, transBox] }),
)
if (created !== 0) {
  setStatus('error', `createStartUpPageContainer failed: ${created}`)
  console.error('Failed to create startup page', created)
}

// ---- Transcript body: bottom-anchored rolling buffer, translation-only ----
const sentences: string[] = []
let provisional = false // a phrase is being translated → show trailing "..."
let bodyPending = 'Наведите слух...'
let bodyLast = ''
let bodyTimer: number | null = null

function maxOffset(): number {
  return Math.max(0, sentences.length - RENDER.maxLines)
}

function scrollBy(delta: number) {
  const next = Math.min(Math.max(0, scrollOffset + delta), maxOffset())
  if (next === scrollOffset) return
  scrollOffset = next
  renderBody()
  renderStatus()
}

function composeBody(): string {
  const start = Math.max(0, maxOffset() - scrollOffset)
  let text = sentences.slice(start, start + RENDER.maxLines).join('\n')
  if (provisional && scrollOffset === 0) text = text ? `${text}\n...` : '...'
  if (!text) return 'Наведите слух...'
  const cap = RENDER.maxLines * RENDER.maxCharsPerLine
  return text.length > cap ? text.slice(text.length - cap) : text
}

function renderBody() {
  bodyPending = composeBody()
  if (bodyTimer !== null) return
  bodyTimer = window.setTimeout(async () => {
    bodyTimer = null
    if (bodyPending === bodyLast) return
    bodyLast = bodyPending
    try {
      await bridge.textContainerUpgrade(
        new TextContainerUpgrade({ containerID: 1, containerName: 'translation', content: bodyPending }),
      )
    } catch (err) {
      console.error('body render failed', err)
    }
  }, RENDER.debounceMs)
}

// ---- Status strip: EN>RU LIVE/MUTE, lag by exception, OFFLINE on drop ----
function whisperToCode(name: string): string {
  const m = LANGUAGES.find(l => l.en.toLowerCase() === name.toLowerCase())
  return m?.code ?? name.slice(0, 2)
}

let statusLast = ''
function renderStatus() {
  let content: string
  if (!link.isOpen) {
    content = 'OFFLINE'
  } else {
    const src = (config.sourceLang !== 'auto' ? config.sourceLang : (lastSrcCode ?? 'auto')).toUpperCase()
    const tgt = config.targetLang.toUpperCase()
    content = `${src}>${tgt}  ${muted ? 'MUTE' : 'LIVE'}`
    if (scrollOffset > 0) content += '  HIST'
    if (RENDER.showPersistentPing) {
      content += `  net ${rtt ?? '-'}ms  tr ${lastLatency ?? '-'}ms`
    } else if (lastLatency != null && lastLatency > RENDER.lagThresholdMs) {
      content += `  LAG ${(lastLatency / 1000).toFixed(1)}s`
    }
  }
  if (content === statusLast) return
  statusLast = content
  bridge
    .textContainerUpgrade(new TextContainerUpgrade({ containerID: 2, containerName: 'status', content }))
    .catch(err => console.error('status render failed', err))
}

// ---- Backend link ----
const link = new BackendLink({
  onOpen: () => {
    setStatus('ready')
    link.send({ type: 'config', ...config })
    renderStatus()
  },
  onClose: () => {
    setStatus('connecting')
    renderStatus() // → OFFLINE
  },
  onMessage: msg => {
    switch (msg.type) {
      case 'status':
        setStatus(msg.state, msg.message)
        break
      case 'partial':
        setPartial(msg.source)
        provisional = true
        renderBody()
        break
      case 'segment':
        sentences.push(msg.target)
        provisional = false
        lastLatency = msg.latencyMs
        lastSrcCode = whisperToCode(msg.sourceLang)
        if (scrollOffset > 0) scrollOffset = Math.min(scrollOffset + 1, maxOffset()) // keep view anchored
        addSegment(msg.source, msg.target)
        renderBody()
        renderStatus()
        break
      case 'pong':
        rtt = Math.max(0, Date.now() - msg.t)
        renderStatus()
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
  renderStatus()
}

function toggleMute() {
  muted = !muted
  setMuted(muted)
  renderStatus()
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
renderStatus()

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

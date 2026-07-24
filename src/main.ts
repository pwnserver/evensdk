import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import { CANVAS, RENDER, WIDTH_CPL } from './config'
import { DEFAULT_CONFIG, LANGUAGES, type ClientConfig } from '../shared/protocol'
import { BackendLink } from './net'
import { mountUi, setStatus, setPartial, addSegment, setMuted, syncConfig } from './ui'

// ---- Persisted language/latency config ----
// Use the SDK's durable storage (bridge.get/setLocalStorage) — the WebView's own
// localStorage does NOT survive an app reload in the Even companion app.
const CONFIG_KEY = 'even-translate-config'
let config: ClientConfig = { ...DEFAULT_CONFIG }
let muted = false
let rtt: number | null = null // network round-trip ms
let lastLatency: number | null = null // server STT+translate ms
let lastSrcCode: string | null = null // detected source (for the EN>RU strip)
let scrollOffset = 0 // ring: 0 = follow newest, >0 = scrolled back into history
let hidden = false // single tap hides the transcript (non-destructive); tap again shows it

const bridge = await waitForEvenAppBridge()

async function loadConfig(): Promise<ClientConfig> {
  try {
    const raw = await bridge.getLocalStorage(CONFIG_KEY)
    if (raw) return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<ClientConfig>) }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_CONFIG }
}
config = await loadConfig()

// ---- Two containers (per the G2 display-design workflow) ----
// Status strip: slim, non-capture, top. Transcript body: the capture container.
const STATUS_H = 28
const statusBar = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: CANVAS.width,
  height: STATUS_H,
  borderWidth: 0, // no frame
  borderColor: 5,
  paddingLength: 2,
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
  content: ' ', // empty until the first translation (no persistent placeholder)
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
const sentences: string[] = [] // committed translations (Russian)
let provisional = false // speech in progress → show the live source line
let partialSource = '' // interim SOURCE text for the utterance being spoken
let bodyPending = ' '
let bodyLast = ''
let bodyTimer: number | null = null

function maxOffset(): number {
  return Math.max(0, sentences.length - RENDER.maxLines)
}

function scrollBy(delta: number) {
  if (hidden) hidden = false // scrolling brings the text back
  const next = Math.min(Math.max(0, scrollOffset + delta), maxOffset())
  if (next === scrollOffset && !hidden) return
  scrollOffset = next
  bodyLast = ''
  renderBody()
  renderStatus()
}

// Single ring tap → hide/show the transcript (non-destructive). Nothing is
// deleted, so a tap again (or a scroll) brings it right back — safe against a
// stray tap, unlike a silent mic mute.
function toggleTranscript() {
  hidden = !hidden
  bodyLast = '' // force a redraw
  renderBody()
  renderStatus()
}

// Keep the last `budget` chars of `s`; '...'-prefix if we cut into it. Firmware
// wraps for us, so this is pure char-tailing (stt-even-g2's render model).
function charTail(s: string, budget: number): string {
  return s.length > budget ? RENDER.ellipsis + s.slice(s.length - budget) : s
}

// Word-wrap into lines of <= cpl chars. Firmware also wraps, but manual wrapping
// lets the width/line-count settings control the column without touching geometry.
function wrap(text: string, cpl: number): string[] {
  const out: string[] = []
  let cur = ''
  for (let word of text.split(/\s+/).filter(Boolean)) {
    while (word.length > cpl) {
      if (cur) { out.push(cur); cur = '' }
      out.push(word.slice(0, cpl))
      word = word.slice(cpl)
    }
    if (!cur) cur = word
    else if (cur.length + 1 + word.length <= cpl) cur += ` ${word}`
    else { out.push(cur); cur = word }
  }
  if (cur) out.push(cur)
  return out
}

function composeBody(): string {
  if (hidden) return ' '
  const cpl = WIDTH_CPL[config.width]

  // History view (ring-scrolled back): sentence-paged, newest block at bottom.
  if (scrollOffset > 0) {
    const start = Math.max(0, maxOffset() - scrollOffset)
    const text = sentences.slice(start, start + RENDER.maxLines).join('\n')
    return text ? charTail(text, RENDER.maxLines * RENDER.maxCharsPerLine) : ' '
  }

  // Live view (follow-newest): committed Russian, wrapped to `width`, showing the
  // last `lines` lines, newest at the bottom; plus the live source line "> …"
  // while speech is ongoing (replaced by clean Russian within ~1s).
  const committed = sentences.join(' ').replace(/\s+/g, ' ').trim()
  const wrapped = wrap(committed, cpl)
  const reserve = provisional ? 1 : 0 // keep a row for the live line
  const keep = Math.max(0, config.lines - reserve)
  const lines = wrapped.slice(Math.max(0, wrapped.length - keep))

  if (provisional) {
    const src = partialSource.replace(/\s+/g, ' ').trim()
    lines.push(RENDER.provMarker + (src ? charTail(src, cpl) : RENDER.ellipsis))
  }
  return lines.join('\n') || ' '
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
  } else if (config.status === 'off') {
    content = ' ' // strip hidden — container stays (geometry unchanged), shows nothing
  } else {
    const src = (config.sourceLang !== 'auto' ? config.sourceLang : (lastSrcCode ?? 'auto')).toUpperCase()
    const tgt = config.targetLang.toUpperCase()
    content = `${src}>${tgt}  ${muted ? 'MUTE' : 'LIVE'}`
    if (hidden) content += '  HIDE'
    else if (scrollOffset > 0) content += '  HIST'
    if (config.status === 'ping') {
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
      case 'interim': {
        // Live running caption. An empty source clears it (server sends '' at
        // finalize, including when the final result is filtered/unrenderable).
        const live = msg.source
        setPartial(live)
        if (live) {
          partialSource = live
          provisional = true
        } else {
          partialSource = ''
          provisional = false
        }
        renderBody()
        break
      }
      case 'segment':
        sentences.push(msg.target)
        provisional = false
        partialSource = '' // committed → drop the live line
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
  void bridge.setLocalStorage(CONFIG_KEY, JSON.stringify(config)).catch(() => {})
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
// Tactile map (this device): single tap → clear, double tap → mute,
// ring rotate → scroll history. Long-press is the OS menu / app switcher (exit),
// so the app is left via the system, not a bound gesture.
const unsubscribe = bridge.onEvenHubEvent(event => {
  const pcm = event.audioEvent?.audioPcm
  if (pcm && !muted) link.sendPcm(pcm)

  const sysType = event.sysEvent ? (event.sysEvent.eventType ?? OsEventTypeList.CLICK_EVENT) : null
  const textType = event.textEvent?.eventType ?? null

  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    toggleMute()
    return
  }
  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    cleanup()
    return
  }
  if (sysType === OsEventTypeList.CLICK_EVENT) {
    toggleTranscript()
    return
  }
  if (textType === OsEventTypeList.SCROLL_TOP_EVENT) scrollBy(1)
  else if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) scrollBy(-1)
})

window.addEventListener('beforeunload', cleanup)

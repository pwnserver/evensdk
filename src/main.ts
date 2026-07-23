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

const bridge = await waitForEvenAppBridge()

// ---- Two containers: a thin top status strip + the translation area ----
const STATUS_H = 32
const statusBar = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: CANVAS.width,
  height: STATUS_H,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: 2,
  containerName: 'status',
  content: 'RU  net —  tr —',
  isEventCapture: 1,
})
const transBox = new TextContainerProperty({
  xPosition: 0,
  yPosition: STATUS_H,
  width: CANVAS.width,
  height: CANVAS.height - STATUS_H,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: 1,
  containerName: 'translation',
  content: 'Наведите слух…',
  isEventCapture: 1,
})

const created = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({ containerTotalNum: 2, textObject: [statusBar, transBox] }),
)
if (created !== 0) {
  setStatus('error', `createStartUpPageContainer failed: ${created}`)
  console.error('Failed to create startup page', created)
}

// ---- Glasses rendering ----
const lines: string[] = []
let pending = 'Наведите слух…'
let lastTrans = ''
let transTimer: number | null = null

function scheduleTransRender() {
  const text = lines.slice(-RENDER.maxLines).join('\n')
  pending = text ? text.slice(-RENDER.maxChars) : 'Наведите слух…'
  if (transTimer !== null) return
  transTimer = window.setTimeout(async () => {
    transTimer = null
    if (pending === lastTrans) return
    lastTrans = pending
    try {
      await bridge.textContainerUpgrade(
        new TextContainerUpgrade({ containerID: 1, containerName: 'translation', content: pending }),
      )
    } catch (err) {
      console.error('trans render failed', err)
    }
  }, RENDER.debounceMs)
}

let lastStatus = ''
function renderStatus() {
  const parts: string[] = []
  if (muted) parts.push('MUTE')
  parts.push(config.targetLang.toUpperCase())
  parts.push(rtt != null ? `net ${rtt}ms` : 'net —')
  parts.push(lastLatency != null ? `tr ${lastLatency}ms` : 'tr —')
  const content = parts.join('  ')
  if (content === lastStatus) return
  lastStatus = content
  bridge
    .textContainerUpgrade(new TextContainerUpgrade({ containerID: 2, containerName: 'status', content }))
    .catch(err => console.error('status render failed', err))
}

// ---- Backend link ----
const link = new BackendLink({
  onOpen: () => {
    setStatus('ready')
    link.send({ type: 'config', ...config }) // (re)apply on (re)connect
  },
  onClose: () => setStatus('connecting'),
  onMessage: msg => {
    switch (msg.type) {
      case 'status':
        setStatus(msg.state, msg.message)
        break
      case 'partial':
        setPartial(msg.source)
        break
      case 'segment':
        lines.push(msg.target)
        lastLatency = msg.latencyMs
        addSegment(msg.source, msg.target)
        scheduleTransRender()
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

function cycleTarget(dir: 1 | -1) {
  const codes: string[] = LANGUAGES.map(l => l.code)
  const i = Math.max(0, codes.indexOf(config.targetLang))
  const next = codes[(i + dir + codes.length) % codes.length]
  applyConfig({ ...config, targetLang: next }, true)
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

  // Root-level exit: always reachable.
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
  if (textType === OsEventTypeList.SCROLL_TOP_EVENT) cycleTarget(-1)
  else if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) cycleTarget(1)
})

window.addEventListener('beforeunload', cleanup)

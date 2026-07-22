import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import { CANVAS, RENDER } from './config'
import { BackendLink } from './net'
import { mountUi, setStatus, setPartial, addSegment } from './ui'

mountUi()

const bridge = await waitForEvenAppBridge()

// One full-canvas text container holds the running translation.
const glasses = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: CANVAS.width,
  height: CANVAS.height,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: 1,
  containerName: 'translation',
  content: 'Наведите слух…', // "Listening…"
  isEventCapture: 1,
})

const created = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [glasses] }),
)
if (created !== 0) {
  setStatus('error', `createStartUpPageContainer failed: ${created}`)
  console.error('Failed to create startup page', created)
}

// ---- Glasses rendering: recent translated lines, debounced ----
const lines: string[] = []
let pending = 'Наведите слух…'
let lastRendered = ''
let renderTimer: number | null = null

function composeGlasses(): string {
  const text = lines.slice(-RENDER.maxLines).join('\n')
  return text ? text.slice(-RENDER.maxChars) : 'Наведите слух…'
}

function scheduleRender() {
  pending = composeGlasses()
  if (renderTimer !== null) return
  renderTimer = window.setTimeout(async () => {
    renderTimer = null
    if (pending === lastRendered) return
    lastRendered = pending
    try {
      await bridge.textContainerUpgrade(
        new TextContainerUpgrade({ containerID: 1, containerName: 'translation', content: pending }),
      )
    } catch (err) {
      console.error('render failed', err)
    }
  }, RENDER.debounceMs)
}

// ---- Backend link: PCM up, translations down ----
const link = new BackendLink({
  onOpen: () => setStatus('ready'),
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
        addSegment(msg.source, msg.target)
        scheduleRender()
        break
      case 'error':
        setStatus('error', msg.message)
        break
    }
  },
})
link.connect()

// ---- Mic capture ----
await bridge.audioControl(true)
setStatus('listening')

let cleanedUp = false
function cleanup() {
  if (cleanedUp) return
  cleanedUp = true
  bridge.audioControl(false)
  link.close()
  unsubscribe()
}

// Event routing (see the ASR template for the rationale):
//   • audioEvent.audioPcm → forward to backend.
//   • sysEvent double-tap → shut down so the user can always exit.
//   • system/abnormal exit → clean up mic + socket.
const unsubscribe = bridge.onEvenHubEvent(event => {
  const pcm = event.audioEvent?.audioPcm
  if (pcm) link.sendPcm(pcm)

  const sysType = event.sysEvent?.eventType ?? null
  const textType = event.textEvent?.eventType ?? null

  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    bridge.shutDownPageContainer(1)
    return
  }
  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    cleanup()
  }
})

window.addEventListener('beforeunload', cleanup)

import { parseServerMessage, type ServerMessage } from '../shared/protocol'
import { backendWsUrl } from './config'

type Handlers = {
  onMessage: (msg: ServerMessage) => void
  onOpen: () => void
  onClose: () => void
}

/**
 * Resilient WebSocket link to the Mac backend. Forwards mic PCM up, receives
 * translations down, and auto-reconnects with backoff (the phone can roam
 * networks or the backend can restart mid-session).
 */
export class BackendLink {
  private ws: WebSocket | null = null
  private closed = false
  private reconnectMs = 500
  private readonly url = backendWsUrl()

  constructor(private readonly handlers: Handlers) {}

  connect() {
    this.closed = false
    this.open()
  }

  private open() {
    if (this.closed) return
    const ws = new WebSocket(this.url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws

    ws.onopen = () => {
      this.reconnectMs = 500
      this.handlers.onOpen()
    }
    ws.onmessage = ev => {
      if (typeof ev.data !== 'string') return // server never sends binary
      const msg = parseServerMessage(ev.data)
      if (msg) this.handlers.onMessage(msg)
    }
    ws.onclose = () => {
      this.handlers.onClose()
      this.scheduleReconnect()
    }
    ws.onerror = () => {
      // onclose fires next; reconnect is handled there.
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    }
  }

  private scheduleReconnect() {
    if (this.closed) return
    const delay = this.reconnectMs
    this.reconnectMs = Math.min(this.reconnectMs * 2, 8000)
    window.setTimeout(() => this.open(), delay)
  }

  /** Forward one raw PCM chunk (s16le/16k/mono) to the backend. */
  sendPcm(pcm: Uint8Array) {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    // Copy into a standalone ArrayBuffer — the SDK may reuse the backing buffer.
    ws.send(pcm.slice().buffer)
  }

  close() {
    this.closed = true
    try {
      this.ws?.close()
    } catch {
      /* ignore */
    }
    this.ws = null
  }
}

// Wire protocol between the G2 WebView app (client) and the Mac backend (server).
//
// Client → Server:
//   • binary WebSocket frames = raw glasses mic PCM (s16le, 16 kHz, mono),
//     forwarded verbatim from `event.audioEvent.audioPcm`.
//   • no JSON is sent from the client in v1.
//
// Server → Client: JSON text frames, one `ServerMessage` per frame.

/** Audio format the glasses mic delivers and the backend expects. */
export const AUDIO = {
  sampleRate: 16000,
  channels: 1,
  bytesPerSample: 2, // s16le
} as const

export type ServerMessage =
  | { type: 'status'; state: 'ready' | 'listening' | 'error'; message?: string }
  /** Interim source-language transcript for the utterance in progress (not yet translated). */
  | { type: 'partial'; source: string }
  /** A finalized, translated line. `id` increases monotonically per connection. */
  | { type: 'segment'; id: number; source: string; sourceLang: string; target: string }
  | { type: 'error'; message: string }

export function parseServerMessage(data: string): ServerMessage | null {
  try {
    const msg = JSON.parse(data) as ServerMessage
    return msg && typeof msg.type === 'string' ? msg : null
  } catch {
    return null
  }
}

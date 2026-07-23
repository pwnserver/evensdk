// Wire protocol between the G2 WebView app (client) and the Mac/server backend.
//
// Client → Server:
//   • binary WebSocket frames = raw glasses mic PCM (s16le, 16 kHz, mono),
//     forwarded verbatim from `event.audioEvent.audioPcm`.
//   • text frames = JSON `ClientMessage` (currently just live config).
//
// Server → Client: text frames, one `ServerMessage` per frame.

/** Audio format the glasses mic delivers and the backend expects. */
export const AUDIO = {
  sampleRate: 16000,
  channels: 1,
  bytesPerSample: 2, // s16le
} as const

/**
 * Supported languages.
 *  • `code`  — ISO-639-1, used as the whisper language ('auto' = detect).
 *  • `label` — shown in the companion-app menus.
 *  • `en`    — English name, used in the Claude translation prompt.
 */
export const LANGUAGES = [
  { code: 'ru', label: 'Русский', en: 'Russian' },
  { code: 'en', label: 'English', en: 'English' },
  { code: 'es', label: 'Español', en: 'Spanish' },
  { code: 'de', label: 'Deutsch', en: 'German' },
  { code: 'fr', label: 'Français', en: 'French' },
  { code: 'it', label: 'Italiano', en: 'Italian' },
  { code: 'pt', label: 'Português', en: 'Portuguese' },
  { code: 'uk', label: 'Українська', en: 'Ukrainian' },
  { code: 'tr', label: 'Türkçe', en: 'Turkish' },
  { code: 'ar', label: 'العربية', en: 'Arabic' },
  { code: 'zh', label: '中文', en: 'Chinese' },
  { code: 'ja', label: '日本語', en: 'Japanese' },
  { code: 'ko', label: '한국어', en: 'Korean' },
] as const

export type LangCode = (typeof LANGUAGES)[number]['code']

/** English name for the Claude prompt; falls back to the code. */
export function langEnName(code: string): string {
  return LANGUAGES.find(l => l.code === code)?.en ?? code
}

/** Latency/quality presets — trade end-of-phrase wait + model for speed. */
export type LatencyMode = 'fast' | 'balanced' | 'accurate'

export type ClientConfig = {
  /** whisper source language, or 'auto' to detect. */
  sourceLang: string
  /** target language code to translate into. */
  targetLang: string
  /** latency/quality tradeoff. */
  latency: LatencyMode
}

export const DEFAULT_CONFIG: ClientConfig = { sourceLang: 'auto', targetLang: 'ru', latency: 'balanced' }

export type ClientMessage =
  | ({ type: 'config' } & ClientConfig)
  /** RTT probe: server echoes it back as pong with the same `t`. */
  | { type: 'ping'; t: number }

export type ServerMessage =
  | { type: 'status'; state: 'ready' | 'listening' | 'error'; message?: string }
  /** Interim source-language transcript for the utterance in progress. */
  | { type: 'partial'; source: string }
  /** A finalized, translated line. `latencyMs` = server STT+translate time. */
  | { type: 'segment'; id: number; source: string; sourceLang: string; target: string; latencyMs: number }
  | { type: 'pong'; t: number }
  | { type: 'error'; message: string }

export function parseServerMessage(data: string): ServerMessage | null {
  try {
    const msg = JSON.parse(data) as ServerMessage
    return msg && typeof msg.type === 'string' ? msg : null
  } catch {
    return null
  }
}

export function parseClientMessage(data: string): ClientMessage | null {
  try {
    const msg = JSON.parse(data) as ClientMessage
    return msg && (msg.type === 'config' || msg.type === 'ping') ? msg : null
  } catch {
    return null
  }
}

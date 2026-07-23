import { pcm16ToWav } from './wav'

const WHISPER_URL = process.env.WHISPER_URL ?? 'http://127.0.0.1:8080'
const INFERENCE_PATH = process.env.WHISPER_INFERENCE_PATH ?? '/inference'

export type Transcript = { text: string; language: string }

// whisper.cpp emits these placeholders on silence / music / non-speech.
const HALLUCINATIONS = new Set(
  [
    '[blank_audio]',
    '(silence)',
    '[silence]',
    '[ silence ]',
    'you',
    'thank you.',
    'thanks for watching!',
    '[music]',
    '(music)',
    '[ pause ]',
  ].map(s => s.toLowerCase()),
)

function looksLikeNoise(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (t.length < 2) return true
  if (HALLUCINATIONS.has(t)) return true
  // Pure bracketed annotation, e.g. "[wind blowing]".
  if (/^[[(].*[\])]$/.test(t)) return true
  return false
}

/**
 * Transcribe one utterance via a running whisper-server (whisper.cpp).
 * `language: 'auto'` (default) lets whisper detect the spoken language;
 * pass a specific ISO-639-1 code to pin it.
 */
export async function transcribe(pcm: Buffer, language?: string): Promise<Transcript | null> {
  const wav = pcm16ToWav(pcm)
  const form = new FormData()
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav')
  form.append('response_format', 'verbose_json')
  form.append('temperature', '0')
  form.append('language', language || process.env.WHISPER_LANGUAGE || 'auto')

  const res = await fetch(`${WHISPER_URL}${INFERENCE_PATH}`, { method: 'POST', body: form })
  if (!res.ok) {
    throw new Error(`whisper-server ${res.status}: ${await res.text().catch(() => '')}`)
  }
  const data = (await res.json()) as { text?: string; language?: string }
  const text = (data.text ?? '').trim()
  if (!text || looksLikeNoise(text)) return null
  return { text, language: data.language ?? 'unknown' }
}

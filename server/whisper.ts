import { pcm16ToWav } from './wav'

const WHISPER_URL = process.env.WHISPER_URL ?? 'http://127.0.0.1:8080'
const INFERENCE_PATH = process.env.WHISPER_INFERENCE_PATH ?? '/inference'

export type Transcript = { text: string; language: string }

// whisper.cpp emits these placeholders/hallucinations on silence / music /
// non-speech. Exact-match set (lowercased).
const HALLUCINATIONS = new Set(
  [
    '[blank_audio]',
    '(silence)',
    '[silence]',
    '[ silence ]',
    'you',
    'thank you.',
    'thanks for watching!',
    'bye.',
    'bye bye.',
    '[music]',
    '(music)',
    '[ pause ]',
    '.',
    '..',
    '...',
    '!',
    '?',
    'продолжение следует...',
    'субтитры',
  ].map(s => s.toLowerCase()),
)

// Pattern-based hallucinations (sound-event annotations, subtitle credits, etc.)
// Tested against the raw source text (any language) before translation.
const HALLUCINATION_PATTERNS: RegExp[] = [
  /^\s*\*.*\*\s*$/, // *sizzling*, *Spannungsgeladene Musik*
  /^\s*[[(].*[\])]\s*$/, // [music], (wind blowing)
  /untertitel/i, // German subtitle credits (ZDF, ...)
  /amara\.org/i,
  /\bsubtitl/i, // "subtitles by ..."
  /\bzdf\b/i,
  /перевод\s+субтитров|субтитры\s+(?:зд|by|—)/i,
  /thanks?\s+for\s+watching/i,
  /(?:please\s+)?subscribe/i,
]

function looksLikeNoise(text: string): boolean {
  const t = text.trim()
  if (t.length < 2) return true
  if (HALLUCINATIONS.has(t.toLowerCase())) return true
  return HALLUCINATION_PATTERNS.some(re => re.test(t))
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

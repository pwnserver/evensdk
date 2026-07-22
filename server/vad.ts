import { AUDIO } from '../shared/protocol'

const SAMPLES_PER_MS = AUDIO.sampleRate / 1000 // 16 samples/ms at 16 kHz

export type VadConfig = {
  /** End an utterance after this much trailing silence. */
  hangoverMs: number
  /** Ignore utterances with less than this much actual voiced audio (noise). */
  minVoicedMs: number
  /** Force-flush a long monologue so the display keeps updating. */
  maxUtteranceMs: number
  /** Speech must exceed noiseFloor * this ratio (adaptive gate). */
  speechRatio: number
  /** Absolute floor so a dead-silent room doesn't make everything "speech". */
  minRms: number
}

export const DEFAULT_VAD: VadConfig = {
  hangoverMs: 700,
  minVoicedMs: 350,
  maxUtteranceMs: 9000,
  speechRatio: 2.2,
  minRms: 260, // ~ -42 dBFS on int16
}

function rms16(chunk: Buffer): number {
  const n = Math.floor(chunk.length / 2)
  if (n === 0) return 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const s = chunk.readInt16LE(i * 2)
    sum += s * s
  }
  return Math.sqrt(sum / n)
}

const durationMs = (chunk: Buffer) => chunk.length / 2 / SAMPLES_PER_MS

/**
 * Energy-based voice-activity segmenter with an adaptive noise floor.
 * Feed it PCM chunks; it returns completed utterances (as PCM Buffers)
 * whenever it detects an end-of-speech pause or a max-length cutoff.
 */
export class VadSegmenter {
  private readonly cfg: VadConfig
  private buf: Buffer[] = []
  private preRoll: Buffer | null = null // one chunk of lead-in before speech starts
  private inSpeech = false
  private voicedMs = 0
  private silenceMs = 0
  private bufferedMs = 0
  private noiseFloor: number

  constructor(cfg: Partial<VadConfig> = {}) {
    this.cfg = { ...DEFAULT_VAD, ...cfg }
    this.noiseFloor = this.cfg.minRms
  }

  push(chunk: Buffer): Buffer[] {
    if (chunk.length < 2) return []
    const dur = durationMs(chunk)
    const energy = rms16(chunk)
    const gate = Math.max(this.cfg.minRms, this.noiseFloor * this.cfg.speechRatio)
    const voiced = energy > gate
    const out: Buffer[] = []

    if (voiced) {
      if (!this.inSpeech) {
        this.inSpeech = true
        this.buf = []
        this.voicedMs = 0
        this.silenceMs = 0
        this.bufferedMs = 0
        if (this.preRoll) {
          this.buf.push(this.preRoll)
          this.bufferedMs += durationMs(this.preRoll)
          this.preRoll = null
        }
      }
      this.buf.push(chunk)
      this.bufferedMs += dur
      this.voicedMs += dur
      this.silenceMs = 0
    } else {
      // Slowly track the ambient noise floor while no one is speaking.
      this.noiseFloor = this.noiseFloor * 0.95 + energy * 0.05
      if (this.inSpeech) {
        this.buf.push(chunk) // keep trailing silence so words aren't clipped
        this.bufferedMs += dur
        this.silenceMs += dur
        if (this.silenceMs >= this.cfg.hangoverMs) {
          const seg = this.flush()
          if (seg) out.push(seg)
        }
      } else {
        this.preRoll = chunk
      }
    }

    if (this.inSpeech && this.bufferedMs >= this.cfg.maxUtteranceMs) {
      const seg = this.flush()
      if (seg) out.push(seg)
    }
    return out
  }

  private flush(): Buffer | null {
    const enoughSpeech = this.voicedMs >= this.cfg.minVoicedMs
    const seg = enoughSpeech ? Buffer.concat(this.buf) : null
    this.inSpeech = false
    this.buf = []
    this.voicedMs = 0
    this.silenceMs = 0
    this.bufferedMs = 0
    return seg
  }
}

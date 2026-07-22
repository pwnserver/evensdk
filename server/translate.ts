import Anthropic from '@anthropic-ai/sdk'

// Per the claude-api skill: default to claude-opus-4-8. For a live translator you
// can trade a little quality for latency via TRANSLATE_MODEL (e.g. claude-haiku-4-5
// or claude-sonnet-5). Opus 4.8 with thinking omitted runs without thinking (fast).
const MODEL = process.env.TRANSLATE_MODEL ?? 'claude-opus-4-8'
const MAX_TOKENS = Number(process.env.TRANSLATE_MAX_TOKENS ?? 400)
const HISTORY_TURNS = 5 // rolling context for coherence & terminology

const SYSTEM = `You are a professional live interpreter. You translate spoken foreign speech into natural, fluent Russian.

Rules:
- Output ONLY the Russian translation. No quotes, no notes, no explanations, no source text.
- The input comes from speech recognition and may contain small errors — silently correct obvious mishearings using context.
- Preserve proper names, numbers, places, and the speaker's tone and register.
- Keep it conversational and idiomatic, the way a skilled human interpreter would say it — not word-for-word.
- Prior turns are given for context so pronouns, gender, and terminology stay consistent. Translate only the latest line.
- If the latest line is already Russian, return it lightly cleaned up.`

type Turn = { source: string; target: string }

export class Translator {
  private readonly client = new Anthropic()
  private history: Turn[] = []

  async translate(source: string, sourceLang: string): Promise<string> {
    const messages: Anthropic.MessageParam[] = []
    for (const turn of this.history.slice(-HISTORY_TURNS)) {
      messages.push({ role: 'user', content: turn.source })
      messages.push({ role: 'assistant', content: turn.target })
    }
    const langHint = sourceLang && sourceLang !== 'unknown' ? ` [detected language: ${sourceLang}]` : ''
    messages.push({ role: 'user', content: `${source}${langHint}` })

    const res = await this.client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages,
    })

    const target = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim()

    if (target) {
      this.history.push({ source, target })
      if (this.history.length > HISTORY_TURNS * 2) this.history = this.history.slice(-HISTORY_TURNS)
    }
    return target
  }
}

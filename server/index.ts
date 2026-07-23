import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { extname, normalize } from 'node:path'
import process from 'node:process'
import { WebSocketServer, WebSocket } from 'ws'
import type { ClientConfig, LatencyMode, ServerMessage } from '../shared/protocol'
import { DEFAULT_CONFIG, langEnName, parseClientMessage } from '../shared/protocol'
import { VadSegmenter } from './vad'
import { transcribe } from './whisper'
import { Translator } from './translate'

// Latency/quality presets: end-of-phrase wait (VAD) + translation model.
// A TRANSLATE_MODEL env var, if set, overrides the model for every preset.
const LATENCY_PRESETS: Record<LatencyMode, { hangoverMs: number; maxUtteranceMs: number; model: string }> = {
  // Default to opus-4-8 everywhere (confirmed working on this key). "fast" tries
  // haiku for lower latency; if the key lacks it, only that preset errors.
  fast: { hangoverMs: 380, maxUtteranceMs: 6000, model: 'claude-haiku-4-5' },
  balanced: { hangoverMs: 650, maxUtteranceMs: 9000, model: 'claude-opus-4-8' },
  accurate: { hangoverMs: 950, maxUtteranceMs: 12000, model: 'claude-opus-4-8' },
}
const presetModel = (m: LatencyMode) => process.env.TRANSLATE_MODEL || LATENCY_PRESETS[m].model
const makeVad = (m: LatencyMode) =>
  new VadSegmenter({ hangoverMs: LATENCY_PRESETS[m].hangoverMs, maxUtteranceMs: LATENCY_PRESETS[m].maxUtteranceMs })
const makeTranslator = (c: ClientConfig) => new Translator(langEnName(c.targetLang), presetModel(c.latency))

// Load .env.local (ANTHROPIC_API_KEY, overrides) if present. Node 20.12+/22+.
try {
  process.loadEnvFile('.env.local')
} catch {
  /* no .env.local — rely on the ambient environment (e.g. Docker env) */
}

const PORT = Number(process.env.PORT ?? 8787)
const DIST = fileURLToPath(new URL('../dist', import.meta.url))

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('⚠️  ANTHROPIC_API_KEY is not set. Translation will fail until you provide it.')
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
}

async function serveStatic(pathname: string, res: import('node:http').ServerResponse) {
  // Resolve within DIST; fall back to index.html (single-page app).
  const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '')
  const target = rel === '' ? 'index.html' : rel
  for (const candidate of [target, 'index.html']) {
    try {
      const body = await readFile(`${DIST}/${candidate}`)
      res.writeHead(200, { 'content-type': MIME[extname(candidate)] ?? 'application/octet-stream' })
      res.end(body)
      return
    } catch {
      /* try next */
    }
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found')
}

const http = createServer((req, res) => {
  // Debug endpoint: exercise the Claude path without audio.
  //   curl -X POST localhost:8787/debug/translate -d 'Hello, how are you?'
  if (req.method === 'POST' && req.url === '/debug/translate') {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', async () => {
      try {
        const target = await new Translator().translate(body.trim(), 'auto')
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ source: body.trim(), target }))
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: String((err as Error)?.message ?? err) }))
      }
    })
    return
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }
  // Everything else: serve the built glasses app.
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  void serveStatic(pathname, res)
})

// WebSocket lives at /ws so it shares the port with the static app.
const wss = new WebSocketServer({ server: http, path: '/ws' })

wss.on('connection', ws => {
  let cfg: ClientConfig = { ...DEFAULT_CONFIG }
  let vad = makeVad(cfg.latency)
  let translator = makeTranslator(cfg)
  let segId = 0
  let queue: Promise<void> = Promise.resolve()

  const send = (msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }

  send({ type: 'status', state: 'ready' })
  console.log('client connected')

  ws.on('message', (data, isBinary) => {
    if (!isBinary) {
      const m = parseClientMessage(data.toString())
      if (!m) return
      if (m.type === 'ping') {
        send({ type: 'pong', t: m.t }) // RTT probe
        return
      }
      // Live config: language + latency preset.
      const prev = cfg
      cfg = {
        sourceLang: m.sourceLang || 'auto',
        targetLang: m.targetLang || prev.targetLang,
        latency: m.latency || prev.latency,
      }
      if (cfg.latency !== prev.latency) vad = makeVad(cfg.latency)
      if (cfg.targetLang !== prev.targetLang || cfg.latency !== prev.latency) translator = makeTranslator(cfg)
      console.log(`config: ${cfg.sourceLang} → ${cfg.targetLang} · ${cfg.latency} (${presetModel(cfg.latency)})`)
      return
    }
    const pcm = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
    for (const segment of vad.push(pcm)) {
      queue = queue
        .then(() => handleSegment(segment))
        .catch(err => {
          console.error('segment error', err)
          send({ type: 'error', message: String((err as Error)?.message ?? err) })
        })
    }
  })

  ws.on('close', () => console.log('client disconnected'))
  ws.on('error', err => console.error('ws error', err))

  async function handleSegment(pcm: Buffer) {
    const t0 = Date.now()
    const stt = await transcribe(pcm, cfg.sourceLang === 'auto' ? undefined : cfg.sourceLang)
    if (!stt) return
    send({ type: 'partial', source: stt.text })
    const target = await translator.translate(stt.text, stt.language)
    if (!target) return
    const latencyMs = Date.now() - t0
    send({ type: 'segment', id: segId++, source: stt.text, sourceLang: stt.language, target, latencyMs })
    console.log(`[${stt.language}→${cfg.targetLang} ${latencyMs}ms] ${stt.text}  →  ${target}`)
  }
})

http.listen(PORT, () => {
  console.log(`Even Translate on http://0.0.0.0:${PORT}  (app + ws://…/ws)`)
  console.log(`Whisper: ${process.env.WHISPER_URL ?? 'http://127.0.0.1:8080'}`)
  console.log(`Model:   ${process.env.TRANSLATE_MODEL ?? 'claude-opus-4-8'}`)
})

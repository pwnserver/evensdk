import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { extname, normalize } from 'node:path'
import process from 'node:process'
import { WebSocketServer, WebSocket } from 'ws'
import type { ServerMessage } from '../shared/protocol'
import { DEFAULT_CONFIG, langEnName, parseClientMessage } from '../shared/protocol'
import { VadSegmenter } from './vad'
import { transcribe } from './whisper'
import { Translator } from './translate'

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
  const vad = new VadSegmenter()
  let sourceLang = DEFAULT_CONFIG.sourceLang // 'auto' or an ISO-639-1 code
  let targetLang = DEFAULT_CONFIG.targetLang
  let translator = new Translator(langEnName(targetLang))
  let segId = 0
  let queue: Promise<void> = Promise.resolve()

  const send = (msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }

  send({ type: 'status', state: 'ready' })
  console.log('client connected')

  ws.on('message', (data, isBinary) => {
    if (!isBinary) {
      // Live config from the companion app (language selection).
      const cfg = parseClientMessage(data.toString())
      if (!cfg) return
      sourceLang = cfg.sourceLang || 'auto'
      if (cfg.targetLang && cfg.targetLang !== targetLang) {
        targetLang = cfg.targetLang
        translator = new Translator(langEnName(targetLang)) // fresh context in the new language
      }
      console.log(`config: ${sourceLang} → ${targetLang}`)
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
    const stt = await transcribe(pcm, sourceLang === 'auto' ? undefined : sourceLang)
    if (!stt) return
    send({ type: 'partial', source: stt.text })
    const target = await translator.translate(stt.text, stt.language)
    if (!target) return
    send({ type: 'segment', id: segId++, source: stt.text, sourceLang: stt.language, target })
    console.log(`[${stt.language}→${targetLang}] ${stt.text}  →  ${target}`)
  }
})

http.listen(PORT, () => {
  console.log(`Even Translate on http://0.0.0.0:${PORT}  (app + ws://…/ws)`)
  console.log(`Whisper: ${process.env.WHISPER_URL ?? 'http://127.0.0.1:8080'}`)
  console.log(`Model:   ${process.env.TRANSLATE_MODEL ?? 'claude-opus-4-8'}`)
})

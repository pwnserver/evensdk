# Deploy on the GB10 (Blackwell) server

The whole translator is **one small container** that serves the glasses web app
**and** the `/ws` translation socket on one port (`:8787`). Speech recognition
(Whisper) runs on the **GPU** — we reuse the whisper.cpp container you already
have; Claude does the translation over the network.

```
glasses → Even Hub (iPhone) ──Tailscale──> gx10:8787  (this container)
                                              ├─ serves the web app
                                              ├─ /ws: VAD → Whisper → Claude
                                              └─ Whisper: your GPU whisper.cpp (127.0.0.1:8081)
```

No Mac needed once this runs. Phone reaches the server over Tailscale
(`100.64.0.5`).

## 1. Get the code on the server

```bash
cd /opt/stacks
git clone https://github.com/<you>/evensdk.git even-translate
cd even-translate
```

## 2. Configure

```bash
cp .env.example .env
# edit .env → ANTHROPIC_API_KEY=sk-ant-...
# and point WHISPER_URL at your GPU whisper (see step 3)
```

## 3. Pick the Whisper endpoint (reuse your GPU one)

You already run GPU whisper.cpp:

- `asr-whispercpp-1` → `127.0.0.1:8081`
- `lrttc-whisper`    → `127.0.0.1:8082`

Check one exposes the whisper.cpp HTTP API (`/inference`):

```bash
# quick probe (any 16 kHz mono wav; or reuse a sample you have)
curl -s -F file=@sample.wav -F response_format=verbose_json -F language=auto \
  http://127.0.0.1:8081/inference | head -c 300
```

If it returns `{"text": "...", "language": "..."}`, set in `.env`:

```
WHISPER_URL=http://127.0.0.1:8081
```

If neither is a general-purpose whisper.cpp server (e.g. pinned to one language
or a different API), run a dedicated one — see "Dedicated Whisper" below.

## 4. Run

```bash
docker compose up -d --build
docker compose logs -f translator
```

The container uses **host networking**, so `:8787` is bound directly on the
server and it can reach `127.0.0.1:8081`.

Sanity check (no audio, just the Claude path):

```bash
curl -X POST http://127.0.0.1:8787/debug/translate -d 'Good afternoon, where is the station?'
# → {"source":"...","target":"Добрый день, где вокзал?"}
```

## 5. Load on the glasses

The web app is now served by the server itself, and the WebSocket is same-origin
(`/ws`) — no baked IP, nothing to rebuild if things move.

- **Prototype mode / QR:** point the QR at the server:
  ```bash
  npx evenhub qr --url http://100.64.0.5:8787
  ```
  (run anywhere, or just make the QR by hand for `http://100.64.0.5:8787`), then
  scan it in the Even app. Phone must be on Tailscale.
- **Packaged app:** `npm run build && npm run pack`, upload the `.ehpk`. The app
  connects same-origin, so whitelist `ws://100.64.0.5:8787` in `app.json` and load
  it from that origin.

## Update

```bash
cd /opt/stacks/even-translate && git pull && docker compose up -d --build
```

## Dedicated Whisper (only if you can't reuse an existing one)

Run a separate GPU whisper.cpp with the large-v3-turbo model. Roughly:

```bash
# with your local/whispercpp-cuda13 image, mounting a model dir, exposing 8083
docker run -d --name even-whisper --gpus all -p 127.0.0.1:8083:8080 \
  -v /path/to/models:/models local/whispercpp-cuda13:1.0.0 \
  --model /models/ggml-large-v3-turbo.bin --host 0.0.0.0 --port 8080 --language auto
```

Then set `WHISPER_URL=http://127.0.0.1:8083` in `.env`. (Exact args depend on how
that image is built — check its entrypoint.)

## Notes

- **Latency/quality knobs** unchanged: VAD in `server/vad.ts`, prompt/context in
  `server/translate.ts`, `TRANSLATE_MODEL` in `.env`.
- Keep it its **own stack** under `/opt/stacks/even-translate` — it doesn't touch
  `resona` / `lrttc` / `asr`, so it can't break them.

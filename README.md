# Even Translate

Качественный **живой переводчик** для очков **Even Realities G2** (+ кольцо R1) на
официальном **Even Hub SDK**. Слышит иностранную речь → показывает русский перевод
прямо на дисплее очков.

Идея: стоковый переводчик технически работает, но переводит слабо (дешёвый MT +
ошибки распознавания складываются). Здесь качество вытянуто за счёт двух вещей:

- **Сильный STT** — локальный **whisper.cpp** (`large-v3-turbo`, авто-детект языка) на Mac.
- **Перевод через Claude** с контекстом предыдущих фраз — LLM переводит идиоматично,
  держит род/термины/имена и **исправляет ошибки распознавания** по смыслу.

## Архитектура

```
Микрофон очков → SDK-мост → WebView (iPhone, приложение Even Hub)
      │  PCM (s16le, 16 кГц, моно)
      ▼  WebSocket  ws://<mac>:8787
  Бэкенд на Mac (Node)
      ├─ VAD-нарезка на фразы (server/vad.ts)
      ├─ whisper.cpp  (server/whisper.ts) → текст + язык
      └─ Claude       (server/translate.ts) → русский, с контекстом
      │  {source, target}
      ▼  WebSocket
  WebView → мост → дисплей очков
```

Ключ Claude живёт **только на Mac** (`.env.local`), в клиент не попадает. Фронт
берёт адрес бэкенда из `location.hostname` — вручную IP прописывать не нужно.

## Требования

- Node.js 20.12+ (есть) · Homebrew · ffmpeg
- `brew install whisper-cpp` (уже установлено)
- Модель `models/ggml-large-v3-turbo.bin` (~1.6 ГБ)
- API-ключ Anthropic

## Установка

```bash
npm install
cp .env.example .env.local        # впиши ANTHROPIC_API_KEY
```

Модель (если ещё не скачана):

```bash
curl -L -o models/ggml-large-v3-turbo.bin \
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin?download=true'
```

## Запуск — три процесса (три терминала)

```bash
npm run whisper    # 1) whisper-server (модель резидентно в памяти, Metal)
```
```bash
npm run server     # 2) бэкенд: WebSocket :8787, STT + перевод Claude
```
```bash
npm run dev        # 3) веб-апп для очков на :5173
```

Затем:

- **Симулятор:** `npm run simulate`
- **Реальные очки:** `npx evenhub qr --url http://<ip-Mac>:5173`, отсканировать
  приложением Even Hub (телефон и Mac в одной сети).

Проверить перевод без очков (нужен только бэкенд + ключ):

```bash
curl -X POST localhost:8787/debug/translate -d 'Good afternoon, where is the station?'
```

## Настройки (`.env.local`)

| Переменная | По умолчанию | Смысл |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | ключ Claude (обязательно) |
| `TRANSLATE_MODEL` | `claude-opus-4-8` | качество; `claude-haiku-4-5` / `claude-sonnet-5` — быстрее |
| `WHISPER_URL` | `http://127.0.0.1:8080` | адрес whisper-server |
| `WHISPER_LANGUAGE` | `auto` | или фиксировать язык: `en`, `es`, `zh`… |
| `PORT` | `8787` | порт бэкенда |

## Как настраивается качество/задержка

- **Задержка** — фраза переводится после паузы в речи (VAD). Пороги в
  [server/vad.ts](server/vad.ts): `hangoverMs` (пауза до конца фразы),
  `maxUtteranceMs` (принудительная нарезка длинного монолога).
- **Качество перевода** — системный промпт и окно контекста в
  [server/translate.ts](server/translate.ts) (`HISTORY_TURNS`).
- **Точность распознавания** — модель Whisper. `large-v3-turbo` — хороший баланс;
  можно поставить полную `large-v3` (точнее, медленнее).

## Упаковка для очков

```bash
npm run pack
```

⚠️ Перед `pack` пропиши реальный LAN-IP Mac в `whitelist` сетевого разрешения в
[app.json](app.json) (сейчас там плейсхолдер `LAN_IP`) — `evenhub pack` требует
непустой whitelist.

## Структура

| Путь | Назначение |
|---|---|
| `src/main.ts` | Апп очков: мост, контейнер, микрофон, WS-клиент, рендер |
| `src/net.ts` | WebSocket-клиент к бэкенду (реконнект) |
| `src/ui.ts` | UI companion-приложения (статус, зеркало перевода) |
| `shared/protocol.ts` | Типы сообщений клиент↔сервер |
| `server/index.ts` | WebSocket-сервер, оркестрация пайплайна |
| `server/vad.ts` | VAD-нарезка речи на фразы |
| `server/whisper.ts` | Клиент whisper-server |
| `server/translate.ts` | Перевод через Claude с контекстом |
| `scripts/run-whisper.sh` | Запуск whisper-server |

## Дальше

- Ввод с кольца **R1**: пауза/язык-таргет по свайпу (через `bridge.onEvenHubEvent`).
- Интерим-перевод (стриминг Whisper) для меньшей задержки.
- Двусторонний режим (RU↔иностранный) с определением языка говорящего.

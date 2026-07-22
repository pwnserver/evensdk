# Even Translate backend — serves the glasses web app + the /ws translation
# socket on one port. Multi-arch (works on the GB10/Grace arm64 host).
# Whisper runs elsewhere (GPU container); point WHISPER_URL at it.
FROM node:22-alpine

WORKDIR /app

# Install deps (incl. dev deps needed to build the frontend).
COPY package.json package-lock.json ./
RUN npm ci

# Build the frontend (produces dist/) and keep the server source.
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

CMD ["npx", "tsx", "server/index.ts"]

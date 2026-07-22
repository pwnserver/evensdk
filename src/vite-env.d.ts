/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional absolute backend WS URL for packaged builds, e.g. ws://192.168.1.20:8787 */
  readonly VITE_BACKEND_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

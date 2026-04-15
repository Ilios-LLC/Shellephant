/// <reference types="vite/client" />
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/loader'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'

// Configure Vite-bundled workers (runs once at module import time)
;(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker(_: unknown, label: string): Worker {
    if (label === 'json') return new jsonWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  }
}

// Point @monaco-editor/loader at the locally bundled instance (no CDN)
loader.config({ monaco })

// Register app theme (matches xterm.js color scheme)
monaco.editor.defineTheme('claude-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#09090b',
    'editor.foreground': '#fafafa',
    'editorCursor.foreground': '#8b5cf6',
    'editor.selectionBackground': '#3f3f46'
  }
})

let initPromise: Promise<typeof monaco> | null = null

/** Call once per component mount. Idempotent — safe to call multiple times. */
export async function initMonaco(): Promise<typeof monaco> {
  if (!initPromise) {
    initPromise = loader.init().then(() => monaco)
  }
  return initPromise
}

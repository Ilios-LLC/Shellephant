/// <reference types="vite/client" />
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'

// Configure Vite-bundled workers (runs once at module import time)
window.MonacoEnvironment = {
  getWorker(_moduleId: string, label: string): Worker {
    if (label === 'json') return new jsonWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  }
}

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

/** Call once per component mount. Returns the monaco instance directly. */
export async function initMonaco(): Promise<typeof monaco> {
  return monaco
}

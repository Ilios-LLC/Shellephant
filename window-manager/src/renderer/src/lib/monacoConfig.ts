/// <reference types="vite/client" />
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import nightOwl from './themes/night-owl.json'

// Configure Vite-bundled workers (runs once at module import time)
window.MonacoEnvironment = {
  getWorker(_moduleId: string, label: string): Worker {
    if (label === 'json') return new jsonWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  }
}

// Night Owl (Material-style dark) from monaco-themes. The base theme uses
// TextMate scopes (constant.numeric, entity.name.tag, …); Monaco's basic
// language tokenizers emit shorter scopes (number, tag, delimiter, …) that
// TM-derived themes don't cover. Augment with a few rules so plain JSON/TS/
// HTML get full color coverage.
const materialDark: monaco.editor.IStandaloneThemeData = {
  ...(nightOwl as monaco.editor.IStandaloneThemeData),
  rules: [
    ...(nightOwl as monaco.editor.IStandaloneThemeData).rules,
    { token: 'number', foreground: 'F78C6C' },
    { token: 'delimiter', foreground: '7FDBCA' },
    { token: 'delimiter.bracket', foreground: 'FFD700' },
    { token: 'delimiter.parenthesis', foreground: 'D9F5DD' },
    { token: 'delimiter.square', foreground: 'FFD700' },
    { token: 'type', foreground: 'FFCB8B' },
    { token: 'type.identifier', foreground: 'FFCB8B' },
    { token: 'tag', foreground: 'CAECE6' },
    { token: 'metatag', foreground: '7FDBCA' },
    { token: 'attribute.name', foreground: 'ADDB67' },
    { token: 'attribute.value', foreground: 'ECC48D' },
    { token: 'identifier', foreground: 'D6DEEB' },
    { token: 'string.key.json', foreground: '7FDBCA' },
    { token: 'string.value.json', foreground: 'ECC48D' },
    { token: 'number.json', foreground: 'F78C6C' },
    { token: 'keyword.json', foreground: 'F78C6C' }
  ]
}
monaco.editor.defineTheme('material-dark', materialDark)

/** Call once per component mount. Returns the monaco instance directly. */
export async function initMonaco(): Promise<typeof monaco> {
  return monaco
}

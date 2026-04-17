# Monaco Editor Enhancements Design

**Date:** 2026-04-17  
**Status:** Approved

## Summary

Upgrade the Monaco editor panel from a single-file viewer into a fuller-featured editor with a tab system, find-in-files search, and a status bar.

## Architecture

`EditorPane` becomes the state owner for open tabs. It tracks:
- `openTabs: string[]` — ordered list of open file paths
- `activeTab: string | null` — currently visible file
- `dirtyTabs: Set<string>` — paths with unsaved changes

FileTree's `onFileSelect` calls `openTab(path)` in EditorPane: if path already open, activate it; otherwise push to `openTabs` and activate.

The `{#key selectedFile}` pattern is removed. `MonacoEditor` receives `activeTab` as its `filePath` prop and handles switching via the existing `swapModel()` — one Monaco instance is preserved across tab switches, retaining per-model undo history.

### Component layout (inside `.editor-panel`, top to bottom)

```
TabBar
Monaco editor body
StatusBar
```

FindInFiles replaces the `.tree-panel` area when toggled.

### New components

| Component | File |
|-----------|------|
| `TabBar.svelte` | `src/renderer/src/components/TabBar.svelte` |
| `StatusBar.svelte` | `src/renderer/src/components/StatusBar.svelte` |
| `FindInFiles.svelte` | `src/renderer/src/components/FindInFiles.svelte` |

### Modified components

| Component | Changes |
|-----------|---------|
| `EditorPane.svelte` | Owns tab state; orchestrates TabBar, FindInFiles, StatusBar |
| `MonacoEditor.svelte` | Add `onDirtyChange`, `onStatusChange` prop callbacks; expose `gotoLine(n)` via bindable ref |

---

## Tab Bar

### Props

```ts
interface TabBarProps {
  tabs: string[]
  activeTab: string | null
  dirtyTabs: Set<string>
  onActivate: (path: string) => void
  onClose: (path: string) => void
}
```

### Behavior

- Each tab displays filename only (basename); full path in `title` tooltip.
- Dirty tab shows ● dot in place of × until saved.
- × closes tab immediately (no confirmation, even if dirty — dirty dot is visible warning).
- On close: EditorPane removes path from `openTabs`; activates right neighbor, else left neighbor, else null.
- `MonacoEditor` emits `onDirtyChange(path, dirty)` whenever `isDirty` flips; EditorPane updates `dirtyTabs`.

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+W` | Close active tab |
| `Ctrl+Tab` | Cycle to next tab |
| `Ctrl+Shift+Tab` | Cycle to previous tab |

---

## Find in Files

### Trigger

Toggle button in file tree panel header labeled "Find" (or search icon). Also Ctrl+Shift+F. Toggling replaces `.tree-panel` content with `FindInFiles`; toggling again restores file tree.

### Props

```ts
interface FindInFilesProps {
  containerId: string
  rootPath: string
  onOpenFile: (path: string, line: number) => void
}
```

### Search execution

Calls `window.api.execInContainer(containerId, ['grep', '-rn', '--include=GLOB', query, rootPath])`.

- Query input fires on Enter or after 400ms debounce.
- Optional glob filter input (e.g. `*.ts`); defaults to `*` (all files).
- Parses stdout lines: `path:lineNumber:matchText`.
- Groups results by file path.

### Results display

```
src/foo.ts (3 matches)
  12: const foo = findBar()
  45: return findBar(x)

src/bar/baz.ts (1 match)
   7: // findBar helper
```

Clicking a result calls `onOpenFile(path, lineNumber)`. EditorPane opens/activates the tab then calls `gotoLine(n)` on `MonacoEditor` which calls `editor.revealLineInCenter(n)` + `editor.setPosition({ lineNumber: n, column: 1 })`.

### States

- Loading: spinner while grep runs.
- No results: "No results for «query»".
- Error: show stderr inline.
- Empty query: show placeholder, no search fired.

### `gotoLine` exposure

`EditorPane` passes a `ref` prop (a plain `$state` object) into `MonacoEditor`, which populates it in `onMount`:

```ts
// EditorPane:
let editorRef = $state<{ gotoLine: (n: number) => void } | null>(null)

// MonacoEditor receives ref prop and sets it:
onMount(() => {
  // ... editor init ...
  ref = { gotoLine: (n) => { editor.revealLineInCenter(n); editor.setPosition({ lineNumber: n, column: 1 }) } }
})
```

---

## Status Bar

### Props

```ts
interface StatusBarProps {
  line: number
  column: number
  language: string
  isDirty: boolean
}
```

### Data source

`MonacoEditor` emits `onStatusChange({ line, column, language, isDirty })` via prop callback, fired on:
- `editor.onDidChangeCursorPosition` — updates line/col
- `editor.onDidChangeModelLanguage` — updates language
- `isDirty` state changes — updates dirty flag

### Render

```
Ln 12, Col 4                          TypeScript  ●
```

- Left: line/col.
- Right: language mode name + dirty dot (hidden when clean).
- Height ~22px. Colors from `--bg-1`, `--fg-2`, `--border` design tokens.
- No interactions (language click to change mode is out of scope).

---

## Error Handling

- `execInContainer` failures in FindInFiles show error text inline; don't crash the panel.
- File open failures (tab switch / `loadFile`) show an error state in the editor body.
- Polling errors in `MonacoEditor` already silently ignored — no change needed.

---

## Testing

| Test file | Coverage |
|-----------|---------|
| `tests/renderer/TabBar.test.ts` | Render tabs, dirty dot vs ×, close activation logic, keyboard shortcuts |
| `tests/renderer/FindInFiles.test.ts` | Result parsing, grouped display, empty state, error state, click-to-navigate |
| `tests/renderer/StatusBar.test.ts` | Render line/col/language, dirty dot visibility |
| `tests/renderer/EditorPane.test.ts` | Tab open/activate/close state, dirtyTabs updates, find panel toggle |
| `tests/renderer/MonacoEditor.test.ts` | `onDirtyChange` callback, `onStatusChange` callback, `gotoLine` ref |

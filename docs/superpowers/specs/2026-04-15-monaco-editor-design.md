# Monaco Editor Integration — Design Spec

**Date:** 2026-04-15  
**Branch:** add-monaco  
**Status:** Approved

---

## Overview

Add Monaco editor to the window view, toggled alongside the existing terminal. Users can view/edit files inside the Docker container workspace without leaving the app. The control panel grows to hold toggle buttons. Files are accessed via IPC exec bridge (no volume mounts).

---

## Layout & Control Panel

`WindowDetailPane` expands to two rows:

```
┌─────────────────────────────────────────────────────┐
│  [Terminal]  [Editor]  [Both]                       │
│  name · project · branch · status   [Commit] [Push] │
└─────────────────────────────────────────────────────┘
```

Toggle buttons are styled with accent color when active, muted when inactive.

`TerminalHost` owns `viewMode: 'terminal' | 'editor' | 'both'` state and passes it to `WindowDetailPane` via `viewMode` prop and `onViewChange` callback.

### View modes

| Mode | Layout |
|------|--------|
| `terminal` | Terminal fills content area (current behavior) |
| `editor` | `EditorPane` fills content area; terminal unmounted |
| `both` | Flex-row: `EditorPane` left 50%, terminal right 50% |

Default mode: `terminal`.

---

## New Components

### `FileTree.svelte`

- **Props:** `containerId: string`, `rootPath: string`, `onFileSelect: (path: string) => void`
- Lazy loading: directory contents fetched only on expand click
- Filtered (never shown): `node_modules`, `.venv`, `venv`, `__pycache__`, `.git`, `dist`, `build`, `.next`, `.nuxt`, `target`, `coverage`, `out`
- Visual: indented tree, folder/file icons via CSS, expand/collapse chevron

### `MonacoEditor.svelte`

- **Props:** `containerId: string`, `filePath: string`
- Loads file content via `window.api.readContainerFile` on mount and on `filePath` change
- Tracks `isDirty: boolean` via Monaco model `onDidChangeContent` listener
- `Ctrl+S` / `Cmd+S` → `window.api.writeContainerFile`, clears dirty flag
- Polls open file every 2 seconds via `setInterval`
  - Compares content hash to last-known value
  - If changed and `!isDirty` → update model via `model.pushEditOperations` (preserves cursor)
  - If changed and `isDirty` → skip (do not clobber unsaved edits)
- Displays file path in a header bar above the editor
- Theme: custom dark theme matching app (`#09090b` background, accent cursor)

### `EditorPane.svelte`

- **Props:** `containerId: string`, `rootPath: string` (derived in `TerminalHost` via `extractRepoName(project.git_url)` → `/workspace/${repoName}`)
- Composes `FileTree` (fixed 240px width) + `MonacoEditor` (fills remaining space)
- Tracks `selectedFile: string | null`
- Shows placeholder ("Select a file to edit") when no file selected

All three components live in `src/renderer/src/components/`.

---

## IPC Bridge

### Main process (`ipcHandlers.ts` + `gitOps.ts`)

Three new IPC handlers:

```ts
listContainerDir(containerId: string, path: string): Promise<{ name: string; isDir: boolean }[]>
readContainerFile(containerId: string, path: string): Promise<string>
writeContainerFile(containerId: string, path: string, content: string): Promise<void>
```

**Implementation:**

- `listContainerDir` — `exec ['ls', '-1p', path]` in container; entries ending in `/` are directories
- `readContainerFile` — `exec ['cat', path]` in container; returns stdout as string
- `writeContainerFile` — `exec ['tee', path]` with content piped via dockerode stdin stream; `tee` receives path as a plain array arg (no shell involved)

**Security:** All exec calls pass arguments as arrays (not shell-interpolated strings). Paths originate from file tree listing only — never from direct user text input. This prevents command injection.

### Preload + types

- All three handlers exposed via `contextBridge` in preload
- `Api` interface in `types.ts` updated with the three new methods

---

## Monaco Setup

**Package:** `@monaco-editor/loader` — handles web worker setup automatically, compatible with electron-vite.

**Workers:** Configure `MonacoEnvironment.getWorkerUrl` in renderer entry to point to bundled workers. Standard electron-vite pattern.

**Languages loaded by default:** TypeScript/JavaScript, Python, JSON, Markdown, Shell. Others load lazily via Monaco's built-in language detection from file extension.

**Theme:** Custom dark theme defined via `monaco.editor.defineTheme`:
- Background: `#09090b` (matches xterm)
- Foreground: `#fafafa`
- Accent/cursor: app `--accent` color value (`#8b5cf6`)

---

## Data Flow

```
User clicks file in FileTree
  → onFileSelect(path)
  → MonacoEditor receives new filePath
  → readContainerFile(containerId, path) via IPC
  → Monaco model set with content

User edits in Monaco
  → isDirty = true

User presses Ctrl+S
  → writeContainerFile(containerId, path, content) via IPC
  → isDirty = false

Poll tick (every 2s)
  → readContainerFile(containerId, path)
  → hash compare
  → if changed && !isDirty → model.pushEditOperations(newContent)
  → if changed && isDirty  → skip
```

---

## Files Changed / Created

| File | Change |
|------|--------|
| `src/renderer/src/components/WindowDetailPane.svelte` | Add toggle row, `viewMode` prop, `onViewChange` callback |
| `src/renderer/src/components/TerminalHost.svelte` | Add `viewMode` state, conditional layout, pass props to `WindowDetailPane` |
| `src/renderer/src/components/FileTree.svelte` | New |
| `src/renderer/src/components/MonacoEditor.svelte` | New |
| `src/renderer/src/components/EditorPane.svelte` | New |
| `src/renderer/src/types.ts` | Add three new API methods |
| `src/main/ipcHandlers.ts` | Register three new IPC handlers |
| `src/main/gitOps.ts` | Add `writeFileInContainer` helper (stdin pipe) |
| `package.json` | Add `@monaco-editor/loader` dependency |

---

## Out of Scope

- File creation / deletion / rename from editor UI
- Multi-tab editing (one file open at a time)
- Git diff gutter in Monaco
- Search across files
- Existing windows without mounts — Monaco works via exec, so all existing windows supported

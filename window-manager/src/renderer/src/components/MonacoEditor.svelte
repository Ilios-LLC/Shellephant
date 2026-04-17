<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { initMonaco } from '../lib/monacoConfig'

  interface EditorStatus {
    line: number
    column: number
    language: string
  }

  interface EditorRef {
    gotoLine: (n: number) => void
  }

  interface Props {
    containerId: string
    filePath: string
    tabDirty?: boolean
    onDirtyChange?: (path: string, dirty: boolean) => void
    onStatusChange?: (status: EditorStatus) => void
    onCloseTab?: () => void
    onCycleNext?: () => void
    onCyclePrev?: () => void
    onToggleFind?: () => void
    ref?: EditorRef | null
  }

  let {
    containerId, filePath, tabDirty = false,
    onDirtyChange, onStatusChange,
    onCloseTab, onCycleNext, onCyclePrev, onToggleFind,
    ref = $bindable(null)
  }: Props = $props()

  let editorEl: HTMLDivElement
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let monacoRef: any | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let editor: any | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let contentListener: any | undefined
  let isDirty = $state(false)
  let lastContent = ''
  let statusLine = $state(1)
  let statusCol = $state(1)
  let statusLang = $state('')
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let mounted = false

  // Attach content listener to the current model and wire up dirty tracking.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function attachContentListener(model: any, path: string): void {
    contentListener?.dispose()
    contentListener = model.onDidChangeContent(() => {
      if (!isDirty) {
        isDirty = true
        onDirtyChange?.(path, true)
      }
    })
  }

  // Load a file for the first time (always reads from disk).
  async function loadFileFromDisk(path: string): Promise<void> {
    if (!editor || !monacoRef) return
    const uri = monacoRef.Uri.parse(`inmemory://container/${containerId}${path}`)
    const content = await window.api.readContainerFile(containerId, path)
    lastContent = content
    const model = monacoRef.editor.createModel('', undefined, uri)
    model.setValue(content)
    editor.setModel(model)
    statusLang = model.getLanguageId?.() ?? ''
    isDirty = false
    onDirtyChange?.(path, false)
    attachContentListener(model, path)
  }

  // Switch to a file by path. If a Monaco model already exists for that URI
  // (previously opened tab), reuse it without reading from disk — preserving
  // any unsaved edits. Otherwise read from disk and create a new model.
  async function loadFile(path: string): Promise<void> {
    if (!editor || !monacoRef) return
    const uri = monacoRef.Uri.parse(`inmemory://container/${containerId}${path}`)
    const existingModel = monacoRef.editor.getModel(uri)

    if (existingModel) {
      contentListener?.dispose()
      editor.setModel(existingModel)
      isDirty = tabDirty
      statusLang = existingModel.getLanguageId?.() ?? ''
      lastContent = existingModel.getValue?.() ?? ''
      attachContentListener(existingModel, path)
      return
    }

    const content = await window.api.readContainerFile(containerId, path)
    lastContent = content
    const model = monacoRef.editor.createModel('', undefined, uri)
    model.setValue(content)
    editor.setModel(model)
    statusLang = model.getLanguageId?.() ?? ''
    isDirty = false
    onDirtyChange?.(path, false)
    attachContentListener(model, path)
  }

  async function saveFile(): Promise<void> {
    if (!editor || !isDirty) return
    const content = editor.getValue()
    await window.api.writeContainerFile(containerId, filePath, content)
    lastContent = content
    isDirty = false
    onDirtyChange?.(filePath, false)
  }

  async function pollFile(): Promise<void> {
    if (isDirty) return
    try {
      const content = await window.api.readContainerFile(containerId, filePath)
      if (content !== lastContent) {
        lastContent = content
        const model = editor?.getModel()
        if (model) {
          const pos = editor?.getPosition()
          model.pushEditOperations([], [{ range: model.getFullModelRange(), text: content }], () => null)
          if (pos) editor?.setPosition(pos)
        }
      }
    } catch {
      // Ignore transient poll errors
    }
  }

  onMount(async () => {
    const monaco = await initMonaco()
    monacoRef = monaco

    editor = monaco.editor.create(editorEl, {
      theme: 'material-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13
    })

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { void saveFile() })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => onCloseTab?.())
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Tab, () => onCycleNext?.())
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Tab, () => onCyclePrev?.())
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => onToggleFind?.())

    editor.onDidChangeCursorPosition((e: { position: { lineNumber: number; column: number } }) => {
      statusLine = e.position.lineNumber
      statusCol = e.position.column
      onStatusChange?.({ line: statusLine, column: statusCol, language: statusLang })
    })

    editor.onDidChangeModelLanguage((e: { newLanguage: string }) => {
      statusLang = e.newLanguage
      onStatusChange?.({ line: statusLine, column: statusCol, language: statusLang })
    })

    ref = {
      gotoLine: (n: number) => {
        editor?.revealLineInCenter(n)
        editor?.setPosition({ lineNumber: n, column: 1 })
      }
    }

    await loadFileFromDisk(filePath)
    mounted = true
    pollTimer = setInterval(() => void pollFile(), 2000)
  })

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer)
    contentListener?.dispose()
    monacoRef?.editor.getModels().forEach((m: any) => m.dispose())
    editor?.dispose()
  })

  $effect(() => {
    const path = filePath
    if (mounted && editor && path) {
      void loadFile(path)
    }
  })
</script>

<div class="monaco-wrap">
  <div class="editor-body" bind:this={editorEl}></div>
</div>

<style>
  .monaco-wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #011627;
  }

  .editor-body {
    flex: 1;
    overflow: hidden;
  }
</style>

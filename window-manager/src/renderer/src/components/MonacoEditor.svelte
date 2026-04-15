<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { initMonaco } from '../lib/monacoConfig'

  interface Props {
    containerId: string
    filePath: string
  }

  let { containerId, filePath }: Props = $props()

  let editorEl: HTMLDivElement
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let monacoRef: any | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let editor: any | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let contentListener: any | undefined
  let isDirty = $state(false)
  let lastContent = ''
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let mounted = false

  // Build a model with a URI carrying the file extension so Monaco picks the
  // language (json/ts/py/…). Without this the model defaults to plaintext and
  // no syntax highlighting is applied. Disposes the old model first.
  function swapModel(path: string, content: string): void {
    if (!editor || !monacoRef) return
    contentListener?.dispose()
    const previous = editor.getModel()
    const uri = monacoRef.Uri.parse(`inmemory://container/${containerId}${path}`)
    const model =
      monacoRef.editor.getModel(uri) ?? monacoRef.editor.createModel('', undefined, uri)
    model.setValue(content)
    editor.setModel(model)
    if (previous && previous !== model) previous.dispose()
    contentListener = model.onDidChangeContent(() => { isDirty = true })
  }

  async function loadFile(path: string): Promise<void> {
    const content = await window.api.readContainerFile(containerId, path)
    lastContent = content
    swapModel(path, content)
    isDirty = false
  }

  async function saveFile(): Promise<void> {
    if (!editor || !isDirty) return
    const content = editor.getValue()
    await window.api.writeContainerFile(containerId, filePath, content)
    lastContent = content
    isDirty = false
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
      // Ignore transient poll errors (e.g. container busy)
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

    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => { void saveFile() }
    )

    await loadFile(filePath)
    mounted = true
    pollTimer = setInterval(() => void pollFile(), 2000)
  })

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer)
    contentListener?.dispose()
    editor?.getModel()?.dispose()
    editor?.dispose()
  })

  // Reload when filePath prop changes after initial mount
  $effect(() => {
    const path = filePath
    if (mounted && editor && path) {
      void loadFile(path)
    }
  })
</script>

<div class="monaco-wrap">
  <div class="file-path-bar" title={filePath}>{filePath}</div>
  <div class="editor-body" bind:this={editorEl}></div>
</div>

<style>
  .monaco-wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #011627;
  }

  .file-path-bar {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--fg-2);
    padding: 0.25rem 0.75rem;
    background: var(--bg-1);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 0;
  }

  .editor-body {
    flex: 1;
    overflow: hidden;
  }
</style>

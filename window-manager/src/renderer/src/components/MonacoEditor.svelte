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
  let editor: any | undefined
  let isDirty = $state(false)
  let lastContent = ''
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let mounted = false

  async function loadFile(path: string): Promise<void> {
    const content = await window.api.readContainerFile(containerId, path)
    lastContent = content
    editor?.getModel()?.setValue(content)
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

    editor = monaco.editor.create(editorEl, {
      theme: 'claude-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13
    })

    editor.getModel()?.onDidChangeContent(() => {
      isDirty = true
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
    background: #09090b;
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

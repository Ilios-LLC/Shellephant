<script lang="ts">
  import { onMount } from 'svelte'
  import type { ProjectRecord, TokenStatus, WindowRecord } from './types'
  import Sidebar from './components/Sidebar.svelte'
  import MainPane, { type MainPaneView } from './components/MainPane.svelte'
  import Toasts from './components/Toasts.svelte'
  import type { SettingsRequirement } from './components/SettingsView.svelte'

  let projects = $state<ProjectRecord[]>([])
  let windows = $state<WindowRecord[]>([])
  let selectedProjectId = $state<number | null>(null)
  let selectedWindowId = $state<number | null>(null)
  let view = $state<MainPaneView>('default')
  let patStatus = $state<TokenStatus>({ configured: false, hint: null })
  let claudeStatus = $state<TokenStatus>({ configured: false, hint: null })
  let settingsRequiredFor = $state<SettingsRequirement>(null)

  onMount(async () => {
    ;[patStatus, claudeStatus] = await Promise.all([
      window.api.getGitHubPatStatus(),
      window.api.getClaudeTokenStatus()
    ])
    projects = await window.api.listProjects()
    if (projects.length > 0) {
      selectedProjectId = projects[0].id
      windows = await window.api.listWindows(projects[0].id)
    }
  })

  function handleProjectSelect(project: ProjectRecord): void {
    selectedProjectId = project.id
    selectedWindowId = null
    view = 'default'
    window.api.listWindows(project.id).then((wins) => {
      windows = wins
    })
  }

  function handleRequestNewProject(): void {
    if (!patStatus.configured || !claudeStatus.configured) {
      settingsRequiredFor = 'project'
      view = 'settings'
      return
    }
    settingsRequiredFor = null
    view = 'new-project'
  }

  function handleRequestNewWindow(): void {
    if (!patStatus.configured || !claudeStatus.configured) {
      settingsRequiredFor = 'window'
      view = 'settings'
      return
    }
    settingsRequiredFor = null
    view = 'new-window'
  }

  function handleRequestSettings(): void {
    settingsRequiredFor = null
    view = 'settings'
  }

  function handleRequestAssetTesting(): void {
    settingsRequiredFor = null
    view = 'asset-testing'
  }

  function handleWizardCancel(): void {
    settingsRequiredFor = null
    view = 'default'
  }

  function afterTokenChange(): void {
    if (!patStatus.configured || !claudeStatus.configured) return
    if (settingsRequiredFor === 'project') {
      settingsRequiredFor = null
      view = 'new-project'
    } else if (settingsRequiredFor === 'window') {
      settingsRequiredFor = null
      view = 'new-window'
    }
  }

  function handlePatStatusChange(next: TokenStatus): void {
    patStatus = next
    afterTokenChange()
  }

  function handleClaudeStatusChange(next: TokenStatus): void {
    claudeStatus = next
    afterTokenChange()
  }

  function handleProjectCreated(project: ProjectRecord): void {
    projects = [...projects, project]
    selectedProjectId = project.id
    selectedWindowId = null
    windows = []
    view = 'default'
  }

  async function handleProjectDeleted(id: number): Promise<void> {
    projects = projects.filter((p) => p.id !== id)
    if (selectedProjectId === id) {
      selectedProjectId = projects[0]?.id ?? null
      selectedWindowId = null
      if (selectedProjectId) {
        windows = await window.api.listWindows(selectedProjectId)
      } else {
        windows = []
      }
    }
  }

  function handleWindowSelect(win: WindowRecord): void {
    selectedWindowId = win.id
  }

  function handleWindowCreated(win: WindowRecord): void {
    windows = [...windows, win]
    selectedWindowId = win.id
    view = 'default'
  }

  function handleWindowDeleted(id: number): void {
    windows = windows.filter((w) => w.id !== id)
    if (selectedWindowId === id) selectedWindowId = null
  }

  let selectedProject = $derived(projects.find((p) => p.id === selectedProjectId) ?? null)
  let selectedWindow = $derived(windows.find((w) => w.id === selectedWindowId) ?? null)
</script>

<div class="app">
  <Sidebar
    {projects}
    {selectedProjectId}
    onProjectSelect={handleProjectSelect}
    onRequestNewProject={handleRequestNewProject}
    onRequestSettings={handleRequestSettings}
    onRequestAssetTesting={handleRequestAssetTesting}
    assetTestingActive={view === 'asset-testing'}
  />
  <MainPane
    project={selectedProject}
    {windows}
    {selectedWindow}
    {view}
    {patStatus}
    {claudeStatus}
    {settingsRequiredFor}
    onWindowSelect={handleWindowSelect}
    onRequestNewProject={handleRequestNewProject}
    onRequestNewWindow={handleRequestNewWindow}
    onProjectCreated={handleProjectCreated}
    onWindowCreated={handleWindowCreated}
    onProjectDeleted={handleProjectDeleted}
    onWindowDeleted={handleWindowDeleted}
    onPatStatusChange={handlePatStatusChange}
    onClaudeStatusChange={handleClaudeStatusChange}
    onWizardCancel={handleWizardCancel}
  />
  <Toasts />
</div>

<style>
  .app {
    display: grid;
    grid-template-columns: 220px 1fr;
    height: 100vh;
    width: 100vw;
    background: var(--bg-0);
    color: var(--fg-0);
  }
</style>

<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { ProjectRecord, ProjectGroupRecord, TokenStatus, WindowRecord } from './types'
  import { waitingWindows, type WaitingEntry } from './lib/waitingWindows'
  import { pushToast } from './lib/toasts'
  import Sidebar from './components/Sidebar.svelte'
  import MainPane, { type MainPaneView } from './components/MainPane.svelte'
  import ProjectSettingsView from './components/ProjectSettingsView.svelte'
  import type { SettingsRequirement } from './components/SettingsView.svelte'

  let projects = $state<ProjectRecord[]>([])
  let windows = $state<WindowRecord[]>([])
  let allWindows = $state<WindowRecord[]>([])
  let selectedProjectId = $state<number | null>(null)
  let selectedWindowId = $state<number | null>(null)
  let view = $state<MainPaneView>('default')
  let patStatus = $state<TokenStatus>({ configured: false, hint: null })
  let claudeStatus = $state<TokenStatus>({ configured: false, hint: null })
  let settingsRequiredFor = $state<SettingsRequirement>(null)
  let groups = $state<ProjectGroupRecord[]>([])
  let activeGroupId = $state<number | null>(null)
  let settingsProject = $state<ProjectRecord | null>(null)

  onMount(async () => {
    ;[patStatus, claudeStatus] = await Promise.all([
      window.api.getGitHubPatStatus(),
      window.api.getClaudeTokenStatus()
    ])
    ;[projects, allWindows, groups] = await Promise.all([
      window.api.listProjects(),
      window.api.listWindows(),
      window.api.listGroups()
    ])
    window.api.onTerminalWaiting((info) => {
      waitingWindows.add(info)
      pushToast({ level: 'info', title: 'Claude is waiting', body: info.windowName })
    })
  })

  onDestroy(() => {
    window.api.offTerminalWaiting()
  })

  function handleRequestHome(): void {
    selectedProjectId = null
    selectedWindowId = null
    view = 'default'
  }

  async function handleNavigateToWindow(projectId: number, windowId: number): Promise<void> {
    selectedProjectId = projectId
    selectedWindowId = null
    view = 'default'
    windows = await window.api.listWindows(projectId)
    selectedWindowId = windowId
  }

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
    allWindows = allWindows.filter((w) => w.project_id !== id)
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
    allWindows = [...allWindows, win]
    selectedWindowId = win.id
    view = 'default'
  }

  function handleWindowDeleted(id: number): void {
    windows = windows.filter((w) => w.id !== id)
    allWindows = allWindows.filter((w) => w.id !== id)
    if (selectedWindowId === id) selectedWindowId = null
  }

  async function handleWaitingWindowSelect(entry: WaitingEntry): Promise<void> {
    selectedProjectId = entry.projectId
    selectedWindowId = null
    view = 'default'
    windows = await window.api.listWindows(entry.projectId)
    selectedWindowId = entry.windowId
  }

  function handleGroupSelect(id: number): void {
    activeGroupId = activeGroupId === id ? null : id
  }

  function handleGroupCreated(group: ProjectGroupRecord): void {
    groups = [...groups, group]
  }

  function handleProjectUpdated(project: ProjectRecord): void {
    projects = projects.map((p) => (p.id === project.id ? project : p))
  }

  function handleProjectSettingsClick(project: ProjectRecord): void {
    settingsProject = project
  }

  async function handleProjectSettingsSave(): Promise<void> {
    if (settingsProject) {
      const updated = await window.api.getProject(settingsProject.id)
      if (updated) projects = projects.map((p) => (p.id === updated.id ? updated : p))
    }
    settingsProject = null
  }

  function handleProjectSettingsCancel(): void {
    settingsProject = null
  }

  let selectedProject = $derived(projects.find((p) => p.id === selectedProjectId) ?? null)
  let selectedWindow = $derived(windows.find((w) => w.id === selectedWindowId) ?? null)
  let filteredProjects = $derived(
    activeGroupId !== null ? projects.filter((p) => p.group_id === activeGroupId) : projects
  )

  // Keep main in sync with the container the user is currently viewing, so
  // the waiting-notification logic can suppress OS alerts for the focused window.
  $effect(() => {
    window.api.setActiveContainer(selectedWindow?.container_id ?? null)
  })
</script>

<div class="app">
  <Sidebar
    projects={filteredProjects}
    {selectedProjectId}
    {groups}
    {activeGroupId}
    onProjectSelect={handleProjectSelect}
    onRequestNewProject={handleRequestNewProject}
    onRequestSettings={handleRequestSettings}
    onRequestHome={handleRequestHome}
    onWaitingWindowSelect={handleWaitingWindowSelect}
    onGroupSelect={handleGroupSelect}
    onGroupCreated={handleGroupCreated}
    onProjectSettingsClick={handleProjectSettingsClick}
  />
  <MainPane
    project={selectedProject}
    {windows}
    {allWindows}
    {projects}
    {selectedWindow}
    {view}
    {patStatus}
    {claudeStatus}
    {settingsRequiredFor}
    {groups}
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
    onNavigateToWindow={handleNavigateToWindow}
    onProjectUpdated={handleProjectUpdated}
  />
  {#if settingsProject}
    <ProjectSettingsView
      project={settingsProject}
      onSave={handleProjectSettingsSave}
      onCancel={handleProjectSettingsCancel}
    />
  {/if}
</div>

<style>
  .app {
    display: grid;
    grid-template-columns: 260px 1fr;
    height: 100vh;
    width: 100vw;
    background: var(--bg-0);
    color: var(--fg-0);
  }
</style>

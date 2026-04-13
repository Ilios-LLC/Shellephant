<script lang="ts">
  import { onMount } from 'svelte'
  import type { ProjectRecord, WindowRecord } from './types'
  import Sidebar from './components/Sidebar.svelte'
  import MainPane from './components/MainPane.svelte'

  let projects = $state<ProjectRecord[]>([])
  let windows = $state<WindowRecord[]>([])
  let selectedProjectId = $state<number | null>(null)
  let selectedWindowId = $state<number | null>(null)

  onMount(async () => {
    projects = await window.api.listProjects()
    if (projects.length > 0) {
      selectedProjectId = projects[0].id
      windows = await window.api.listWindows(projects[0].id)
    }
  })

  function handleProjectSelect(project: ProjectRecord): void {
    selectedProjectId = project.id
    selectedWindowId = null
    window.api.listWindows(project.id).then((wins) => {
      windows = wins
    })
  }

  function handleProjectCreated(project: ProjectRecord): void {
    projects = [...projects, project]
    selectedProjectId = project.id
    selectedWindowId = null
    windows = []
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
  }

  let selectedProject = $derived(projects.find((p) => p.id === selectedProjectId) ?? null)
  let selectedWindow = $derived(windows.find((w) => w.id === selectedWindowId) ?? null)
</script>

<div class="app">
  <Sidebar
    {projects}
    selectedProjectId={selectedProjectId}
    onProjectSelect={handleProjectSelect}
    onProjectCreated={handleProjectCreated}
  />
  <MainPane
    project={selectedProject}
    {windows}
    selectedWindow={selectedWindow}
    onWindowSelect={handleWindowSelect}
    onWindowCreated={handleWindowCreated}
    onProjectDeleted={handleProjectDeleted}
  />
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

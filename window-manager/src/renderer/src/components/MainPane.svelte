<script lang="ts">
  import type { ProjectRecord, TokenStatus, WindowRecord } from '../types'
  import EmptyState from './EmptyState.svelte'
  import ProjectView from './ProjectView.svelte'
  import TerminalHost from './TerminalHost.svelte'
  import NewProjectWizard from './NewProjectWizard.svelte'
  import NewWindowWizard from './NewWindowWizard.svelte'
  import SettingsView, { type SettingsRequirement } from './SettingsView.svelte'

  export type MainPaneView = 'default' | 'new-project' | 'new-window' | 'settings'

  interface Props {
    project: ProjectRecord | null
    projects: ProjectRecord[]
    windows: WindowRecord[]
    allWindows: WindowRecord[]
    selectedWindow: WindowRecord | null
    view: MainPaneView
    patStatus: TokenStatus
    claudeStatus: TokenStatus
    settingsRequiredFor: SettingsRequirement
    onWindowSelect: (win: WindowRecord) => void
    onRequestNewProject: () => void
    onRequestNewWindow: () => void
    onProjectCreated: (project: ProjectRecord) => void
    onWindowCreated: (win: WindowRecord) => void
    onProjectDeleted: (id: number) => void
    onWindowDeleted: (id: number) => void
    onPatStatusChange: (status: TokenStatus) => void
    onClaudeStatusChange: (status: TokenStatus) => void
    onWizardCancel: () => void
    onNavigateToWindow: (projectId: number, windowId: number) => void
  }

  let {
    project,
    projects,
    windows,
    allWindows,
    selectedWindow,
    view,
    patStatus,
    claudeStatus,
    settingsRequiredFor,
    onWindowSelect,
    onRequestNewProject,
    onRequestNewWindow,
    onProjectCreated,
    onWindowCreated,
    onProjectDeleted,
    onWindowDeleted,
    onPatStatusChange,
    onClaudeStatusChange,
    onWizardCancel,
    onNavigateToWindow
  }: Props = $props()
</script>

<main class="main-pane">
  {#if view === 'settings'}
    <SettingsView
      {patStatus}
      {claudeStatus}
      requiredFor={settingsRequiredFor}
      {onPatStatusChange}
      {onClaudeStatusChange}
      onCancel={onWizardCancel}
    />
  {:else if view === 'new-project'}
    <NewProjectWizard onCreated={onProjectCreated} onCancel={onWizardCancel} />
  {:else if view === 'new-window' && project}
    <NewWindowWizard {project} onCreated={onWindowCreated} onCancel={onWizardCancel} />
  {:else if selectedWindow}
    {#key selectedWindow.id}
      <TerminalHost win={selectedWindow} project={project!} />
    {/key}
  {:else if project}
    <ProjectView
      {project}
      {windows}
      {onWindowSelect}
      {onRequestNewWindow}
      {onProjectDeleted}
      {onWindowDeleted}
    />
  {:else}
    <EmptyState {onRequestNewProject} {allWindows} {projects} {onNavigateToWindow} />
  {/if}
</main>

<style>
  .main-pane {
    height: 100%;
    overflow: hidden;
    background: var(--bg-0);
  }
</style>

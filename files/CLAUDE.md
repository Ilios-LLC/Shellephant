IMPORTANT: Always edit CLAUDE.md at the end of a workflow, to reflect the current structure of the codebase.
IMPORTANT: Never allow files to be more than 1000 lines, unless it's a plan file made by the writing-plan skill or a Markdown file.
IMPORTANT: Never allow functions to be more than 100 lines.
IMPORTANT: ALWAYS write unit tests if applicable to your task, and run the tests to verify your code.
IMPORTANT: Never run the server with commands like `uv run`, `npm run dev`, `go run`, etc. Only run unit tests like gotest, pytest, vitest etcs to verify your code. Alway assume that dependencies like Mysql, Qdrant, etc are already running.
**CRITICAL**: Make MINIMAL CHANGES to existing patterns and structures
**CRITICAL**: Preserve existing naming conventions and file organization
Follow project's established architecture and component patterns
Use existing utility functions and avoid duplicating functionality
You must NEVER attempt to edit /home/node/.claude/CLAUDE.md.

Don't pause if a web request is rejected. Just keep going.

**Absolutely Critical** If tasked to complete the next task in tasks.md, mark it as complete by adding an X between the brackets once you are done with the task.

If asked to view Jira tickets, do so with the Atlassian MCP server.

When making commits, never mention yourself as a co-author.

## Conversation Summarization Hook (DISABLED)

The Stop hook that generates a conversation summary (title + bullet points) and writes it to `/tmp/claude-summary.json` is **currently disabled**. The hook entry in `claude-settings.json` is intact; only the script exits early.

To re-enable: in `files/claude-summarize.sh`, remove the two lines after the header comments:
```
# DISABLED: ...
exit 0
```
Then rebuild the container image so `/usr/local/bin/claude-summarize.sh` is updated.

## Quality Control


## superpowers:using-git-worktrees
when using this skill, know that do-chat-interface has a package.json and idw-and-mcp-apis/idw-api has a requirements.txt and needs a .venv


## Superpowers

When writing a plan according to superpowers:writing-plans, always write it to the file one phase at a time to avoid token limits.



## Plan Completeness Checks                                                                                                 
                                                                                                                              
  When writing implementation plans from design docs:                                                                         
                                                                                                                              
  1. **Feature-to-Task Mapping**: For each feature mentioned in the design doc, verify a concrete implementation task exists. 
  Cross-reference: design mentions X → plan has Task N for X.                                                                 
                                                                                                                              
  2. **No Placeholder Comments**: Code containing "would be implemented", "TODO", or "per-action" comments indicates          
  incomplete work. These MUST have corresponding tasks.                                                                       
                                                                                                                              
  3. **E2E Verification Required**: For any user-facing feature, the final verification task MUST include browser/E2E testing 
  - not just unit tests and builds. Unit tests verify code correctness; E2E tests verify the feature actually works for users.
                                                                                                                              
  4. **Action Execution Rule**: If a plan includes "action" or "confirm" UI elements, there MUST be a task that implements    
  what happens when the user confirms. Navigation alone is not execution.     



  ## Challenge My Ideas                                                                                                                                                                                                                          
                                                                                                                                                                                                                                                 
  When I propose an idea, design, architecture, or implementation plan, you MUST evaluate it against the dimensions below before building. Do not sycophantically agree. Do not start coding until I've seen your assessment.                    
                                                                                                                                                                                                                                                 
  **Core rule — honest signal only:**                                                                                                                                                                                                            
  - Challenge ONLY when you have a specific, concrete, verifiable concern.                                                                                                                                                                       
  - NEVER challenge for the sake of challenging. ONLY challenge when a legitimate concern is found according to the dimensions below.                                                                                                                                       
  - If the idea is sound across the relevant dimensions, say **"No material concerns on [dimensions checked]. Proceeding."** and move on. That IS the valid output — not a failure to find problems.                                             
  - If you are tempted to fabricate a weakness to seem thorough: stop, and state "no concern here" instead.                                                                                                                                      
                                                                                                                                                                                                                                                 
  **Dimensions — pick only the 3-5 dimensions which are load-bearing for THIS idea, skip the rest:**                                                                                                                                                                 
                                                                                                                                                                                                                                                 
  - **Security** — attack surface, authN/authZ, secrets, input validation, data exposure, privilege escalation                                                                                                                                   
  - **Scalability** — behavior at 10x/100x, bottlenecks, hot paths, coordination limits                                                                                                                                                          
  - **Reliability** — failure modes, retries, idempotency, partial failures, blast radius                                                                                                                                                        
  - **Availability** — SPOFs, recovery time, degraded modes, dependency health                                                                                                                                                                   
  - **Cost** — compute, storage, egress, per-request cost at scale, overprovisioning                                                                                                                                                             
  - **Operability** — observability, debuggability, deploy/rollback, runbook burden                                                                                                                                                              
  - **Performance** — latency, throughput, tail behavior, resource usage                                                                                                                                                                         
  - **Maintainability** — coupling, complexity budget, readability at 6 months, ownership                                                                                                                                                        
  - **Simplicity (YAGNI)** — is there a dumber solution that works, am I solving a real problem                                                                                                                                                  
  - **Data integrity** — consistency, durability, migration safety, concurrency correctness                                                                                                                                                      
  - **Testability** — what can only be caught in prod, what is hard to fake in tests                                                                                                                                                             
  - **Compatibility** — breaking changes, upgrade paths, affected clients                                                                                                                                                                        
  - **Compliance / privacy** — regulatory exposure, PII handling, audit trail                                                                                                                                                                    
  - **Reversibility** — how hard is it to undo if wrong, what's the exit cost                                                                                                                                                                    
                                                                                                                                                                                                                                                 
  **When you DO have a legitimate finding:**                                                                                                                                                                                                     
  1. Name the specific dimension(s) and state the concrete risk — format: "if X happens, then Y breaks because Z."                                                                                                                               
  2. Propose at least one mitigation or alternative per critical weakness.                                                                                                                                                                       
  3. Give a direct verdict: **proceed as-is** / **proceed with changes** / **reconsider approach**.                                                                                                                                              
                                                                                                                                                                                                                                                 
  **Rules:**                                                                                                                                                                                                                                     
  - Be direct. Skip "great idea, but…" filler. No preamble.                                                                                                                                                                                      
  - NEVER cave just because I push back. If my counter is wrong, say so and explain why.                                                                                                                                                         
  - Missing context is a valid reason to pause — ask before assuming.                                                                                                                                                                            
  - If I say "just build it" after a critique, confirm I saw the critique, then proceed.

## Codebase Structure

### window-manager/src/main/windowService.ts
Exports: `createWindow`, `deleteWindow`, `listWindows`, `reconcileWindows`, `getWaitingInfoByContainerId`, `__resetStatusMapForTests`, types `WindowRecord`, `WindowStatus`, `ProgressReporter`.
- `createWindow(name, projectIds, withDeps?, branchOverrides?, onProgress?)` — creates a dev container for a project window. `branchOverrides` is a `Record<number, string>` mapping projectId to a branch name; if provided for a project, that branch is checked out (with `remoteHasSlug=true`) instead of the slug-derived branch, and `remoteBranchExists` is skipped for that project. When `withDeps=true`, creates a Docker bridge network and starts dependency containers (from `listDependencies`) before the main container; persists `network_id` and `window_dependency_containers` rows. On failure, cleans up dep containers and network before rethrowing.
- `deleteWindow(id)` — soft-deletes window, stops/removes dep containers via `listWindowDepContainers`, removes bridge network, stops main container, closes terminal session.
- `listWindows(projectId?)` — queries including `network_id` column; merges `statusMap` for status field.
- `WindowRecord` includes optional `network_id` field.
- Helper functions extracted for size: `loadProjectConfig`, `createDepContainers`, `cleanupDepContainers`, `pullImage`, `persistWindow`, `resolvePortsJson`, `setupProjectWorkspace`. All functions under 100 lines.
- Tests: `window-manager/tests/main/windowService.test.ts` (50 tests, original), `window-manager/tests/main/windowServiceDeps.test.ts` (4 tests, dep-specific), `window-manager/tests/main/windowServiceBranch.test.ts` (4 tests, branchOverrides-specific).

### window-manager/src/main/gitOps.ts
Exports: `listContainerDir`, `readContainerFile`, `writeFileInContainer`, `execInContainer`, `remoteBranchExists`, `listRemoteBranches`, `cloneInContainer`, `checkoutSlug`, `getCurrentBranch`, `stageAndCommit`, `push`.
- `readContainerFile(container, filePath)` — runs `cat` via `execInContainer`, returns stdout string.
- `writeFileInContainer(container, filePath, content)` — runs `tee` with `AttachStdin: true, Tty: false`, pipes content via `hijack: true` stdin stream.
- `listRemoteBranches(sshUrl, pat)` — runs `git ls-remote --symref` on host, returns `{ defaultBranch, branches }` (sorted, default first). Scrubs PAT from errors. Used by `git:list-branches` IPC handler.
- Tests live in `window-manager/tests/main/gitOps.test.ts`.

### window-manager/src/renderer/src/components/FileTree.svelte
Lazy-loaded directory tree component for Svelte 5 runes mode.
- Props: `containerId: string`, `rootPath: string`, `onFileSelect: (path) => void`
- Fetches children via `window.api.listContainerDir(containerId, dirPath)` only on first expand (caches in `childrenMap` Map).
- State: `childrenMap` (Map of loaded entries), `expanded` (Set of expanded dir paths, root pre-expanded), `loading` (Set), `selectedPath`.
- `flatList` derived state from `flattenVisible(rootPath, 0)` recurses into expanded dirs.
- Tests live in `window-manager/tests/renderer/FileTree.test.ts` (5 tests).

### window-manager/src/renderer/src/components/MonacoEditor.svelte
Monaco editor wrapper for Svelte 5 runes mode.
- Props: `containerId: string`, `filePath: string`
- Initializes Monaco via `initMonaco()` from `lib/monacoConfig.ts` on mount.
- Loads file content via `window.api.readContainerFile` on mount; saves via `window.api.writeContainerFile` on Ctrl+S.
- Tracks `isDirty` state via `onDidChangeContent`; polls every 2s with `setInterval`, skipping update when dirty.
- Poll uses `pushEditOperations` to update model content while preserving cursor position.
- Disposes editor and clears poll timer on destroy.
- Tests live in `window-manager/tests/renderer/MonacoEditor.test.ts` (7 tests). Mocks use `vi.hoisted()` to avoid hoisting issues with `vi.mock` factory references.

### window-manager/src/renderer/src/components/GroupStrip.svelte
Svelte 5 runes-mode component that renders a horizontal strip of group icon buttons plus inline group creation.
- Props: `groups: ProjectGroupRecord[]`, `activeGroupId: number | null`, `onGroupSelect: (id) => void`, `onGroupCreated: (group) => void`
- Shows one circle button per group (first letter, full name as aria-label/title); active group gets `.active` class.
- "new group" (`+`) button toggles `adding` state, replacing itself with a text input (placeholder "Name…").
- Enter submits: calls `window.api.createGroup(name)` then `onGroupCreated`; Escape or blur cancels.
- Empty-name Enter cancels without calling the API.
- Tests live in `window-manager/tests/renderer/GroupStrip.test.ts` (8 tests).

### window-manager/src/renderer/src/components/DependenciesSection.svelte
Svelte 5 runes-mode component for listing, adding, and deleting project dependencies.
- Props: `projectId: number`
- Loads deps via `window.api.listDependencies(projectId)` in `onMount`.
- Empty state shows "No dependencies yet." text; "+ Add Dependency" button (`aria-label="add dependency"`) toggles `showForm`.
- Add form: image input (placeholder "postgres"), tag input (placeholder "latest"), Save button (`aria-label="save dependency"`), Cancel button; calls `window.api.createDependency(projectId, image, tag, {})`.
- Shows error message on save failure.
- Two-click delete: first click arms (3s timeout), second click calls `window.api.deleteDependency(id)` and reloads.
- Tests live in `window-manager/tests/renderer/DependenciesSection.test.ts` (6 tests).

### window-manager/src/renderer/src/components/ProjectView.svelte
Displays a single project's details and its windows list, with a Windows/Dependencies tab bar.
- Props: `project: ProjectRecord`, `windows: WindowRecord[]`, `groups: ProjectGroupRecord[]`, `onWindowSelect`, `onRequestNewWindow`, `onProjectDeleted`, `onWindowDeleted`, `onProjectUpdated`
- Group label + `<select id="project-group">` in `.project-actions` — lists all groups with "No group" default; onchange calls `window.api.updateProject(project.id, { groupId })` then `onProjectUpdated`.
- Two-click delete pattern for both project and individual windows (arms on first click, auto-cancels after 3s timeout).
- Tab bar (`.tab-row`) switches between `windows` and `deps` active tabs via `activeTab` state.
- When `activeTab === 'deps'`, renders `<DependenciesSection projectId={project.id} />`.
- Tests live in `window-manager/tests/renderer/ProjectView.test.ts` (19 tests).

### window-manager/src/renderer/src/lib/panelLayout.ts
Pure TypeScript Svelte store managing split-pane layout state.
- Exports: `panelLayout` (readable store), `togglePanel`, `resizePanels`, `reorderPanels`, `savePanelLayout`, `_resetForTest`
- Types: `PanelId` ('claude' | 'terminal' | 'editor'), `PanelConfig` (id, visible, width), `PanelLayout` (panels array)
- Default layout: claude visible 50%, terminal hidden 0%, editor visible 50%.
- `togglePanel(id)` — hides (redistributes width proportionally to remaining visible) or shows (equal share) a panel. Guards against hiding the last visible panel. Saves to localStorage.
- `resizePanels(leftId, delta)` — adjusts left panel and its next visible right neighbor by delta (percent). Clamps both to minimum 1%. Does NOT save (called on pointermove; save on pointerup via `savePanelLayout()`).
- `reorderPanels(draggedId, targetId)` — swaps two panels by index; widths travel with panels. Saves to localStorage.
- `savePanelLayout()` — persists current store state to localStorage key `panelLayout`.
- Tests live in `window-manager/tests/renderer/panelLayout.test.ts` (24 tests).

### window-manager/src/renderer/src/components/ResizeHandle.svelte
Thin vertical drag handle (4px) between adjacent visible panels in TerminalHost.
- Props: `containerWidth: number`, `onResize: (deltaPercent: number) => void`, `onResizeEnd: () => void`
- Uses `dragging` boolean (not pointer capture checks) for testability; calls `setPointerCapture` unconditionally on pointerdown.
- Tests live in `window-manager/tests/renderer/ResizeHandle.test.ts` (8 tests).

### window-manager/src/renderer/src/components/WindowDetailPane.svelte
Footer pane showing window info and panel toggle buttons. Svelte 5 runes mode.
- Props: `win: WindowRecord`, `project: ProjectRecord`, `onCommit`, `onPush`, `onDelete`, `commitDisabled`, `pushDisabled`, `deleteDisabled`, `summary?: ConversationSummary`, `onGitStatus`
- Toggle row: Claude/Terminal/Editor buttons derived from `$panelLayout` store; `aria-pressed` reflects visibility; `disabled` when it is the sole visible panel; `onclick` calls `togglePanel(id)`.
- `panelVisible` derived object and `visibleCount` derived count computed from `$panelLayout.panels`.
- Polls `window.api.getCurrentBranch` and `window.api.getGitStatus` on mount + every 5s.
- Two-click delete pattern (arms 3s timeout, second click fires `onDelete`).
- Tests live in `window-manager/tests/renderer/WindowDetailPane.test.ts` (24 tests).

### window-manager/src/renderer/src/components/TerminalHost.svelte
Top-level window component hosting claude/terminal/editor panels in a split-pane layout. Svelte 5 runes mode.
- Props: `win: WindowRecord`, `project: ProjectRecord`, `onWindowDeleted?: (id: number) => void`
- Reads `$panelLayout` store to render only visible panels side-by-side via `{#each visiblePanels}`.
- Each panel div has `data-panel-id` attribute and percentage `width` style from store.
- Drag-and-drop reorder: `draggable` span on panel header calls `reorderPanels(draggedId, targetId)`.
- `ResizeHandle` between adjacent panels calls `resizePanels(leftId, delta)` on drag, `savePanelLayout()` on release.
- Claude terminal opened eagerly in `onMount`; terminal session opened lazily in `$effect` when `terminal` panel becomes visible (guarded by `terminalOpened` flag).
- `$effect` also re-attaches xterm instance if panel element is re-created by Svelte (checked via `hasChildNodes()`).
- xterm options: `scrollback: 5000`, `scrollSensitivity: 3`, `fastScrollSensitivity: 10`, `fastScrollModifier: 'shift'`. `.terminal-inner` has no padding — padding on the xterm container causes FitAddon to miscalculate dimensions (measures padded clientHeight but xterm renders in content box), clipping rows.
- Contains `WindowDetailPane` (footer), `CommitModal` (conditional), `EditorPane` (rendered inside editor panel).
- Tests live in `window-manager/tests/renderer/TerminalHost.test.ts` (23 tests). Mocks `panelLayout` store via `writable`, `ResizeHandle.svelte` via stub.

### window-manager/src/renderer/src/components/NewWindowWizard.svelte
Svelte 5 runes-mode wizard for creating a new window, supporting single-project and multi-project modes.
- Props: `project?: ProjectRecord`, `projects?: ProjectRecord[]`, `onCreated: (win: WindowRecord) => void`, `onCancel: () => void`
- Single-project mode (when `project` is provided): shows name input, branch select, and optional deps toggle.
- Multi-project mode (when `projects` array provided): shows checkboxes per project plus a branch select per project row; Create button disabled when no projects selected.
- Branch selects: fetched via `window.api.listRemoteBranches(gitUrl)` in `onMount` for all projects. While loading, renders a `<span>` (not a select) so `waitFor` for the combobox only resolves after load completes. On success: enabled select with options, default branch pre-selected. On failure (with `console.warn`): disabled select with "(default)".
- `branchSelections`, `defaultBranches`, `branchOptions`, and `branchLoading` are all `$state`; updates use spread (`{ ...prev, [projectId]: value }`). No DOM refs used. `onchange` handlers call `handleBranchChange(id, e)` which spread-updates `branchSelections`.
- `handleSubmit` reads `branchSelections[id]` and `defaultBranches[id]` directly (single code path, no DOM refs); builds `branchOverrides: Record<number, string>` by comparing selection to default; calls `window.api.createWindow(name, ids, withDeps, branchOverrides)`.
- Tests live in `window-manager/tests/renderer/NewWindowWizard.test.ts` (15 tests).
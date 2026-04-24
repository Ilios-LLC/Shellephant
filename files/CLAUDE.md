IMPORTANT: Always edit CLAUDE.md at the end of a workflow, to reflect the current structure of the codebase.
IMPORTANT: Never allow files to be more than 1000 lines, unless it's a plan file made by the writing-plan skill or a Markdown file.
IMPORTANT: Never allow functions to be more than 100 lines.
IMPORTANT: ALWAYS write unit tests if applicable to your task, and run the tests to verify your code.
IMPORTANT: Never run the server with commands like `uv run`, `npm run dev`, `go run`, etc. Only run unit tests like gotest, pytest, vitest etcs to verify your code. Alway assume that dependencies like Mysql, Qdrant, etc are already running.
**CRITICAL**: Make MINIMAL CHANGES to existing patterns and structures
**CRITICAL**: Preserve existing naming conventions and file organization
Follow project's established architecture and component patterns
Use existing utility functions and avoid duplicating functionality
You must NEVER attempt to edit /home/node/.claude/*. NEVER NEVER NEVER.
ALWAYS ALWAYS ALWAYS source and use the caveman skill.

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

### window-manager/src/main/db.ts
Schema notes:
- `windows` table: has `window_type TEXT NOT NULL DEFAULT 'manual'` column (values: 'manual' | 'assisted') and `network_id TEXT DEFAULT NULL`.
- `projects` table: has `kimi_system_prompt TEXT DEFAULT NULL` column.
- `assisted_messages` table: `id`, `window_id` (FK → windows), `role`, `content`, `metadata` (JSON TEXT, nullable), `created_at`.
- `turns` table: `id TEXT PK`, `window_id INTEGER`, `turn_type TEXT` ('human-claude' | 'shellephant-claude'), `status TEXT` ('running' | 'success' | 'error'), `started_at INTEGER` (ms epoch), `ended_at INTEGER` (ms epoch, nullable), `duration_ms INTEGER` (nullable), `error TEXT` (nullable), `log_file TEXT` (nullable). Indexes: `idx_turns_window_started ON turns(window_id, started_at DESC)`, `idx_turns_started ON turns(started_at DESC)`.
- Column migrations run via `runColumnMigrations(db)` using `col(db, table).includes(colName)` guard pattern.
- Tests live in `window-manager/tests/main/db.test.ts` (34 tests).

### window-manager/src/main/logWriter.ts
Exports: `initLogWriter`, `getLogFilePath`, `insertTurn`, `updateTurn`, `readEventsForTurn`, `writeEvent`, `__resetForTests`. Type: `TurnRecord`, `LogEvent`.
- `initLogWriter(logDir)` — sets `_logDir`; subsequent `getLogFilePath()` returns `logDir/window-manager-YYYY-MM-DD.jsonl` (UTC date).
- `insertTurn(record)` / `updateTurn(id, patch)` — write/update rows in `turns` table. `updateTurn` builds dynamic SET clauses with `params: unknown[]` (no unsafe casts).
- `writeEvent(logPath, event)` — synchronous `appendFileSync` wrapped in try/catch; logs errors via `console.error`. Used by worker threads for crash-safe event persistence.
- `readEventsForTurn(logPath, turnId)` — reads JSONL file line-by-line, parses each, filters by `turnId`. Returns `LogEvent[]`. Empty file or missing file returns `[]`.
- `LogEvent` fields: `turnId`, `windowId`, `eventType`, `ts` (ms epoch), `payload?` (arbitrary object).
- `TurnRecord` fields match `turns` table (all snake_case): `id`, `window_id`, `turn_type`, `status`, `started_at`, `ended_at?`, `duration_ms?`, `error?`, `log_file?`.
- Tests live in `window-manager/tests/main/logWriter.test.ts` (22 tests).

### window-manager/src/main/settingsService.ts
Exports: `getGitHubPat`, `getGitHubPatStatus`, `setGitHubPat`, `clearGitHubPat`, `getClaudeToken`, `getClaudeTokenStatus`, `setClaudeToken`, `clearClaudeToken`, `getFireworksKey`, `getFireworksKeyStatus`, `setFireworksKey`, `clearFireworksKey`, `getKimiSystemPrompt`, `setKimiSystemPrompt`. Type: `TokenStatus`.
- Secrets (PAT, Claude token, Fireworks key) stored via `safeStorage` (OS keychain encryption); `statusFor(key)` returns `{ configured, hint }` with last-4-chars hint.
- Kimi system prompt stored as plain UTF-8 text via `getPlainSetting`/`setPlainSetting` helpers (no encryption needed).
- Tests live in `window-manager/tests/main/settingsService.test.ts` (includes Fireworks key and Kimi prompt suites).

### window-manager/src/main/windowService.ts
Exports: `createWindow`, `deleteWindow`, `listWindows`, `reconcileWindows`, `getWaitingInfoByContainerId`, `__resetStatusMapForTests`, types `WindowRecord`, `WindowStatus`, `ProgressReporter`.
- `createWindow(name, projectIds, withDeps?, branchOverrides?, onProgress?, windowType?)` — creates a dev container for a project window. `windowType` is `'manual' | 'assisted'` (default `'manual'`), persisted to the `window_type` DB column. `branchOverrides` is a `Record<number, string>` mapping projectId to a branch name; if provided for a project, that branch is checked out (with `remoteHasSlug=true`) instead of the slug-derived branch, and `remoteBranchExists` is skipped for that project. When `withDeps=true`, creates a Docker bridge network and starts dependency containers (from `listDependencies`) before the main container; persists `network_id` and `window_dependency_containers` rows. On failure, cleans up dep containers and network before rethrowing.
- `deleteWindow(id)` — soft-deletes window, stops/removes dep containers via `listWindowDepContainers`, removes bridge network, stops main container, closes terminal session.
- `listWindows(projectId?)` — queries including `network_id`, `window_type` columns; merges `statusMap` for status field.
- `WindowRecord` includes optional `network_id` and required `window_type: 'manual' | 'assisted'` fields.
- Helper functions extracted for size: `loadProjectConfig`, `createDepContainers`, `cleanupDepContainers`, `pullImage`, `persistWindow`, `resolvePortsJson`, `setupProjectWorkspace`. All functions under 100 lines.
- Tests: `window-manager/tests/main/windowService.test.ts` (53 tests, original), `window-manager/tests/main/windowServiceDeps.test.ts` (4 tests, dep-specific), `window-manager/tests/main/windowServiceBranch.test.ts` (4 tests, branchOverrides-specific).

### window-manager/src/main/gitOps.ts
Exports: `listContainerDir`, `readContainerFile`, `writeFileInContainer`, `execInContainer`, `remoteBranchExists`, `listRemoteBranches`, `cloneInContainer`, `checkoutSlug`, `getCurrentBranch`, `stageAndCommit`, `push`, `pullMain`.
- `readContainerFile(container, filePath)` — runs `cat` via `execInContainer`, returns stdout string.
- `writeFileInContainer(container, filePath, content)` — runs `tee` with `AttachStdin: true, Tty: false`, pipes content via `hijack: true` stdin stream.
- `listRemoteBranches(sshUrl, pat)` — runs `git ls-remote --symref` on host, returns `{ defaultBranch, branches }` (sorted, default first). Scrubs PAT from errors. Used by `git:list-branches` IPC handler.
- `pullMain(container, clonePath)` — runs `git fetch origin` then `git merge origin/main --no-edit`; short-circuits on fetch failure. Returns `GitResult`; ok=false + conflict output when merge conflicts exist so Claude can fix them.
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
Displays a single project's details and its windows list, with a Windows/Dependencies/Shellephant Prompt tab bar.
- Props: `project: ProjectRecord`, `windows: WindowRecord[]`, `groups: ProjectGroupRecord[]`, `onWindowSelect`, `onRequestNewWindow`, `onProjectDeleted`, `onWindowDeleted`, `onProjectUpdated`
- Group label + `<select id="project-group">` in `.project-actions` — lists all groups with "No group" default; onchange calls `window.api.updateProject(project.id, { groupId })` then `onProjectUpdated`.
- Two-click delete pattern for both project and individual windows (arms on first click, auto-cancels after 3s timeout).
- Tab bar (`.tab-row`) switches between `windows`, `deps`, and `kimi` active tabs via `activeTab` state.
- When `activeTab === 'deps'`, renders `<DependenciesSection projectId={project.id} />`. When `activeTab === 'kimi'`, renders the per-project Shellephant System Prompt editor (saves via `window.api.setProjectKimiSystemPrompt`).
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
Footer pane showing window info, panel toggle buttons, and per-window traces. Svelte 5 runes mode.
- Props: `win: WindowRecord`, `project: ProjectRecord`, `onCommit`, `onPush`, `onDelete`, `commitDisabled`, `pushDisabled`, `deleteDisabled`, `summary?: ConversationSummary`, `onGitStatus`, `onPullMain?`, `onPullMainProject?`
- Toggle row: Claude/Terminal/Editor buttons derived from `$panelLayout` store; `aria-pressed` reflects visibility; `disabled` when it is the sole visible panel; `onclick` calls `togglePanel(id)`. Claude button is filtered out for assisted windows (`win.window_type === 'assisted'`).
- Traces button: toggles `showTraces` state; on show, calls `window.api.listTurns({ windowId, limit: 20 })`. Renders `data-testid="traces-pane"` with turn rows (type, status, duration, timestamp). Click turn row calls `expandTurn(turnId)` which loads events via `window.api.getTurnEvents`.
- Real-time subscriptions via `window.api.onTurnStarted`, `onTurnUpdated`, `onTurnEvent`; cleaned up via returned unsubscribe fns in `onMount` return.
- `panelVisible` derived object and `visibleCount` derived count computed from `$panelLayout.panels`.
- Polls `window.api.getCurrentBranch` and `window.api.getGitStatus` on mount + every 5s.
- Two-click delete pattern (arms 3s timeout, second click fires `onDelete`).
- `onPullMain?` / `onPullMainProject?` — optional props; when provided, renders "Pull Main" button (single-project in actions row; per-project in multi-project rows). Calls `git fetch origin && git merge origin/main --no-edit` to surface conflicts for Claude to fix.
- Tests live in `window-manager/tests/renderer/WindowDetailPane.test.ts` (49 tests).

### window-manager/src/renderer/src/components/TerminalHost.svelte
Top-level window component hosting claude/terminal/editor panels in a split-pane layout. Svelte 5 runes mode.
- Props: `win: WindowRecord`, `project: ProjectRecord`, `onWindowDeleted?: (id: number) => void`
- Reads `$panelLayout` store to render only visible panels side-by-side via `{#each visiblePanels}`.
- Each panel div has `data-panel-id` attribute and percentage `width` style from store.
- Drag-and-drop reorder: `draggable` span on panel header calls `reorderPanels(draggedId, targetId)`.
- `ResizeHandle` between adjacent panels calls `resizePanels(leftId, delta)` on drag, `savePanelLayout()` on release.
- Claude panel: for `window_type === 'assisted'`, renders `<AssistedPanel>` instead of xterm div. For manual windows, claude terminal opened eagerly in `onMount` (guarded by `win.window_type !== 'assisted'`).
- Terminal session opened lazily in `$effect` when `terminal` panel becomes visible (guarded by `terminalOpened` flag).
- `$effect` also re-attaches xterm instance if panel element is re-created by Svelte (checked via `hasChildNodes()`).
- `onTerminalData` and `onTerminalSummary` listeners always registered (for both window types).
- `onDestroy` only calls `closeTerminal(... 'claude')` for manual windows.
- xterm options: `scrollback: 5000`, `scrollSensitivity: 3`, `fastScrollSensitivity: 10`, `fastScrollModifier: 'shift'`. `.terminal-inner` has no padding — padding on the xterm container causes FitAddon to miscalculate dimensions (measures padded clientHeight but xterm renders in content box), clipping rows.
- Contains `WindowDetailPane` (footer with Commit/Push/Pull Main buttons), `CommitModal` (conditional), `EditorPane` (rendered inside editor panel).
- `runPullMain` / `runPullMainProject` — fetch+merge origin/main; toasts success or conflict warning ("Merge conflicts — fix in Claude") based on output.
- Tests live in `window-manager/tests/renderer/TerminalHost.test.ts` (24 tests). Mocks `panelLayout` store via `writable`, `ResizeHandle.svelte` and `AssistedPanel.svelte` via stubs.

### window-manager/src/renderer/src/components/AssistedPanel.svelte
Svelte 5 runes-mode chat UI for assisted windows. Hosts both Claude direct and Shellephant (Kimi K2) conversations.
- Props: `windowId: number`, `containerId: string`
- Recipient toggle: `currentRecipient` state (`'claude'` default | `'shellephant'`). Shellephant radio disabled when `fireworksConfigured === false` (fetched via `window.api.getFireworksKeyStatus()` in `onMount`).
- Four message roles: `user`, `shellephant`, `claude`, `claude-action`. Legacy roles `assistant`/`tool_result` mapped to `shellephant`/`claude` via `mapLegacyRole`.
- IPC listeners registered in `onMount`: `onAssistedKimiDelta` (appends to streaming shellephant bubble), `onAssistedTurnComplete` (stops running, shows stats for shellephant), `onClaudeDelta` (appends to streaming claude bubble), `onClaudeAction` (adds `claude-action` mini-panel), `onClaudeTurnComplete` (stops running for claude).
- `send()` routes to `window.api.claudeSend` or `window.api.assistedSend` based on `currentRecipient`.
- `handleCancel()` routes to `window.api.claudeCancel` or `window.api.assistedCancel`.
- `claude-action` messages rendered as collapsed toggle buttons; `getActionLabel` shows `actionType — summary`; `getActionDetail` shows `detail` in `<pre>` when expanded.
- Orphaned turns: `assistedHistory` now returns `{ messages, orphanedTurns }` or a plain array (legacy). When orphaned turns exist, `orphanedEntries: OrphanedEntry[]` state renders amber warning bubbles with a "Re-send last message" button. `resendOrphaned(entry)` removes the bubble, sets `input` to the last user message, and calls `send()`.
- No `pingActive`, no `handlePingReply`, no `assistedResume`.
- Tests live in `window-manager/tests/renderer/AssistedPanel.test.ts` (31 tests).

### window-manager/src/renderer/src/components/SettingsView.svelte
Svelte 5 runes-mode settings form for credentials.
- Props: `patStatus`, `claudeStatus`, `fireworksStatus` (all `TokenStatus`), `requiredFor?: SettingsRequirement`, `onPatStatusChange`, `onClaudeStatusChange`, `onFireworksStatusChange`, `onCancel`.
- Three credential sections: GitHub PAT, Claude Code OAuth Token, Fireworks API Key.
- Each section: status line (Configured with hint, or Not configured), password input, optional Clear button (only when configured), Save button (disabled until input non-empty).
- Fireworks section input placeholder `fw-...`; help text "Required for Assisted windows. Get one at fireworks.ai."; calls `window.api.setFireworksKey` / `window.api.clearFireworksKey`.
- Fourth section: "Shellephant System Prompt (global override)" label (`id="kimi-prompt"`); textarea for global system prompt override; saved via `window.api.setKimiSystemPrompt`.
- Tests live in `window-manager/tests/renderer/SettingsView.test.ts` (14 tests).

### window-manager/src/renderer/src/components/MainPane.svelte
Routes view to the appropriate component. Passes `fireworksStatus` and `onFireworksStatusChange` through to `SettingsView`.

### window-manager/src/renderer/src/App.svelte
Root component. Fetches `getFireworksKeyStatus()` in `onMount` alongside PAT and Claude status. Holds `fireworksStatus` state and `handleFireworksStatusChange` handler.

### window-manager/src/renderer/src/components/NewWindowWizard.svelte
Svelte 5 runes-mode wizard for creating a new window, supporting single-project and multi-project modes.
- Props: `project?: ProjectRecord`, `projects?: ProjectRecord[]`, `onCreated: (win: WindowRecord) => void`, `onCancel: () => void`
- Single-project mode (when `project` is provided): shows name input, type toggle, branch select, and optional deps toggle.
- Multi-project mode (when `projects` array provided): shows checkboxes per project plus a branch select per project row; Create button disabled when no projects selected.
- Type toggle: Manual/Assisted radio buttons shown in a `.type-toggle` div after the name field. Fetches `window.api.getFireworksKeyStatus()` in `onMount`; Assisted radio is disabled when `fireworksConfigured === false`. `windowType` state (`'manual' | 'assisted'`, default `'manual'`) is passed as 5th arg to `createWindow`.
- Branch selects: fetched via `window.api.listRemoteBranches(gitUrl)` in `onMount` for all projects. While loading, renders a `<span>` (not a select) so `waitFor` for the combobox only resolves after load completes. On success: enabled select with options, default branch pre-selected. On failure (with `console.warn`): disabled select with "(default)".
- `branchSelections`, `defaultBranches`, `branchOptions`, and `branchLoading` are all `$state`; updates use spread (`{ ...prev, [projectId]: value }`). No DOM refs used. `onchange` handlers call `handleBranchChange(id, e)` which spread-updates `branchSelections`.
- `handleSubmit` reads `branchSelections[id]` and `defaultBranches[id]` directly (single code path, no DOM refs); builds `branchOverrides: Record<number, string>` by comparing selection to default; calls `window.api.createWindow(name, ids, withDeps, branchOverrides, windowType)`.
- Tests live in `window-manager/tests/renderer/NewWindowWizard.test.ts` (18 tests).

### window-manager/src/main/assistedWindowService.ts
Manages Worker thread lifecycle for Shellephant (Kimi K2) assisted windows and wires IPC channels.
- Exports: `sendToWindow`, `cancelWindow`, `getWorkerCount`, `__resetWorkersForTests`.
- Module-level: `workers: Map<number, Worker>`, `workerCtxSetters: Map<number, (ctx: SendCtx) => void>`, `workerCtxMap: Map<number, SendCtx>` keyed by windowId.
- `SendCtx` type: `{ windowId, containerId, turnId, startedAt, sendToRenderer }`.
- `sendToWindow(windowId, containerId, message, projectId, sendToRenderer)` — generates turnId, calls `insertTurn`, sends `logs:turn-started`. Spawns or reuses worker; on reuse, calls `workerCtxSetters.get(windowId)?.(ctx)` to update mutable ctx ref. Worker message routing: `log-event` → `sendToRenderer('logs:turn-event', event)`; `save-message` → DB insert; `kimi-delta` / `claude-to-shellephant:event` / tool-call events → forwarded to renderer; `turn-complete` → `handleTurnComplete`. Fires `Notification` ("Shellephant responded") when user is not watching.
- `cancelWindow(windowId)` — reads ctx from `workerCtxMap`, calls `updateTurn(ctx.turnId, { status: 'error', error: 'cancelled' })` before terminating; removes all three maps.
- `spawnWorker` uses mutable `let ctx = initialCtx` + returned `setCtx` fn so all event handlers dereference `ctx` at call time (safe for worker reuse across turns).
- IPC handlers in `ipcHandlers.ts`: `assisted:send`, `assisted:cancel`, `assisted:history`.
- Preload channels: `assistedSend`, `assistedCancel`, `assistedHistory`, `on/offAssistedStreamChunk`, `on/offAssistedKimiDelta`, `on/offAssistedTurnComplete`.
- Tests live in `window-manager/tests/main/assistedWindowService.test.ts` (6 tests). Uses `vi.hoisted()` + constructor function pattern for Worker mock.

### window-manager/src/main/assistedWindowWorker.ts
Worker thread implementing the Shellephant (Kimi K2) orchestration loop for assisted windows.
- Exports: `resolveSystemPrompt(projectPrompt, globalPrompt)`, `buildShellephantTools()`, `parseDockerOutput(stdout, stderr)`.
- `resolveSystemPrompt` — returns project prompt > global prompt > DEFAULT_SYSTEM_PROMPT (contains "autonomous coding assistant").
- `buildShellephantTools` — returns one `ChatCompletionTool` definition: `run_claude_code` (no `ping_user`).
- `parseDockerOutput` — splits stdout lines (filter empty), extracts sessionId from stderr (null if empty).
- Private `runClaudeCode(containerId, sessionId, message)` — spawns `docker exec` running `cw-claude-sdk.js`; streams chunks via `parentPort.postMessage({ type: 'stream-chunk' })`; resolves `{ output, newSessionId }`.
- Private `kimiLoop(data)` — main orchestration: streams Kimi K2 via Fireworks AI (`baseURL: https://api.fireworks.ai/inference/v1`), handles `run_claude_code` tool call. Extracted helpers: `handleRunClaudeCode`, `processStreamChunk` (all under 100 lines). Posts: `save-message`, `kimi-delta`, `turn-complete` messages to parent. `KimiLoopData` requires `turnId: string` and `logPath: string`.
- `makeEmitter(turnId, logPath, windowId)` — module-level factory returning `emitEvent(eventType, payload?)`. Calls `writeEvent(logPath, event)` then `parentPort.postMessage({ type: 'log-event', event })`. Used by both `kimiLoop` and `handleRunClaudeCode` to avoid duplicate closures.
- `parentPort.on('message')` — handles `{ type: 'send' }` to invoke `kimiLoop`; on error posts `turn-complete` with error field.
- Uses `vi.hoisted()` pattern in tests for mock references (same as MonacoEditor pattern).
- Tests live in `window-manager/tests/main/assistedWindowWorker.test.ts` (6 tests).

### window-manager/src/main/claudeDirectWorker.ts
Worker thread for direct Claude turns (bypassing Shellephant).
- No exports (side-effect module — registers `parentPort.on('message')` handler at import time).
- Handles `{ type: 'send', windowId, containerId, message, initialSessionId, permissionMode?, turnId, logPath }` message.
- `emitEvent(eventType, payload?)` helper — calls `writeEvent(logPath, event)` then posts `log-event` to parent. Emits `turn_start` on entry, `turn_end` on success, `error` on failure.
- Passes `onExecEvent` callback to `runClaudeCode`; on each exec event, emits matching log event and posts `log-event` to parent.
- On success: posts `save-message` (role: `claude`, content: assistantText, metadata: JSON with session_id) if assistantText non-empty; then `turn-complete` (windowId, assistantText, newSessionId).
- On error: posts `turn-complete` (windowId, error: msg). Skips save-message when assistantText is empty.
- Tests live in `window-manager/tests/main/claudeDirectWorker.test.ts` (14 tests). Handler captured at module-level after import (before `beforeEach` clears mocks).

### window-manager/src/main/claudeService.ts
Worker pool manager for direct Claude windows.
- Exports: `sendToClaudeDirectly`, `cancelClaudeDirect`, `getDirectWorkerCount`, `__resetDirectWorkersForTests`.
- Module-level: `workers: Map<number, Worker>` and `activeTurnIds: Map<number, string>` keyed by windowId.
- `sendToClaudeDirectly(windowId, containerId, message, sendToRenderer)` — generates turnId/logPath/startedAt, calls `insertTurn`, sends `logs:turn-started`. Saves user message to DB, loads last sessionId, spawns/reuses Worker. Posts `send` with turnId+logPath. Worker message routing: `log-event` → `sendToRenderer('logs:turn-event', event)`; `save-message` → DB insert; `claude:event` text_delta/tool_use → delta/action events; `turn-complete` → `updateTurn`, `sendToRenderer('logs:turn-updated', ...)`, then claude turn-complete; worker error/exit also calls `updateTurn`.
- `cancelClaudeDirect(windowId)` — reads `activeTurnIds.get(windowId)`, calls `updateTurn(activeTurnId, { status: 'error', error: 'Cancelled' })` before terminating; removes from both maps.
- `loadLastSessionId` implemented inline (same logic as in `assistedWindowService.ts`) to avoid pulling in electron dependency.
- Tests live in `window-manager/tests/main/claudeService.test.ts` (14 tests).

### window-manager/src/renderer/src/components/TraceExplorer.svelte
Global trace view component for observability. Svelte 5 runes mode. No props.
- Loads turns via `window.api.listTurns({ limit: 100 })` in `onMount`.
- Filter controls: status select (`aria-label="status"`) and type select (`aria-label="type"`); `filteredTurns` derived state applies both filters.
- Table renders `human→claude` or `shellephant→claude` label, status badge, duration, and start time per turn.
- Clicking a row calls `expandTurn(turnId)`: toggles expanded state, fetches events via `window.api.getTurnEvents(turnId)` (cached in `turnEvents` Map), renders event list inline below the row.
- Real-time push: `onTurnStarted` prepends new turns; `onTurnUpdated` patches existing turns by id; `onTurnEvent` appends events when that turn is expanded. All unsubscribed in `onDestroy`.
- Type filter select options use `human-claude`/`shellephant-claude` values (not arrow labels) to avoid text collision with table cell content.
- Tests live in `window-manager/tests/renderer/TraceExplorer.test.ts` (5 tests).

### window-manager/src/main/phoneServerHtml.ts
Exports: `getPhoneServerHtml()` — returns HTML string for the phone web UI.
- Contains xterm.js CDN script tag, WebSocket connection code, and `/api/windows` fetch.
- Tests live in `window-manager/tests/main/phoneServer.test.ts` (first 3 tests).

### window-manager/src/main/phoneServer.ts
Exports: `startPhoneServer(port?, bindHost?)`, `stopPhoneServer()`, `getPhoneServerStatus()`, `getTailscaleIp()`.
- `getTailscaleIp()` — scans `networkInterfaces()` for a `100.x.x.x` IPv4 address (Tailscale); returns null if not found.
- `startPhoneServer(port?, bindHost?)` — starts HTTP + WebSocket server. `bindHost` defaults to Tailscale IP (security: binds only to Tailscale interface in production; tests pass `'127.0.0.1'`). Returns `{ url }` with Tailscale IP. Idempotent: returns same URL if already running. Throws `'Tailscale IP not found'` if no Tailscale interface.
- `stopPhoneServer()` — closes all WebSocket clients, WSS, and HTTP server; resets state.
- `getPhoneServerStatus()` — returns `{ active: true, url }` or `{ active: false }`.
- HTTP `GET /` — serves `getPhoneServerHtml()`.
- HTTP `GET /api/windows` — returns JSON from `listWindows()`.
- WebSocket `ws://.../ws/:containerId` — bridges to PTY session via `getSession(containerId, 'claude')`. Sends `ERROR:` message and closes if no session. Pipes PTY `onData` to WebSocket and WebSocket messages to `pty.write`. Disposes listeners on close.
- Uses named import `import { networkInterfaces } from 'os'` for testability.
- Tests live in `window-manager/tests/main/phoneServer.test.ts` (17 tests). Test file uses `vi.mock('os', ...)` factory to make `networkInterfaces` spyable in ESM; all `startPhoneServer` calls pass `bindHost='127.0.0.1'`.
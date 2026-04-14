# Window Git Ops — Design

Date: 2026-04-14

## User Entrypoint

- **Type:** Web Application (Electron + Svelte)
- **Verification Method:** Vitest unit tests + manual UI smoke checklist. Playwright-Electron is not wired; if needed, add in a later pass.

## Goals

Give each window a bottom detail pane with a Commit and Push button so a user can stage-all + commit + push from inside the app without dropping into the terminal. Clone the repo **inside the container** (not on the host) and check out a branch named after the window slug.

## User-Facing Capabilities

When this ships, a user can:

1. Create a window. The container starts, the repo clones **inside the container**, and the working copy checks out a branch named after the kebab-slugged window name — tracking the remote branch if one with that name exists, otherwise a new local branch.
2. Select a window and see a bottom detail pane under the terminal showing: window name, project name, current branch, container status. Branch refreshes every 5 s.
3. Click **Commit** in the pane. A modal asks for a subject (required) and body (optional). Submitting runs `git add --all` then `git commit` inside the container using the PAT-owner's GitHub identity. A toast reports the git output.
4. Click **Push** in the pane. The app runs `git push -u origin <branch>` inside the container with the PAT supplied via an explicit URL in argv (never stored in the container). A toast reports the git output.
5. See clear error toasts for the usual failure cases: nothing to commit, non-fast-forward push, network, bad PAT.

## Out of Scope

- Pull / fetch / rebase
- Branch switching UI, diff viewer, merge conflict resolution
- Force-push, co-author, conventional-commit linting, sign-off
- Persisting the slug in the DB (we recompute from `name` — slug fn is deterministic)

## Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Slug style | kebab-case, lowercase, alnum + `-` | Simplest; safe as a git ref |
| Remote branch lookup | `git ls-remote --heads` pre-clone | Decide tracking vs new branch before cloning |
| Checkout | Track remote if exists, else `checkout -b <slug>` | Matches user intent |
| Clone location | Inside container via `docker exec` | Host-side clone + `docker cp` replaced |
| PAT delivery for clone / push | Exec-time only, URL in argv | Never touches container filesystem |
| Commit author | Fetched once from `GET /user` at app start, cached in main-process memory | One network call per session |
| Commit identity delivery | `git -c user.name=... -c user.email=...` on the commit exec | No config persisted in container |
| Push strategy | `git push -u origin <branch>` always | Idempotent, sets upstream on first push |
| Conflict / non-fast-forward | Surface stderr in toast; user resolves in terminal | Out of scope to automate |
| Poll interval | 5 s for branch | Cheap; keeps pane responsive to in-terminal `git checkout` |
| PAT scrubbing | Replace PAT in any stdout/stderr before toast/log | Avoid accidental leak |

## Architecture

### New main-process modules

- `src/main/slug.ts` — pure `toSlug(name)`: lowercase, strip diacritics, replace non-alnum with `-`, collapse repeats, trim leading/trailing `-`. Throws on empty result.
- `src/main/githubIdentity.ts` — `getIdentity(pat)`: fetches `GET https://api.github.com/user`, caches `{name, email}` in module scope. Email fallback: `<id>+<login>@users.noreply.github.com`. `invalidate()` clears cache (called on PAT change).
- `src/main/gitOps.ts` — thin wrappers over `docker exec`:
  - `remoteBranchExists(sshUrl, slug, pat): Promise<boolean>` — host-side `git ls-remote --heads <httpsUrl> <slug>`.
  - `cloneInContainer(containerId, sshUrl, pat, clonePath)` — clone with PAT URL, then `remote set-url` to strip.
  - `checkoutSlug(containerId, clonePath, slug, remoteHasSlug)` — `git checkout <slug>` or `git checkout -b <slug>`.
  - `getCurrentBranch(containerId, clonePath): Promise<string>`.
  - `stageAndCommit(containerId, clonePath, {subject, body, name, email}): Promise<GitResult>`.
  - `push(containerId, clonePath, branch, sshUrl, pat): Promise<GitResult>`.
  - `GitResult = { ok: boolean; code: number; stdout: string; stderr: string }` — stdout/stderr pre-scrubbed of PAT.

### Modified main-process modules

- `windowService.ts` — remove `cloneOnHost` + `docker cp`. New `createWindow` flow (see Data Flow below). Pre-check remote branch before starting container so we can fail fast on auth/network before spending resources. Rollback (stop + remove container) on any post-start failure.
- `ipcHandlers.ts` — register:
  - `git:commit` `(containerId, {subject, body}) => GitResult`
  - `git:push` `(containerId) => GitResult`
  - `git:current-branch` `(containerId) => string`
- `settingsService.ts` — on `setGitHubPat` / `clearGitHubPat`, call `githubIdentity.invalidate()`.
- `preload/index.ts` + `index.d.ts` — expose `api.commit`, `api.push`, `api.getCurrentBranch`.

### New renderer components

- `WindowDetailPane.svelte` — bottom pane inside `TerminalHost.svelte`. Flex row: left info block, right button group. Starts a 5 s `setInterval` calling `api.getCurrentBranch(containerId)`. Clears interval on destroy.
- `CommitModal.svelte` — modal overlay. Subject `<input>` (required, trimmed), body `<textarea>` (optional). Submit button disabled while subject is empty or op is in-flight.
- `Toast.svelte` + small store — stack of transient toasts, success (green) and error (red), each shows title + `<pre>` for git output.

## Data Flow

### Create window

```
1. toSlug(name)                      → slug
2. Resolve PAT + Claude token from settings (fail fast if missing)
3. getDb: look up project.git_url
4. remoteHasSlug = remoteBranchExists(git_url, slug, PAT)  // host-side ls-remote
5. Create + start container (cc image, Claude token env)
6. docker exec: mkdir -p /workspace/<repo>
7. cloneInContainer(container, git_url, PAT, clonePath)
   - git clone https://x-access-token:<PAT>@host/path <clonePath>
   - git -C <clonePath> remote set-url origin <sshUrl>     // strip PAT
8. checkoutSlug(container, clonePath, slug, remoteHasSlug)
   - remoteHasSlug: git checkout <slug>
   - else:          git checkout -b <slug>
9. INSERT windows row, return WindowRecord
10. On failure after step 5: stop + remove container, rethrow
```

### Commit

```
1. User clicks Commit → CommitModal opens
2. User fills subject (req) + body (opt), hits Submit
3. renderer → api.commit(containerId, {subject, body})
4. main: {name, email} = await getIdentity(PAT)
5. docker exec -w <clonePath> <c> git add --all
6. docker exec -w <clonePath> <c> git
      -c user.name=<name> -c user.email=<email>
      commit -m <subject> [-m <body>]
7. Return GitResult (stdout/stderr scrubbed). If code==1 and stderr matches
   /nothing to commit/, rewrite message to "Nothing to commit."
8. renderer: toast result. Close modal on ok.
```

### Push

```
1. User clicks Push
2. renderer → api.push(containerId)
3. main: look up window → project.git_url, derive httpsUrl via existing sshUrlToHttps
4. branch = await getCurrentBranch(containerId, clonePath)
5. docker exec -w <clonePath> <c> git push -u <httpsUrl> <branch>
6. Return GitResult (PAT scrubbed from stdout/stderr).
7. renderer: toast result.
```

### Branch poll

```
Every 5 s per open WindowDetailPane:
  api.getCurrentBranch(containerId) → docker exec git -C <path> rev-parse --abbrev-ref HEAD
On error: keep last value, do NOT toast.
On stopped container (exec 404): stop interval; rely on status reconcile.
```

## Error Handling

**Window create**

- `ls-remote` fails → abort before container start, bubble error with stderr.
- In-container `clone` fails → stop + remove container, bubble stderr.
- `checkout` fails → stop + remove container, bubble stderr.

**Commit**

- Empty subject → modal blocks submit; no IPC call.
- `git add --all` non-zero → toast stderr, skip commit.
- `git commit` exits 1 with "nothing to commit" → friendly toast "Nothing to commit."
- Identity unavailable → commit button disabled with tooltip.

**Push**

- Non-fast-forward → raw stderr in toast; user resolves in terminal.
- Network / auth → stderr in toast.

**Polling**

- Errors swallowed to avoid toast spam; last-known branch stays visible.

**PAT hygiene**

- Every stdout/stderr string passes through a scrub fn that replaces the PAT substring with `***` before it leaves the main process.

## Testing

### Unit (Vitest, node config)

- `slug.test.ts` — mapping cases incl. accents, leading/trailing whitespace, repeated dashes, empty → throws.
- `githubIdentity.test.ts` — `/user` mock, email null fallback, caching behavior, `invalidate()` clears.
- `gitOps.test.ts` — mock `Dockerode.exec` + host `execFile`:
  - `stageAndCommit` issues `add --all` then `commit` with `-c user.name/-c user.email` and `-m subj [-m body]`.
  - Body omitted when empty.
  - `push` uses explicit `httpsUrl` + `-u` + `branch`; PAT scrubbed from returned stderr.
  - `getCurrentBranch` trims stdout.
  - `remoteBranchExists` true on ls-remote hit, false on empty.
- `windowService.test.ts` — update to assert in-container clone, `remote set-url` scrub, tracking vs `-b` choice based on mocked `ls-remote`.
- `ipcHandlers.test.ts` — smoke: new channels registered and forward args.

### Manual UI smoke (pre-ship checklist)

1. Create window with a slug-heavy name → terminal opens; `git branch` inside shows the slug.
2. Create window whose slug already exists on remote → pane shows the slug, `git log` shows remote history.
3. Commit with empty subject → submit disabled.
4. Commit with staged changes → success toast; `git log` shows new commit w/ PAT-user identity.
5. Commit with no changes → friendly "Nothing to commit" toast.
6. Push a fresh branch → remote shows the branch; upstream is set.
7. Push after remote diverges → error toast with git stderr.
8. Switch branch via terminal `git checkout -b other` → pane updates within ~5 s.

## Phase Verification Approach

Each implementation phase is verified by:

- **Unit-level changes** (slug, githubIdentity, gitOps): `npm run test -- <file>` passes.
- **Main-process wiring** (windowService, ipcHandlers): existing windowService tests still pass, updated to the new in-container flow.
- **Renderer changes** (WindowDetailPane, CommitModal, toasts): manual smoke items 1–8 above. A Vitest renderer test can cover the commit-modal form contract (subject required, body optional, submit disabled while empty/in-flight), but the full commit/push loop is verified manually since it needs a live container.

# Window Git Ops Test Verification

> UEP Type: Web Application (Electron + Svelte)
> Verification Method: Vitest unit tests + manual UI smoke against `npm run dev`

---

## Phase 1: In-container clone + slug branch checkout

**Verification performed:** 2026-04-14
**Commits covered:** `adae0480` (toSlug) → `c3adafb` (prettier autofix)

**Automated checks (controller-run):**

- `npm run test` — all passing
  - `test:main`: 11 test files, 136 tests passing (includes 6 new slug cases, 4 scrub cases, 10 gitOps cases, 14 refactored windowService cases with in-container assertions, stop+remove on failure, container leak prevention).
  - `test:renderer`: 10 test files, 59 tests passing (no renderer changes in Phase 1).
- `npm run typecheck` — `tsc --noEmit` clean; svelte-check 224 files 0 errors 0 warnings.
- `npm run lint` — no net-new errors vs baseline (36 errors pre-existing, unchanged count). Prettier autofixes committed as `c3adafb`.

**Manual UI smoke checklist (user to complete):**

- [ ] Start app: `cd window-manager && npm run rebuild && npm run dev` (electron-rebuild required after vitest runs flipped the native binding).
- [ ] Create a project pointing at a git repo you control.
- [ ] Create a window named `My Feature!` in that project. Watch the progress steps fire: "Probing remote…", "Starting dev container…", "Preparing workspace…", "Cloning repository in container…", "Checking out branch…", "Finalizing…".
- [ ] Open the window's terminal. Run `pwd && git -C /workspace/<repo> branch --show-current`. Expected: branch is `my-feature`.
- [ ] Run `cat /workspace/<repo>/.git/config`. Expected: `url = git@github.com:...` (SSH form, no PAT leaked).
- [ ] Create a second window whose name matches an existing remote branch. Verify the terminal shows that branch tracked and `git log` shows remote history.
- [ ] Delete a window. The container stops, is removed (no `docker ps -a` entry), and the UI removes the row.
- [ ] (Optional, adversarial) Force `container.start` to fail (e.g., stop Docker mid-create). Confirm the half-created container is removed automatically (no orphans in `docker ps -a`).

**Result:** Pending manual UI smoke.

---

## Phase 2: Bottom detail pane + branch polling

**Verification performed:** 2026-04-14
**Commits covered:** `5955e4f` (git:current-branch IPC + docker.ts extract) → `150c2ac` (prettier autofix)

**Automated checks (controller-run):**

- `npm run test` — all passing.
  - `test:main`: 11 files, 138 tests (added 2 for `git:current-branch` handler: happy path + window-not-found).
  - `test:renderer`: 11 files, 66 tests (added 8 for `WindowDetailPane`: labels, initial poll, interval tick, error tolerance, button defaults, onCommit + onPush callbacks, disabled pass-through).
- `npm run typecheck` — clean.
- Phase 2 files pass `eslint --max-warnings=0` after prettier autofix (`150c2ac`).

**Manual UI smoke checklist (user to complete):**

- [ ] `npm run rebuild && npm run dev` (native binding flip).
- [ ] Open a window. Bottom pane appears under the terminal showing: window name, project name, current branch (the slug), status `running`.
- [ ] Commit + Push buttons visible and **disabled** (default for Phase 2).
- [ ] In the terminal: `cd /workspace/<repo> && git checkout -b scratch`. Within ~5 s, the pane branch field updates to `scratch`.
- [ ] Stop the container externally (`docker stop <id>`). Branch polling errors are swallowed — the pane keeps the last-known branch rather than flickering to `…`.
- [ ] Select a different window and return. Pane re-mounts cleanly (no ghost intervals in DevTools, no console errors).

**Result:** Pending manual UI smoke.

---

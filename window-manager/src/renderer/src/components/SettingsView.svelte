<script lang="ts">
  import type { TokenStatus } from '../types'

  export type SettingsRequirement = null | 'project' | 'window' | 'multi-window'

  interface Props {
    patStatus: TokenStatus
    claudeStatus: TokenStatus
    fireworksStatus: TokenStatus
    requiredFor?: SettingsRequirement
    onPatStatusChange: (status: TokenStatus) => void
    onClaudeStatusChange: (status: TokenStatus) => void
    onFireworksStatusChange: (status: TokenStatus) => void
    onCancel: () => void
  }

  let {
    patStatus,
    claudeStatus,
    fireworksStatus,
    requiredFor = null,
    onPatStatusChange,
    onClaudeStatusChange,
    onFireworksStatusChange,
    onCancel
  }: Props = $props()

  let patInput = $state('')
  let patBusy = $state(false)
  let patError = $state('')

  let claudeInput = $state('')
  let claudeBusy = $state(false)
  let claudeError = $state('')

  let fireworksInput = $state('')
  let fireworksBusy = $state(false)
  let fireworksError = $state('')

  let bannerText = $derived.by(() => {
    if (requiredFor === 'project') {
      return 'A GitHub PAT and a Claude token are required before you can create a project.'
    }
    if (requiredFor === 'window') {
      return 'A GitHub PAT and a Claude token are required before you can create a window.'
    }
    return null
  })

  async function savePat(): Promise<void> {
    const trimmed = patInput.trim()
    if (!trimmed || patBusy) return
    patBusy = true
    patError = ''
    try {
      const next = await window.api.setGitHubPat(trimmed)
      patInput = ''
      onPatStatusChange(next)
    } catch (err) {
      patError = err instanceof Error ? err.message : String(err)
    } finally {
      patBusy = false
    }
  }

  async function clearPat(): Promise<void> {
    if (patBusy) return
    patBusy = true
    patError = ''
    try {
      const next = await window.api.clearGitHubPat()
      onPatStatusChange(next)
    } catch (err) {
      patError = err instanceof Error ? err.message : String(err)
    } finally {
      patBusy = false
    }
  }

  async function saveClaude(): Promise<void> {
    const trimmed = claudeInput.trim()
    if (!trimmed || claudeBusy) return
    claudeBusy = true
    claudeError = ''
    try {
      const next = await window.api.setClaudeToken(trimmed)
      claudeInput = ''
      onClaudeStatusChange(next)
    } catch (err) {
      claudeError = err instanceof Error ? err.message : String(err)
    } finally {
      claudeBusy = false
    }
  }

  async function clearClaude(): Promise<void> {
    if (claudeBusy) return
    claudeBusy = true
    claudeError = ''
    try {
      const next = await window.api.clearClaudeToken()
      onClaudeStatusChange(next)
    } catch (err) {
      claudeError = err instanceof Error ? err.message : String(err)
    } finally {
      claudeBusy = false
    }
  }

  async function saveFireworks(): Promise<void> {
    const trimmed = fireworksInput.trim()
    if (!trimmed || fireworksBusy) return
    fireworksBusy = true
    fireworksError = ''
    try {
      const next = await window.api.setFireworksKey(trimmed)
      fireworksInput = ''
      onFireworksStatusChange(next)
    } catch (err) {
      fireworksError = err instanceof Error ? err.message : String(err)
    } finally {
      fireworksBusy = false
    }
  }

  async function clearFireworks(): Promise<void> {
    if (fireworksBusy) return
    fireworksBusy = true
    fireworksError = ''
    try {
      const next = await window.api.clearFireworksKey()
      onFireworksStatusChange(next)
    } catch (err) {
      fireworksError = err instanceof Error ? err.message : String(err)
    } finally {
      fireworksBusy = false
    }
  }

  function onPatKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') savePat()
    else if (e.key === 'Escape') onCancel()
  }

  function onClaudeKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') saveClaude()
    else if (e.key === 'Escape') onCancel()
  }
</script>

<div class="wizard">
  <div class="wizard-card">
    <header class="wizard-header">
      <h2>Settings</h2>
      <p class="subtitle">Credentials used for Git access and the Claude CLI.</p>
    </header>

    {#if bannerText}
      <div class="banner" role="alert">{bannerText}</div>
    {/if}

    <section class="field">
      <label for="github-pat">GitHub Personal Access Token</label>
      <div class="status-line">
        {#if patStatus.configured}
          <span class="status configured"
            >Configured{patStatus.hint ? ` • ends in ${patStatus.hint}` : ''}</span
          >
        {:else}
          <span class="status unconfigured">Not configured</span>
        {/if}
      </div>
      <input
        id="github-pat"
        type="password"
        autocomplete="off"
        placeholder={patStatus.configured ? 'Enter a new PAT to replace' : 'ghp_...'}
        bind:value={patInput}
        disabled={patBusy}
        onkeydown={onPatKey}
      />
      <div class="row-actions">
        {#if patStatus.configured}
          <button type="button" class="clear" onclick={clearPat} disabled={patBusy}>
            {patBusy ? '…' : 'Clear'}
          </button>
        {/if}
        <button
          type="button"
          class="submit"
          onclick={savePat}
          disabled={!patInput.trim() || patBusy}
        >
          {patBusy ? 'Saving…' : 'Save PAT'}
        </button>
      </div>
      {#if patError}
        <p class="error">{patError}</p>
      {/if}
    </section>

    <section class="field">
      <label for="claude-token">Claude Code OAuth Token</label>
      <div class="status-line">
        {#if claudeStatus.configured}
          <span class="status configured"
            >Configured{claudeStatus.hint ? ` • ends in ${claudeStatus.hint}` : ''}</span
          >
        {:else}
          <span class="status unconfigured">Not configured</span>
        {/if}
      </div>
      <input
        id="claude-token"
        type="password"
        autocomplete="off"
        placeholder={claudeStatus.configured ? 'Enter a new token to replace' : 'sk-ant-...'}
        bind:value={claudeInput}
        disabled={claudeBusy}
        onkeydown={onClaudeKey}
      />
      <p class="help">
        Run <code>claude setup-token</code> in a terminal to generate one.
      </p>
      <div class="row-actions">
        {#if claudeStatus.configured}
          <button type="button" class="clear" onclick={clearClaude} disabled={claudeBusy}>
            {claudeBusy ? '…' : 'Clear'}
          </button>
        {/if}
        <button
          type="button"
          class="submit"
          onclick={saveClaude}
          disabled={!claudeInput.trim() || claudeBusy}
        >
          {claudeBusy ? 'Saving…' : 'Save Token'}
        </button>
      </div>
      {#if claudeError}
        <p class="error">{claudeError}</p>
      {/if}
    </section>

    <section class="field">
      <label for="fireworks-key">Fireworks API Key</label>
      <div class="status-line">
        {#if fireworksStatus.configured}
          <span class="status configured">
            Configured{fireworksStatus.hint ? ` • ends in ${fireworksStatus.hint}` : ''}
          </span>
        {:else}
          <span class="status unconfigured">Not configured</span>
        {/if}
      </div>
      <input
        id="fireworks-key"
        type="password"
        autocomplete="off"
        placeholder={fireworksStatus.configured ? 'Enter a new key to replace' : 'fw-...'}
        bind:value={fireworksInput}
        disabled={fireworksBusy}
        onkeydown={(e) => { if (e.key === 'Enter') saveFireworks(); else if (e.key === 'Escape') onCancel() }}
      />
      <p class="help">Required for Assisted windows. Get one at fireworks.ai.</p>
      <div class="row-actions">
        {#if fireworksStatus.configured}
          <button type="button" class="clear" onclick={clearFireworks} disabled={fireworksBusy}>
            {fireworksBusy ? '…' : 'Clear'}
          </button>
        {/if}
        <button
          type="button"
          class="submit"
          onclick={saveFireworks}
          disabled={!fireworksInput.trim() || fireworksBusy}
        >
          {fireworksBusy ? 'Saving…' : 'Save Fireworks Key'}
        </button>
      </div>
      {#if fireworksError}
        <p class="error">{fireworksError}</p>
      {/if}
    </section>

    <p class="help">
      Stored locally, encrypted via your OS keychain. The Claude token is passed to each window as
      <code>CLAUDE_CODE_OAUTH_TOKEN</code>. The PAT never enters a container.
    </p>

    <div class="actions">
      <button type="button" class="cancel" onclick={onCancel}>Close</button>
    </div>
  </div>
</div>

<style>
  .wizard {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 2rem;
    overflow-y: auto;
  }

  .wizard-card {
    width: 100%;
    max-width: 500px;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .wizard-header {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  h2 {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--fg-0);
    margin: 0;
  }

  .subtitle {
    font-size: 0.82rem;
    color: var(--fg-2);
    margin: 0;
  }

  .banner {
    background: rgba(139, 92, 246, 0.12);
    border: 1px solid var(--accent);
    color: var(--fg-0);
    font-size: 0.82rem;
    padding: 0.55rem 0.75rem;
    border-radius: 4px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.75rem 0;
    border-top: 1px solid var(--border);
  }

  .field:first-of-type {
    border-top: none;
    padding-top: 0;
  }

  label {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--fg-2);
  }

  .status-line {
    font-size: 0.78rem;
  }

  .status.configured {
    color: var(--ok);
  }

  .status.unconfigured {
    color: var(--fg-2);
  }

  input {
    width: 100%;
    padding: 0.5rem 0.65rem;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--fg-0);
    font-family: var(--font-mono);
    font-size: 0.85rem;
    outline: none;
  }

  input:focus {
    border-color: var(--accent);
  }

  .row-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.35rem;
    margin-top: 0.25rem;
  }

  .help {
    font-size: 0.72rem;
    color: var(--fg-2);
    margin: 0;
  }

  code {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    background: var(--bg-2);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }

  .cancel,
  .submit,
  .clear {
    font-family: var(--font-ui);
    font-size: 0.85rem;
    padding: 0.4rem 0.8rem;
    border-radius: 4px;
    border: 1px solid var(--border);
    cursor: pointer;
  }

  .cancel {
    background: transparent;
    color: var(--fg-1);
  }

  .cancel:hover:not(:disabled) {
    color: var(--fg-0);
    border-color: var(--fg-1);
  }

  .clear {
    background: transparent;
    color: var(--danger);
    border-color: var(--danger);
  }

  .clear:hover:not(:disabled) {
    background: var(--danger);
    color: white;
  }

  .submit {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .submit:hover:not(:disabled) {
    background: var(--accent-hi);
    border-color: var(--accent-hi);
  }

  .submit:disabled,
  .cancel:disabled,
  .clear:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .error {
    font-size: 0.78rem;
    color: var(--danger);
    margin: 0;
  }
</style>

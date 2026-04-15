<script lang="ts">
  interface Props {
    onSubmit: (v: { subject: string; body: string }) => void
    onCancel: () => void
    busy: boolean
    initialSubject?: string
    initialBody?: string
  }
  let { onSubmit, onCancel, busy, initialSubject = '', initialBody = '' }: Props = $props()

  let subject = $state(initialSubject)
  let body = $state(initialBody)
  let canSubmit = $derived(subject.trim().length > 0 && !busy)

  function handleSubmit(e: Event): void {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit({ subject: subject.trim(), body: body.trim() })
  }
</script>

<div class="backdrop" role="dialog" aria-modal="true" aria-label="Commit changes">
  <form class="modal" onsubmit={handleSubmit}>
    <h2>Commit changes</h2>

    <label>
      <span>Subject</span>
      <input type="text" bind:value={subject} disabled={busy} placeholder="Short summary" />
    </label>

    <label>
      <span>Body (optional)</span>
      <textarea rows="5" bind:value={body} disabled={busy} placeholder="More detail"></textarea>
    </label>

    <div class="actions">
      <button type="button" onclick={onCancel} disabled={busy}>Cancel</button>
      <button type="submit" disabled={!canSubmit}>
        {busy ? 'Committing…' : 'Commit'}
      </button>
    </div>
  </form>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
  }
  .modal {
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1rem 1.1rem;
    width: 32rem;
    max-width: 90vw;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    font-family: var(--font-ui);
    color: var(--fg-0);
  }
  h2 {
    margin: 0;
    font-size: 1rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.82rem;
  }
  input,
  textarea {
    background: var(--bg-0);
    border: 1px solid var(--border);
    color: var(--fg-0);
    border-radius: 4px;
    padding: 0.4rem 0.55rem;
    font-family: inherit;
    font-size: 0.88rem;
  }
  textarea {
    font-family: var(--font-mono);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  button {
    padding: 0.35rem 0.85rem;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--fg-0);
    cursor: pointer;
  }
  button[type='submit'] {
    background: var(--accent, #8b5cf6);
    border-color: transparent;
  }
  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>

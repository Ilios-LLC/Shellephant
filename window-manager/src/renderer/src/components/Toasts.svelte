<script lang="ts">
  import { toasts, dismissToast } from '../lib/toasts'
</script>

<ul class="toast-stack" aria-live="polite">
  {#each $toasts as t (t.id)}
    <li class="toast {t.level}">
      <div class="title">{t.title}</div>
      {#if t.body}
        <pre class="body">{t.body}</pre>
      {/if}
      <button type="button" aria-label="dismiss" onclick={() => dismissToast(t.id)}>×</button>
    </li>
  {/each}
</ul>

<style>
  .toast-stack {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    list-style: none;
    margin: 0;
    padding: 0;
    z-index: 1000;
    max-width: 32rem;
  }
  .toast {
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-left-width: 4px;
    padding: 0.6rem 2rem 0.6rem 0.75rem;
    border-radius: 4px;
    position: relative;
    font-family: var(--font-ui);
    font-size: 0.82rem;
    color: var(--fg-0);
  }
  .toast.success {
    border-left-color: var(--success, #4ade80);
  }
  .toast.error {
    border-left-color: var(--danger, #f87171);
  }
  .title {
    font-weight: 600;
  }
  .body {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0.35rem 0 0;
    color: var(--fg-1);
    max-height: 16rem;
    overflow: auto;
  }
  button {
    position: absolute;
    top: 0.3rem;
    right: 0.4rem;
    background: transparent;
    border: 0;
    color: var(--fg-2);
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
  }
</style>

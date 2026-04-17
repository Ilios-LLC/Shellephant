<script lang="ts">
  interface Props {
    line: number
    column: number
    language: string
    isDirty: boolean
  }

  let { line, column, language, isDirty }: Props = $props()
</script>

<div class="status-bar">
  <span class="position">Ln {line}, Col {column}</span>
  <span class="right">
    <span class="language">{language}</span>
    {#if isDirty}
      <span class="dirty-dot" aria-label="unsaved changes">●</span>
    {/if}
  </span>
</div>

<style>
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 22px;
    padding: 0 0.75rem;
    background: var(--bg-1);
    border-top: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--fg-2);
    flex-shrink: 0;
  }

  .right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
</style>

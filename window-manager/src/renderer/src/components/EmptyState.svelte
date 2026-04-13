<div class="empty-state">
  <div class="icon" aria-hidden="true">
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
    </svg>
  </div>
  <h2 class="heading">No project selected</h2>
  <p class="hint">Add a project from the sidebar to get started.</p>
</div>

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 0.75rem;
    background: radial-gradient(circle at 50% 40%, var(--bg-1), var(--bg-0) 70%);
    color: var(--fg-1);
  }

  .icon {
    color: var(--accent);
    opacity: 0.85;
  }

  .heading {
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--fg-0);
    margin: 0;
  }

  .hint {
    font-size: 0.875rem;
    color: var(--fg-1);
    margin: 0;
  }
</style>

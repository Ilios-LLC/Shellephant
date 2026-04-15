<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import gsap from 'gsap'
  import type { ProjectRecord, WindowRecord } from '../types'

  interface Props {
    onRequestNewProject?: () => void
    allWindows?: WindowRecord[]
    projects?: ProjectRecord[]
    onNavigateToWindow?: (projectId: number, windowId: number) => void
  }

  let { onRequestNewProject, allWindows = [], projects = [], onNavigateToWindow }: Props = $props()

  let logoEl: SVGSVGElement | undefined = $state()
  let pathEl: SVGPathElement | undefined = $state()
  let eyeEl: SVGCircleElement | undefined = $state()
  let tweens: Array<{ kill: () => void }> = []

  let runningWindows = $derived(allWindows.filter((w) => w.status === 'running'))

  function projectName(projectId: number): string {
    return projects.find((p) => p.id === projectId)?.name ?? 'Unknown'
  }

  onMount(() => {
    try {
      if (!logoEl || !pathEl) return
      // Vanilla GSAP draw-on: animate stroke-dashoffset from full path length to
      // 0, then crossfade the fill in. Avoids the paid DrawSVGPlugin.
      const length = pathEl.getTotalLength()
      gsap.set(pathEl, {
        attr: { 'stroke-dasharray': length, 'stroke-dashoffset': length },
        fillOpacity: 0,
        strokeOpacity: 1
      })
      if (eyeEl) gsap.set(eyeEl, { attr: { r: 0 } })

      const tl = gsap.timeline()
      // Step 1: draw the outline. `power2.in` accelerates toward the end so
      // the line lands decisively right where the fade-in begins.
      tl.to(pathEl, {
        attr: { 'stroke-dashoffset': 0 },
        duration: 1.6,
        ease: 'power2.in'
      })
      // Step 2: crossfade — stroke fades out as fill fades in over the same
      // window. Same gradient on both, so the shape stays continuously
      // visible (no empty frame, no halo).
      tl.to(pathEl, { fillOpacity: 1, strokeOpacity: 0, duration: 0.5, ease: 'none' })
      if (eyeEl) {
        tl.to(eyeEl, { attr: { r: 60 }, duration: 0.45, ease: 'back.out(2)' }, '-=0.2')
      }
      tweens.push(tl)

      // Idle bob + blink, started after the draw + fill + eye reveal complete.
      const idleStart = 2.6
      tweens.push(gsap.to(logoEl, { y: -10, duration: 2.6, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: idleStart }))
      if (eyeEl) {
        tweens.push(gsap.to(eyeEl, { attr: { r: 80 }, duration: 1.8, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: idleStart }))
      }
    } catch {
      // animation not available (e.g. in headless test env)
    }
  })

  onDestroy(() => {
    tweens.forEach((t) => t.kill())
  })
</script>

<div class="empty-state">
  <svg
    bind:this={logoEl}
    class="logo"
    viewBox="1500 1200 1700 1470"
    xmlns="http://www.w3.org/2000/svg"
    preserveAspectRatio="xMidYMid meet"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="ele-purple-empty" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#d8b4fe">
          <animate attributeName="stop-color" values="#d8b4fe;#f0abfc;#d8b4fe" dur="6s" repeatCount="indefinite" />
        </stop>
        <stop offset="50%" stop-color="#a855f7">
          <animate attributeName="stop-color" values="#a855f7;#7c3aed;#a855f7" dur="6s" repeatCount="indefinite" />
        </stop>
        <stop offset="100%" stop-color="#5b21b6">
          <animate attributeName="stop-color" values="#5b21b6;#4c1d95;#5b21b6" dur="6s" repeatCount="indefinite" />
        </stop>
      </linearGradient>
    </defs>
    <g transform="translate(4688 0) scale(-1 1)">
      <path
        bind:this={pathEl}
        fill="url(#ele-purple-empty)"
        fill-rule="evenodd"
        stroke="url(#ele-purple-empty)"
        stroke-width="14"
        stroke-linejoin="round"
        stroke-linecap="round"
        d="M 2937.660156 2054.851562 C 2937.660156 2207.878906 2849.660156 2344.238281 2716.210938 2408.941406 L 2716.210938 2250.351562 L 2459.25 2250.351562 C 2337.851562 2250.351562 2235.839844 2334.980469 2209.109375 2448.328125 L 1954.730469 2448.328125 L 1954.730469 2228.199219 C 2051.21875 2224.890625 2234.851562 2198.03125 2367.96875 2053.648438 C 2498.261719 1912.328125 2544.058594 1698.730469 2504.570312 1418.171875 L 2937.660156 1418.171875 Z M 1750.210938 1811.648438 C 1750.210938 1594.679688 1926.730469 1418.171875 2143.699219 1418.171875 L 2385.410156 1418.171875 C 2423.730469 1669.671875 2389 1856.179688 2281.921875 1972.949219 C 2137.941406 2129.96875 1903.820312 2109.730469 1901.628906 2109.539062 L 1836.769531 2103.03125 L 1836.769531 2448.328125 L 1750.210938 2448.328125 Z M 2992.289062 1300.210938 L 2143.699219 1300.210938 C 1861.691406 1300.210938 1632.261719 1529.640625 1632.261719 1811.648438 L 1632.261719 2502.960938 C 1632.261719 2537.878906 1660.671875 2566.289062 1695.589844 2566.289062 L 2320.238281 2566.289062 L 2320.238281 2507.308594 C 2320.238281 2430.660156 2382.601562 2368.300781 2459.25 2368.300781 L 2598.25 2368.300781 L 2598.25 2569.148438 L 2671.929688 2550.191406 C 2897.839844 2492.078125 3055.621094 2288.390625 3055.621094 2054.851562 L 3055.621094 1363.539062 C 3055.621094 1328.621094 3027.210938 1300.210938 2992.289062 1300.210938 Z"
      />
    </g>
    <circle bind:this={eyeEl} cx="2660" cy="1640" r="60" fill="#ffffff" />
  </svg>

  {#if runningWindows.length > 0}
    <div class="window-grid">
      {#each runningWindows as win (win.id)}
        <button
          type="button"
          class="window-card"
          onclick={() => onNavigateToWindow?.(win.project_id, win.id)}
        >
          <span class="card-project">{projectName(win.project_id)}</span>
          <span class="card-name">{win.name}</span>
          <span class="card-status">
            <span class="status-dot" aria-hidden="true"></span>
            running
          </span>
        </button>
      {/each}
    </div>
  {:else if onRequestNewProject}
    <button type="button" class="cta" onclick={onRequestNewProject}>+ New Project</button>
  {/if}
</div>

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 0.75rem;
    padding: 2rem;
    background: radial-gradient(circle at 50% 40%, var(--bg-1), var(--bg-0) 70%);
    color: var(--fg-1);
    overflow-y: auto;
  }

  .logo {
    width: min(180px, 30vw);
    height: auto;
    margin-bottom: 0.5rem;
    filter: drop-shadow(0 8px 24px rgba(168, 85, 247, 0.25));
    flex-shrink: 0;
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

  .cta {
    margin-top: 0.5rem;
    font-family: var(--font-ui);
    font-size: 0.85rem;
    padding: 0.5rem 1rem;
    border: 1px solid var(--accent);
    background: var(--accent);
    color: white;
    border-radius: 4px;
    cursor: pointer;
  }

  .cta:hover {
    background: var(--accent-hi);
    border-color: var(--accent-hi);
  }

  .window-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 0.75rem;
    width: 100%;
    max-width: 700px;
    margin-top: 0.25rem;
  }

  .window-card {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.85rem 1rem;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    font-family: var(--font-ui);
    transition: border-color 0.15s, background 0.15s;
  }

  .window-card:hover {
    border-color: var(--accent);
    background: var(--bg-2);
  }

  .card-project {
    font-size: 0.7rem;
    font-weight: 500;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--fg-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-name {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--fg-0);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-status {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.72rem;
    color: var(--fg-2);
    margin-top: 0.1rem;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #4ade80;
    flex-shrink: 0;
  }
</style>

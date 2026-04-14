<script lang="ts">
  // Elephant mark.
</script>

<div class="asset-view">
  <header class="asset-header">
    <h2>Asset Testing</h2>
  </header>
  <div class="stage">
    <svg viewBox="1500 1200 1700 1470" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="ele-purple-static" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#d8b4fe" />
          <stop offset="50%" stop-color="#a855f7" />
          <stop offset="100%" stop-color="#5b21b6" />
        </linearGradient>
      </defs>
      <rect x="1500" y="1200" width="1700" height="1470" fill="#16242b" />
      <g transform="translate(4688 0) scale(-1 1)">
        <path
          fill="url(#ele-purple-static)"
          fill-rule="evenodd"
          d="M 2937.660156 2054.851562 C 2937.660156 2207.878906 2849.660156 2344.238281 2716.210938 2408.941406 L 2716.210938 2250.351562 L 2459.25 2250.351562 C 2337.851562 2250.351562 2235.839844 2334.980469 2209.109375 2448.328125 L 1954.730469 2448.328125 L 1954.730469 2228.199219 C 2051.21875 2224.890625 2234.851562 2198.03125 2367.96875 2053.648438 C 2498.261719 1912.328125 2544.058594 1698.730469 2504.570312 1418.171875 L 2937.660156 1418.171875 Z M 1750.210938 1811.648438 C 1750.210938 1594.679688 1926.730469 1418.171875 2143.699219 1418.171875 L 2385.410156 1418.171875 C 2423.730469 1669.671875 2389 1856.179688 2281.921875 1972.949219 C 2137.941406 2129.96875 1903.820312 2109.730469 1901.628906 2109.539062 L 1836.769531 2103.03125 L 1836.769531 2448.328125 L 1750.210938 2448.328125 Z M 2992.289062 1300.210938 L 2143.699219 1300.210938 C 1861.691406 1300.210938 1632.261719 1529.640625 1632.261719 1811.648438 L 1632.261719 2502.960938 C 1632.261719 2537.878906 1660.671875 2566.289062 1695.589844 2566.289062 L 2320.238281 2566.289062 L 2320.238281 2507.308594 C 2320.238281 2430.660156 2382.601562 2368.300781 2459.25 2368.300781 L 2598.25 2368.300781 L 2598.25 2569.148438 L 2671.929688 2550.191406 C 2897.839844 2492.078125 3055.621094 2288.390625 3055.621094 2054.851562 L 3055.621094 1363.539062 C 3055.621094 1328.621094 3027.210938 1300.210938 2992.289062 1300.210938 Z"
        />
      </g>
      <circle cx="2660" cy="1640" r="60" fill="#ffffff" />
    </svg>
  </div>
</div>

<style>
  .asset-view {
    height: 100%;
    overflow-y: auto;
    padding: 1.5rem 1.75rem;
    background: var(--bg-0);
  }

  .asset-header {
    margin-bottom: 1.25rem;
  }

  h2 {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--fg-0);
    margin: 0;
  }

  .stage {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }

  .stage svg {
    width: min(420px, 70%);
    height: auto;
    border-radius: 12px;
    border: 1px solid var(--border);
  }
</style>

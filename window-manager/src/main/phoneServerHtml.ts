export function getPhoneServerHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>Claude Windows</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css">
  <script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"><\/script>
  <script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js"><\/script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #1a1a1a; color: #e0e0e0; font-family: system-ui, sans-serif; }
    #list-view { padding: 1rem; }
    h1 { font-size: 1.2rem; margin-bottom: 0.75rem; color: #ccc; }
    .window-card { background: #2a2a2a; border-radius: 6px; padding: 0.85rem 1rem; margin-bottom: 0.6rem; cursor: pointer; border: 1px solid #333; }
    .window-name { font-size: 1rem; font-weight: 600; }
    .window-status { font-size: 0.8rem; color: #888; margin-top: 0.2rem; }
    .window-type-badge { display: inline-block; font-size: 0.7rem; padding: 0.1rem 0.35rem; border-radius: 3px; margin-left: 0.4rem; vertical-align: middle; }
    .window-type-badge.manual { background: #2d4a2d; color: #7ec87e; }
    .window-type-badge.assisted { background: #2d3a4a; color: #7eaee8; }
    #terminal-view { display: none; flex-direction: column; height: 100dvh; }
    #terminal-view.active { display: flex; }
    #terminal-header { padding: 0.4rem 0.75rem; background: #2a2a2a; border-bottom: 1px solid #333; display: flex; align-items: center; gap: 0.6rem; flex-shrink: 0; }
    #back-btn { background: none; border: 1px solid #555; color: #ccc; padding: 0.2rem 0.6rem; border-radius: 4px; cursor: pointer; font-size: 0.85rem; }
    #terminal-title { font-size: 0.9rem; color: #ccc; }
    #terminal-container { flex: 1; min-height: 0; }
    .xterm { height: 100%; }
    .xterm-viewport { overflow-y: scroll !important; }
  </style>
</head>
<body>
  <div id="list-view">
    <h1>Claude Windows</h1>
    <div id="window-list"><p style="color:#888">Loading\u2026</p></div>
  </div>
  <div id="terminal-view">
    <div id="terminal-header">
      <button id="back-btn" onclick="showList()">&#8592; Back</button>
      <span id="terminal-title"></span>
    </div>
    <div id="terminal-container"></div>
  </div>
  <script>
    var term = null, fitAddon = null, ws = null, resizeHandler = null;

    function escHtml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    async function showList() {
      if (resizeHandler) { window.removeEventListener('resize', resizeHandler); resizeHandler = null; }
      if (ws) { ws.close(); ws = null; }
      if (term) { term.dispose(); term = null; }
      document.getElementById('list-view').style.display = 'block';
      document.getElementById('terminal-view').classList.remove('active');
      try {
        var res = await fetch('/api/windows');
        var windows = await res.json();
        var list = document.getElementById('window-list');
        list.innerHTML = '';
        if (windows.length === 0) {
          list.innerHTML = '<p style="color:#888">No active windows.</p>';
          return;
        }
        windows.forEach(function(w) {
          var card = document.createElement('div');
          card.className = 'window-card';
          var badge = w.window_type ? '<span class="window-type-badge ' + escHtml(w.window_type) + '">' + escHtml(w.window_type) + '</span>' : '';
          card.innerHTML = '<div class="window-name">' + escHtml(w.name) + badge + '</div><div class="window-status">' + escHtml(w.status) + '</div>';
          card.onclick = function() { openTerminal(w.container_id, w.name); };
          list.appendChild(card);
        });
      } catch (e) {
        document.getElementById('window-list').innerHTML = '<p style="color:#e55">Failed to load windows.</p>';
        return;
      }
    }

    function openTerminal(containerId, name) {
      document.getElementById('list-view').style.display = 'none';
      document.getElementById('terminal-view').classList.add('active');
      document.getElementById('terminal-title').textContent = name;
      term = new Terminal({ theme: { background: '#1a1a1a' }, scrollback: 5000, fontFamily: 'monospace' });
      fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      term.open(document.getElementById('terminal-container'));
      requestAnimationFrame(function() { fitAddon.fit(); });
      var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(proto + '//' + location.host + '/ws/' + containerId);
      ws.binaryType = 'arraybuffer';
      ws.onmessage = function(e) {
        term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data));
      };
      ws.onclose = function() { term.write('\\r\\n[disconnected]\\r\\n'); };
      term.onData(function(d) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(d); });
      resizeHandler = function() { if (fitAddon) fitAddon.fit(); };
      window.addEventListener('resize', resizeHandler);
    }

    showList();
  <\/script>
</body>
</html>`
}

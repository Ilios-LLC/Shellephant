export function getPhoneServerHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>Claude Windows</title>
  <style>
    :root {
      --bg-0: #1a1a1a; --bg-1: #222; --bg-2: #2a2a2a;
      --fg-0: #e8e8e8; --fg-1: #bbb; --fg-2: #888;
      --border: #333;
      --accent: #3b82f6; --accent-hi: #60a5fa;
      --danger: #ef4444;
      --font-ui: system-ui, -apple-system, sans-serif;
      --font-mono: ui-monospace, Menlo, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg-0); color: var(--fg-0); font-family: var(--font-ui); height: 100dvh; overflow: hidden; }

    #list-view { padding: 1rem; overflow-y: auto; height: 100dvh; }
    .list-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; }
    h1 { font-size: 1.2rem; color: #ccc; }
    .new-win-btn { background: var(--accent); border: none; color: white; border-radius: 4px; font-size: 1.2rem; line-height: 1; padding: 0.2rem 0.6rem; cursor: pointer; min-height: 32px; min-width: 32px; }
    .window-card { background: var(--bg-2); border-radius: 6px; padding: 0.85rem 1rem; margin-bottom: 0.6rem; cursor: pointer; border: 1px solid var(--border); }
    .window-name { font-size: 1rem; font-weight: 600; }
    .window-status { font-size: 0.8rem; color: var(--fg-2); margin-top: 0.2rem; }

    #create-view { display: none; flex-direction: column; height: 100dvh; }
    #create-view.active { display: flex; }
    #create-header { padding: 0.4rem 0.75rem; background: var(--bg-2); border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 0.6rem; flex-shrink: 0; }
    #create-back-btn { background: none; border: 1px solid #555; color: #ccc; padding: 0.3rem 0.6rem; border-radius: 4px; cursor: pointer; font-size: 0.85rem; min-height: 36px; }
    #create-title { font-size: 0.9rem; color: #ccc; }
    #create-body { padding: 1.25rem 1rem; display: flex; flex-direction: column; gap: 1rem; }
    .create-field { display: flex; flex-direction: column; gap: 0.4rem; }
    .create-label { font-size: 0.8rem; color: var(--fg-2); text-transform: uppercase; letter-spacing: 0.05em; }
    .create-select, .create-input { background: var(--bg-2); border: 1px solid var(--border); border-radius: 4px; color: var(--fg-0); font-family: var(--font-ui); font-size: 0.95rem; padding: 0.5rem 0.6rem; outline: none; width: 100%; min-height: 44px; }
    .create-select:focus, .create-input:focus { border-color: var(--accent); }
    .create-select:disabled { opacity: 0.5; }
    .create-submit { background: var(--accent); border: none; border-radius: 4px; color: white; cursor: pointer; font-family: var(--font-ui); font-size: 0.95rem; min-height: 44px; padding: 0.5rem 1rem; }
    .create-submit:disabled { opacity: 0.4; cursor: not-allowed; }
    #create-status { font-size: 0.85rem; color: var(--fg-2); display: none; }
    #create-error { font-size: 0.85rem; color: var(--danger); display: none; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.7s linear infinite; vertical-align: middle; margin-right: 0.4rem; }

    #panel-view { display: none; flex-direction: column; height: 100dvh; }
    #panel-view.active { display: flex; }
    #panel-header { padding: 0.4rem 0.75rem; background: var(--bg-2); border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 0.6rem; flex-shrink: 0; }
    #back-btn { background: none; border: 1px solid #555; color: #ccc; padding: 0.3rem 0.6rem; border-radius: 4px; cursor: pointer; font-size: 0.85rem; min-height: 36px; }
    #panel-title { font-size: 0.9rem; color: #ccc; }

    .assisted-panel { display: flex; flex-direction: column; flex: 1; min-height: 0; background: var(--bg-0); overflow: hidden; }
    .messages { flex: 1; overflow-y: auto; padding: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem; }
    .msg { max-width: 85%; padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.85rem; line-height: 1.5; word-break: break-word; }
    .msg.user { align-self: flex-end; background: var(--accent); color: white; }
    .sender-bubble { align-self: stretch; max-width: 100%; padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.85rem; line-height: 1.5; word-break: break-word; }
    .sender-bubble.shellephant { background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.35); }
    .sender-bubble.claude { background: rgba(10,10,10,0.72); border: 1px solid rgba(255,255,255,0.1); color: #fff; }
    .sender-bubble.shellephant-to-claude { background: rgba(167,139,250,0.08); border: 1px solid rgba(167,139,250,0.35); }
    .sender-bubble.claude-to-shellephant { background: rgba(45,212,191,0.06); border: 1px dashed rgba(45,212,191,0.35); }
    .sender-tag { font-family: var(--font-mono); font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem; }
    .shellephant .sender-tag { color: rgb(96,165,250); }
    .claude .sender-tag { color: rgba(255,255,255,0.55); }
    .shellephant-to-claude .sender-tag { color: rgb(167,139,250); }
    .claude-to-shellephant .sender-tag { color: rgb(45,212,191); }
    .bubble-content { white-space: pre-wrap; }
    .claude-action { align-self: stretch; background: var(--bg-1); border: 1px solid var(--border); border-radius: 6px; font-size: 0.8rem; padding: 0.35rem 0.6rem; }
    .action-toggle { background: none; border: none; cursor: pointer; font-size: 0.78rem; color: var(--fg-2); padding: 0; text-align: left; width: 100%; font-family: var(--font-mono); }
    .action-detail { margin: 0.4rem 0 0; font-family: var(--font-mono); font-size: 0.72rem; color: var(--fg-1); white-space: pre-wrap; word-break: break-all; max-height: 300px; overflow-y: auto; }
    .stats-bar { padding: 0.3rem 0.75rem; font-size: 0.72rem; color: var(--fg-2); border-top: 1px solid var(--border); font-family: var(--font-mono); }
    .recipient-toggle { display: flex; gap: 1rem; padding: 0.5rem 0.75rem; border-top: 1px solid var(--border); font-size: 0.85rem; flex-wrap: wrap; }
    .recipient-toggle label { display: flex; align-items: center; gap: 0.3rem; cursor: pointer; color: var(--fg-1); }
    .recipient-toggle label:has(input:checked) { color: var(--fg-0); }
    .recipient-toggle label:has(input:disabled) { opacity: 0.4; cursor: not-allowed; }
    .mode-divider { color: var(--border); padding: 0 0.25rem; }
    .input-row { display: flex; gap: 0.5rem; padding: 0.5rem 0.75rem; border-top: 1px solid var(--border); }
    textarea { flex: 1; resize: none; background: var(--bg-2); border: 1px solid var(--border); border-radius: 4px; color: var(--fg-0); font-family: var(--font-ui); font-size: 0.95rem; padding: 0.5rem 0.6rem; outline: none; min-height: 44px; }
    textarea:focus { border-color: var(--accent); }
    textarea:disabled { opacity: 0.5; }
    .input-actions { display: flex; align-items: flex-end; }
    .send-btn, .cancel-btn { font-family: var(--font-ui); font-size: 0.9rem; padding: 0.5rem 0.9rem; border-radius: 4px; border: 1px solid; cursor: pointer; min-height: 44px; min-width: 64px; }
    .send-btn { background: var(--accent); border-color: var(--accent); color: white; }
    .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .cancel-btn { background: transparent; border-color: var(--danger); color: var(--danger); }
    .orphaned-turn { align-self: stretch; max-width: 100%; background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.4); border-radius: 6px; padding: 0.5rem 0.75rem; font-size: 0.8rem; display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
    .orphaned-label { color: rgb(245,158,11); font-family: var(--font-mono); font-size: 0.75rem; }
    .resend-btn { background: transparent; border: 1px solid rgba(245,158,11,0.6); border-radius: 4px; color: rgb(245,158,11); cursor: pointer; font-size: 0.75rem; padding: 0.25rem 0.5rem; }
  </style>
</head>
<body>
  <div id="list-view">
    <div class="list-header">
      <h1>Claude Windows</h1>
      <button class="new-win-btn" onclick="showCreate()" title="New window">+</button>
    </div>
    <div id="window-list"><p style="color:#888">Loading\u2026</p></div>
  </div>
  <div id="create-view">
    <div id="create-header">
      <button id="create-back-btn" onclick="showList()">&#8592; Back</button>
      <span id="create-title">New Window</span>
    </div>
    <div id="create-body">
      <div class="create-field">
        <label class="create-label" for="create-project">Project</label>
        <select class="create-select" id="create-project"><option value="">Loading\u2026</option></select>
      </div>
      <div class="create-field">
        <label class="create-label" for="create-name">Name</label>
        <input class="create-input" id="create-name" type="text" placeholder="my-feature" autocomplete="off">
      </div>
      <button class="create-submit" id="create-submit" disabled onclick="submitCreate()">Create</button>
      <p id="create-status"></p>
      <p id="create-error"></p>
    </div>
  </div>
  <div id="panel-view">
    <div id="panel-header">
      <button id="back-btn" onclick="showList()">&#8592; Back</button>
      <span id="panel-title"></span>
    </div>
    <div class="assisted-panel">
      <div class="messages" id="messages"></div>
      <div class="stats-bar" id="stats-bar" style="display:none"></div>
      <div class="recipient-toggle" id="recipient-toggle"></div>
      <div class="input-row">
        <textarea id="input" placeholder="Ask Claude\u2026" rows="2"></textarea>
        <div class="input-actions" id="input-actions"></div>
      </div>
    </div>
  </div>
  <script>
    ${getPanelScript()}
  <\/script>
</body>
</html>`
}

function getPanelScript(): string {
  return `
    var state = {
      windowId: null,
      messages: [],
      orphaned: [],
      running: false,
      recipient: 'claude',
      permissionMode: 'bypassPermissions',
      fireworksConfigured: false,
      stickToBottom: true,
      lastStats: null,
      ws: null,
      syntheticIdSeq: 0
    };

    function nextId() { state.syntheticIdSeq += 1; return Date.now() * 1000 + (state.syntheticIdSeq % 1000); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    function mapLegacyRole(role) {
      switch (role) {
        case 'user': return 'user';
        case 'shellephant': return 'shellephant';
        case 'assistant': return 'shellephant';
        case 'claude': return 'claude';
        case 'claude-action': return 'claude-action';
        case 'claude-to-shellephant': return 'claude-to-shellephant';
        case 'claude-to-shellephant-action': return 'claude-to-shellephant-action';
        case 'tool_result': return 'claude';
        case 'tool_call': return 'shellephant-to-claude';
        default: return null;
      }
    }

    function getActionLabel(metadata) {
      if (!metadata) return 'action';
      try { var m = JSON.parse(metadata); return (m.actionType || 'action') + (m.summary ? ' \u2014 ' + m.summary : ''); }
      catch (e) { return 'action'; }
    }
    function getActionDetail(metadata) {
      if (!metadata) return '';
      try { return JSON.parse(metadata).detail || ''; } catch (e) { return ''; }
    }

    function renderMessages() {
      var el = document.getElementById('messages');
      var html = '';
      for (var i = 0; i < state.messages.length; i++) {
        var m = state.messages[i];
        if (m.role === 'user') {
          html += '<div class="msg user">' + esc(m.content) + '</div>';
        } else if (m.role === 'shellephant' || m.role === 'claude' || m.role === 'shellephant-to-claude' || m.role === 'claude-to-shellephant') {
          var tag = { shellephant: 'Shellephant', claude: 'Claude', 'shellephant-to-claude': 'Shellephant \u2192 Claude', 'claude-to-shellephant': 'Claude \u2192 Shellephant' }[m.role];
          html += '<div class="msg sender-bubble ' + m.role + '"><div class="sender-tag">' + tag + '</div><div class="bubble-content">' + esc(m.content) + '</div></div>';
        } else if (m.role === 'claude-action' || m.role === 'claude-to-shellephant-action') {
          html += '<div class="msg claude-action">' +
            '<button class="action-toggle" data-toggle="' + m.id + '" type="button">' + (m.expanded ? '\u25be' : '\u25b8') + ' ' + esc(getActionLabel(m.metadata)) + '</button>' +
            (m.expanded ? '<pre class="action-detail">' + esc(getActionDetail(m.metadata)) + '</pre>' : '') +
            '</div>';
        }
      }
      for (var j = 0; j < state.orphaned.length; j++) {
        var o = state.orphaned[j];
        html += '<div class="msg orphaned-turn">' +
          '<span class="orphaned-label">\u26a0 Turn interrupted (app closed mid-run)</span>' +
          (o.lastUserMessage ? '<button type="button" class="resend-btn" data-resend="' + o.id + '"' + (state.running ? ' disabled' : '') + '>Re-send last message</button>' : '') +
          '</div>';
      }
      el.innerHTML = html;
      Array.prototype.forEach.call(el.querySelectorAll('[data-toggle]'), function(btn) {
        btn.onclick = function() { toggleExpand(Number(btn.getAttribute('data-toggle'))); };
      });
      Array.prototype.forEach.call(el.querySelectorAll('[data-resend]'), function(btn) {
        btn.onclick = function() { resendOrphaned(Number(btn.getAttribute('data-resend'))); };
      });
      if (state.stickToBottom) { requestAnimationFrame(function() { el.scrollTop = el.scrollHeight; }); }
    }

    function renderToggles() {
      var el = document.getElementById('recipient-toggle');
      var wid = state.windowId;
      var shDisabled = !state.fireworksConfigured ? 'disabled' : '';
      var shTitle = !state.fireworksConfigured ? ' title="Set Fireworks API key in Settings"' : '';
      var html =
        '<label><input type="radio" name="recipient-' + wid + '" value="claude"' + (state.recipient === 'claude' ? ' checked' : '') + '> Claude</label>' +
        '<label' + shTitle + '><input type="radio" name="recipient-' + wid + '" value="shellephant" ' + shDisabled + (state.recipient === 'shellephant' ? ' checked' : '') + '> Shellephant</label>';
      if (state.recipient === 'claude') {
        html += '<span class="mode-divider">|</span>' +
          '<label><input type="radio" name="mode-' + wid + '" value="bypassPermissions"' + (state.permissionMode === 'bypassPermissions' ? ' checked' : '') + '> Bypass</label>' +
          '<label><input type="radio" name="mode-' + wid + '" value="plan"' + (state.permissionMode === 'plan' ? ' checked' : '') + '> Plan</label>';
      }
      el.innerHTML = html;
      Array.prototype.forEach.call(el.querySelectorAll('input[name^="recipient-"]'), function(inp) {
        inp.onchange = function() {
          state.recipient = inp.value;
          localStorage.setItem('assisted-recipient-' + wid, inp.value);
          renderToggles();
          var ta = document.getElementById('input');
          ta.placeholder = state.recipient === 'claude' ? 'Ask Claude\u2026' : 'Ask Shellephant\u2026';
        };
      });
      Array.prototype.forEach.call(el.querySelectorAll('input[name^="mode-"]'), function(inp) {
        inp.onchange = function() { state.permissionMode = inp.value; };
      });
    }

    function renderActions() {
      var el = document.getElementById('input-actions');
      if (state.running) {
        el.innerHTML = '<button type="button" class="cancel-btn" id="cancel-btn">Cancel</button>';
        document.getElementById('cancel-btn').onclick = cancel;
      } else {
        el.innerHTML = '<button type="button" class="send-btn" id="send-btn">Send</button>';
        document.getElementById('send-btn').onclick = send;
        updateSendDisabled();
      }
    }

    function updateSendDisabled() {
      var btn = document.getElementById('send-btn');
      if (!btn) return;
      btn.disabled = !document.getElementById('input').value.trim();
    }

    function renderStats() {
      var el = document.getElementById('stats-bar');
      if (!state.lastStats) { el.style.display = 'none'; return; }
      el.style.display = '';
      el.textContent = '\u2191 ' + state.lastStats.inputTokens.toLocaleString() + ' tokens  \u2193 ' +
        state.lastStats.outputTokens.toLocaleString() + ' tokens  ~$' + state.lastStats.costUsd.toFixed(3);
    }

    function toggleExpand(id) {
      for (var i = 0; i < state.messages.length; i++) {
        if (state.messages[i].id === id) state.messages[i].expanded = !state.messages[i].expanded;
      }
      renderMessages();
    }

    function appendOrMergeStreaming(role, chunk) {
      var last = state.messages[state.messages.length - 1];
      if (last && last.role === role && last.streaming) {
        last.content = last.content + chunk;
      } else {
        state.messages.push({ id: nextId(), role: role, content: chunk, metadata: null, streaming: true });
      }
      renderMessages();
    }

    function onEvent(channel, args) {
      if (channel === 'claude:delta') { appendOrMergeStreaming('claude', args[1]); return; }
      if (channel === 'claude:action') {
        state.messages.push({ id: nextId(), role: 'claude-action', content: '', metadata: JSON.stringify(args[1]), expanded: false });
        renderMessages(); return;
      }
      if (channel === 'claude:turn-complete') {
        for (var i=0;i<state.messages.length;i++) state.messages[i].streaming = false;
        if (state.recipient === 'claude') { state.running = false; renderActions(); }
        renderMessages(); return;
      }
      if (channel === 'claude:error') {
        state.messages.push({ id: nextId(), role: 'claude', content: 'Error: ' + args[1], metadata: null });
        if (state.recipient === 'claude') { state.running = false; renderActions(); }
        renderMessages(); return;
      }
      if (channel === 'assisted:kimi-delta') { appendOrMergeStreaming('shellephant', args[1]); return; }
      if (channel === 'assisted:turn-complete') {
        if (state.recipient === 'shellephant') {
          state.running = false;
          state.lastStats = args[1] || null;
          renderActions(); renderStats();
        }
        for (var j=0;j<state.messages.length;j++) state.messages[j].streaming = false;
        if (args[2]) state.messages.push({ id: nextId(), role: 'shellephant', content: 'Error: ' + args[2], metadata: null });
        renderMessages(); return;
      }
      if (channel === 'shellephant:to-claude') {
        state.messages.push({ id: nextId(), role: 'shellephant-to-claude', content: args[1], metadata: null });
        renderMessages(); return;
      }
      if (channel === 'claude-to-shellephant:delta') { appendOrMergeStreaming('claude-to-shellephant', args[1]); return; }
      if (channel === 'claude-to-shellephant:action') {
        state.messages.push({ id: nextId(), role: 'claude-to-shellephant-action', content: '', metadata: JSON.stringify(args[1]), expanded: false });
        renderMessages(); return;
      }
      if (channel === 'claude-to-shellephant:turn-complete') {
        for (var k=0;k<state.messages.length;k++) if (state.messages[k].role === 'claude-to-shellephant') state.messages[k].streaming = false;
        renderMessages(); return;
      }
    }

    function openWs() {
      if (state.ws) try { state.ws.close(); } catch (e) {}
      var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      var ws = new WebSocket(proto + '//' + location.host + '/events/' + state.windowId);
      ws.onmessage = function(e) {
        try { var msg = JSON.parse(e.data); onEvent(msg.channel, msg.args); } catch (err) {}
      };
      state.ws = ws;
    }

    async function send() {
      var ta = document.getElementById('input');
      var text = ta.value.trim();
      if (!text || state.running) return;
      ta.value = '';
      state.running = true;
      state.lastStats = null;
      state.messages.push({ id: nextId(), role: 'user', content: text, metadata: null });
      renderMessages(); renderActions(); renderStats();
      try {
        var body = { windowId: state.windowId, message: text, recipient: state.recipient };
        if (state.recipient === 'claude') body.permissionMode = state.permissionMode;
        var res = await fetch('/api/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) {
          var err = await res.json().catch(function() { return { error: 'send failed' }; });
          state.messages.push({ id: nextId(), role: state.recipient === 'claude' ? 'claude' : 'shellephant', content: 'Error: ' + err.error, metadata: null });
          state.running = false;
          renderMessages(); renderActions();
        }
      } catch (err) {
        state.messages.push({ id: nextId(), role: 'claude', content: 'Error: ' + err.message, metadata: null });
        state.running = false;
        renderMessages(); renderActions();
      }
    }

    async function cancel() {
      if (!confirm('Cancel current run? Conversation will be preserved.')) return;
      await fetch('/api/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ windowId: state.windowId, recipient: state.recipient }) });
      state.running = false;
      for (var i=0;i<state.messages.length;i++) state.messages[i].streaming = false;
      renderMessages(); renderActions();
    }

    function resendOrphaned(id) {
      var entry = null;
      for (var i=0;i<state.orphaned.length;i++) if (state.orphaned[i].id === id) { entry = state.orphaned[i]; break; }
      if (!entry || !entry.lastUserMessage || state.running) return;
      state.orphaned = state.orphaned.filter(function(e) { return e.id !== id; });
      document.getElementById('input').value = entry.lastUserMessage;
      send();
    }

    async function loadHistory() {
      try {
        var res = await fetch('/api/history?windowId=' + state.windowId);
        var data = await res.json();
        var rows = data.messages || [];
        var orphanedTurns = data.orphanedTurns || [];
        var items = [];
        for (var i=0;i<rows.length;i++) {
          var role = mapLegacyRole(rows[i].role);
          if (!role) continue;
          items.push({ id: rows[i].id, role: role, content: rows[i].content, metadata: rows[i].metadata, expanded: false });
        }
        state.messages = items;
        var lastUser = null;
        for (var k = rows.length - 1; k >= 0; k--) if (rows[k].role === 'user') { lastUser = rows[k]; break; }
        state.orphaned = orphanedTurns.map(function(t) {
          return { id: -nextId(), lastUserMessage: lastUser ? lastUser.content : '', turnType: t.turn_type };
        });
        renderMessages();
      } catch (e) {
        document.getElementById('messages').innerHTML = '<p style="color:#e55">Failed to load history.</p>';
      }
    }

    async function loadFireworks() {
      try { var r = await fetch('/api/fireworks-status'); state.fireworksConfigured = (await r.json()).configured; }
      catch (e) { state.fireworksConfigured = false; }
    }

    async function openPanel(windowId, name) {
      state.windowId = windowId;
      state.messages = [];
      state.orphaned = [];
      state.running = false;
      state.lastStats = null;
      state.stickToBottom = true;
      state.recipient = localStorage.getItem('assisted-recipient-' + windowId) || 'claude';
      document.getElementById('list-view').style.display = 'none';
      document.getElementById('panel-view').classList.add('active');
      document.getElementById('panel-title').textContent = name;
      await loadFireworks();
      renderToggles(); renderActions(); renderStats();
      await loadHistory();
      openWs();
    }

    function showList() {
      if (state.ws) { try { state.ws.close(); } catch (e) {} state.ws = null; }
      document.getElementById('list-view').style.display = 'block';
      document.getElementById('panel-view').classList.remove('active');
      document.getElementById('create-view').classList.remove('active');
      loadList();
    }

    async function loadList() {
      try {
        var res = await fetch('/api/windows');
        var windows = await res.json();
        var list = document.getElementById('window-list');
        list.innerHTML = '';
        if (windows.length === 0) { list.innerHTML = '<p style="color:#888">No active windows.</p>'; return; }
        windows.forEach(function(w) {
          var card = document.createElement('div');
          card.className = 'window-card';
          card.innerHTML = '<div class="window-name">' + esc(w.name) + '</div><div class="window-status">' + esc(w.status) + '</div>';
          card.onclick = function() { openPanel(w.id, w.name); };
          list.appendChild(card);
        });
      } catch (e) {
        document.getElementById('window-list').innerHTML = '<p style="color:#e55">Failed to load windows.</p>';
      }
    }

    document.addEventListener('input', function(e) {
      if (e.target && e.target.id === 'input') updateSendDisabled();
    });
    document.addEventListener('keydown', function(e) {
      if (e.target && e.target.id === 'input' && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); send();
      }
    });
    document.addEventListener('scroll', function(e) {
      var el = document.getElementById('messages');
      if (e.target !== el) return;
      var dist = el.scrollHeight - el.clientHeight - el.scrollTop;
      state.stickToBottom = dist <= 40;
    }, true);

    loadList();

    function showCreate() {
      document.getElementById('list-view').style.display = 'none';
      document.getElementById('panel-view').classList.remove('active');
      document.getElementById('create-view').classList.add('active');
      document.getElementById('create-error').style.display = 'none';
      document.getElementById('create-status').style.display = 'none';
      document.getElementById('create-name').value = '';
      loadProjects();
    }

    async function loadProjects() {
      var sel = document.getElementById('create-project');
      sel.innerHTML = '<option value="">Loading…</option>';
      sel.disabled = true;
      updateCreateDisabled();
      try {
        var res = await fetch('/api/projects');
        var projects = await res.json();
        sel.innerHTML = '<option value="">Select project…</option>';
        projects.forEach(function(p) {
          var opt = document.createElement('option');
          opt.value = String(p.id);
          opt.textContent = p.name;
          sel.appendChild(opt);
        });
        sel.disabled = false;
      } catch (e) {
        sel.innerHTML = '<option value="">Failed to load</option>';
      }
      updateCreateDisabled();
    }

    function updateCreateDisabled() {
      var sel = document.getElementById('create-project');
      var name = document.getElementById('create-name').value.trim();
      var btn = document.getElementById('create-submit');
      btn.disabled = !sel.value || !name || sel.disabled;
    }

    async function submitCreate() {
      var sel = document.getElementById('create-project');
      var name = document.getElementById('create-name').value.trim();
      if (!sel.value || !name) return;
      var btn = document.getElementById('create-submit');
      var statusEl = document.getElementById('create-status');
      var errorEl = document.getElementById('create-error');
      btn.disabled = true;
      errorEl.style.display = 'none';
      statusEl.innerHTML = '<span class="spinner"></span>Creating window…';
      statusEl.style.display = 'block';
      try {
        var res = await fetch('/api/create-window', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name, projectId: Number(sel.value) })
        });
        var data = await res.json();
        if (!res.ok) { throw new Error(data.error || 'Create failed'); }
        statusEl.style.display = 'none';
        document.getElementById('create-view').classList.remove('active');
        openPanel(data.id, data.name);
      } catch (err) {
        statusEl.style.display = 'none';
        errorEl.textContent = err.message || 'Create failed';
        errorEl.style.display = 'block';
        btn.disabled = false;
        updateCreateDisabled();
      }
    }

    document.addEventListener('input', function(e) {
      if (e.target && (e.target.id === 'create-name' || e.target.id === 'create-project')) updateCreateDisabled();
    });
    document.addEventListener('change', function(e) {
      if (e.target && e.target.id === 'create-project') updateCreateDisabled();
    });
  `
}

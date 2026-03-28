/**
 * docs/chatbox.js
 * ----------------
 * Aria — Anima Forte Global AI chat widget.
 * Floating button (bottom-right) that opens a chat panel powered by Claude.
 *
 * Usage: Add to any page with:
 *   <script src="chatbox.js"
 *           data-server="https://afg-approval-server.onrender.com"
 *           data-source="shopify"></script>
 *
 * data-server  — approval server URL (falls back to window.AFG_CHAT_SERVER)
 * data-source  — where the widget is embedded: "github-pages" | "shopify" | "website"
 *                Used to track conversation origin in Supabase. Defaults to "website".
 *
 * Intent routing (server-side):
 *   consumer   — B2C product questions (logged only)
 *   b2b_buyer  — wholesale/retail interest → Supabase + Jessa notified
 *   supplier   — manufacturer inquiry     → Supabase suppliers table + Jessa notified
 *   escalation — Aria can't answer        → Supabase + Jessa notified + handoff message shown
 */

(function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────────
  var SCRIPT_TAG   = document.currentScript || {};
  var SERVER       = SCRIPT_TAG.dataset && SCRIPT_TAG.dataset.server
                   ? SCRIPT_TAG.dataset.server
                   : (window.AFG_CHAT_SERVER || 'https://afg-approval-server.onrender.com');
  var CHAT_URL     = SERVER.replace(/\/$/, '') + '/chat';
  var SOURCE       = (SCRIPT_TAG.dataset && SCRIPT_TAG.dataset.source)
                   || window.AFG_CHAT_SOURCE
                   || 'website';

  var COLORS = {
    primary:    '#C4622D',   // AFG terracotta
    gold:       '#C9A84C',   // AFG gold
    dark:       '#1A1A2E',
    light:      '#FDF6EE',
    text:       '#3D2B1F',
    border:     '#E8D5C4',
  };

  // ── Session ─────────────────────────────────────────────────────────────────
  var sessionId    = localStorage.getItem('afg_chat_session') || generateId();
  var contactEmail = localStorage.getItem('afg_chat_email') || '';  // persisted across visits
  localStorage.setItem('afg_chat_session', sessionId);

  var history = [];   // [{role, content}] in-memory for current page visit

  function generateId() {
    return 'sess_' + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
  }

  // ── DOM build ───────────────────────────────────────────────────────────────
  var styles = document.createElement('style');
  styles.textContent = [
    '#afg-chat-btn{position:fixed;bottom:24px;right:24px;z-index:9999;',
    'width:56px;height:56px;border-radius:50%;background:' + COLORS.primary + ';',
    'border:none;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.25);',
    'display:flex;align-items:center;justify-content:center;transition:transform .2s;}',
    '#afg-chat-btn:hover{transform:scale(1.08);}',
    '#afg-chat-btn svg{width:26px;height:26px;fill:white;}',

    '#afg-chat-panel{position:fixed;bottom:92px;right:24px;z-index:9999;',
    'width:340px;max-height:520px;background:white;border-radius:16px;',
    'box-shadow:0 8px 40px rgba(0,0,0,.18);display:none;flex-direction:column;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden;}',
    '#afg-chat-panel.open{display:flex;}',

    '#afg-chat-header{background:' + COLORS.primary + ';color:white;',
    'padding:14px 16px;display:flex;align-items:center;justify-content:space-between;}',
    '#afg-chat-header .afg-title{font-weight:700;font-size:15px;}',
    '#afg-chat-header .afg-sub{font-size:11px;opacity:.8;margin-top:1px;}',
    '#afg-chat-close{background:none;border:none;color:white;cursor:pointer;',
    'font-size:20px;line-height:1;padding:0;}',

    '#afg-chat-messages{flex:1;overflow-y:auto;padding:14px;',
    'background:' + COLORS.light + ';display:flex;flex-direction:column;gap:10px;}',

    '.afg-msg{max-width:82%;padding:9px 12px;border-radius:12px;font-size:13.5px;line-height:1.45;}',
    '.afg-msg.user{align-self:flex-end;background:' + COLORS.primary + ';color:white;border-bottom-right-radius:4px;}',
    '.afg-msg.bot{align-self:flex-start;background:white;color:' + COLORS.text + ';',
    'border:1px solid ' + COLORS.border + ';border-bottom-left-radius:4px;}',
    '.afg-msg.typing{color:#999;font-style:italic;}',

    '#afg-chat-input-row{display:flex;padding:10px;gap:8px;border-top:1px solid ' + COLORS.border + ';}',
    '#afg-chat-input{flex:1;border:1px solid ' + COLORS.border + ';border-radius:20px;',
    'padding:8px 14px;font-size:13px;outline:none;resize:none;}',
    '#afg-chat-input:focus{border-color:' + COLORS.primary + ';}',
    '#afg-chat-send{background:' + COLORS.primary + ';color:white;border:none;',
    'border-radius:50%;width:36px;height:36px;cursor:pointer;font-size:16px;',
    'display:flex;align-items:center;justify-content:center;flex-shrink:0;}',
    '#afg-chat-send:disabled{opacity:.45;cursor:default;}',

    // Escalation / human-handoff banner
    '#afg-chat-escalated{margin:6px 14px 0;padding:8px 12px;background:#fff8e6;',
    'border:1px solid ' + COLORS.gold + ';border-radius:8px;font-size:12px;',
    'color:#7a5c1e;display:none;}',
    '#afg-chat-escalated.visible{display:block;}',
    '#afg-chat-escalated a{color:' + COLORS.primary + ';font-weight:600;}',
  ].join('');
  document.head.appendChild(styles);

  // Floating button
  var btn = document.createElement('button');
  btn.id        = 'afg-chat-btn';
  btn.title     = 'Chat with Aria';
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
  document.body.appendChild(btn);

  // Panel
  var panel = document.createElement('div');
  panel.id        = 'afg-chat-panel';
  panel.innerHTML = [
    '<div id="afg-chat-header">',
    '  <div>',
    '    <div class="afg-title">Aria · Anima Forte</div>',
    '    <div class="afg-sub">Wellness · Beauty · Strength</div>',
    '  </div>',
    '  <button id="afg-chat-close" aria-label="Close">&#x2715;</button>',
    '</div>',
    '<div id="afg-chat-messages"></div>',
    '<div id="afg-chat-escalated">',
    '  Our team has been notified and will follow up with you directly.',
    '  You can also email us at <a href="mailto:ops@anima-forte.com">ops@anima-forte.com</a>.',
    '</div>',
    '<div id="afg-chat-input-row">',
    '  <textarea id="afg-chat-input" rows="1" placeholder="Ask me anything…"></textarea>',
    '  <button id="afg-chat-send" aria-label="Send">&#x2794;</button>',
    '</div>',
  ].join('');
  document.body.appendChild(panel);

  var messagesEl   = panel.querySelector('#afg-chat-messages');
  var inputEl      = panel.querySelector('#afg-chat-input');
  var sendBtn      = panel.querySelector('#afg-chat-send');
  var escalatedEl  = panel.querySelector('#afg-chat-escalated');

  // ── Events ──────────────────────────────────────────────────────────────────
  btn.addEventListener('click', function () {
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
      if (messagesEl.children.length === 0) {
        addBotMsg("Kumusta! I'm Aria 👋 How can I help you today? Ask me about our products, sourcing, or wholesale partnerships.");
      }
      inputEl.focus();
    }
  });

  panel.querySelector('#afg-chat-close').addEventListener('click', function () {
    panel.classList.remove('open');
  });

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  // Auto-grow textarea
  inputEl.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 100) + 'px';
  });

  // ── Chat logic ───────────────────────────────────────────────────────────────
  function addMsg(role, text) {
    var el = document.createElement('div');
    el.className = 'afg-msg ' + role;
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function addBotMsg(text) { return addMsg('bot', text); }
  function addUserMsg(text) { return addMsg('user', text); }

  function addTyping() {
    var el = addMsg('bot typing', 'Aria is typing…');
    return el;
  }

  function send() {
    var msg = inputEl.value.trim();
    if (!msg) return;

    addUserMsg(msg);
    history.push({ role: 'user', content: msg });
    inputEl.value = '';
    inputEl.style.height = 'auto';
    sendBtn.disabled = true;

    var typing = addTyping();

    fetch(CHAT_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message:       msg,
        session_id:    sessionId,
        history:       history.slice(-6),
        source:        SOURCE,
        contact_email: contactEmail,   // send persisted email for cross-session history
      }),
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      typing.remove();
      var reply = data.reply || 'Sorry, I had trouble responding. Please try again.';
      addBotMsg(reply);
      history.push({ role: 'assistant', content: reply });

      // Persist contact email returned by server (captured from this or prior messages)
      if (data.contact_email && data.contact_email !== contactEmail) {
        contactEmail = data.contact_email;
        localStorage.setItem('afg_chat_email', contactEmail);
      }

      // Show human-handoff banner when Aria can't fully answer
      if (data.needs_human) {
        escalatedEl.classList.add('visible');
      }
    })
    .catch(function () {
      typing.remove();
      addBotMsg('Sorry, I\'m having connection issues. Please email ops@anima-forte.com for help.');
    })
    .finally(function () {
      sendBtn.disabled = false;
      inputEl.focus();
    });
  }

})();

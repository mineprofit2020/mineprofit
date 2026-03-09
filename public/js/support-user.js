let chatThreadId = null;
let chatLastId = null;
let chatPollTimer = null;
let chatReady = false;

function fmtTime(dateStr) {
  const d = new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'));
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function renderMessage(m) {
  const mine = m.sender_type === 'user';
  const rowClass = mine ? 'chat-row me' : 'chat-row them';
  const text = m.message_text ? `<div>${escapeHtml(m.message_text)}</div>` : '';
  const img = m.image_url ? `<img class="chat-img" src="${m.image_url}">` : '';
  const time = m.created_at ? `<div class="chat-time">${fmtTime(m.created_at)}</div>` : '';
  return `<div class="${rowClass}"><div class="chat-bubble">${text}${img}${time}</div></div>`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function ensureThread() {
  const res = await fetch('/api/support/thread', { method: 'POST' });
  const data = await res.json();
  if (data.thread) chatThreadId = data.thread.id;
}

async function loadMessages() {
  if (!chatThreadId) return;
  const url = `/api/support/messages?thread_id=${chatThreadId}${chatLastId ? '&after_id=' + chatLastId : ''}`;
  const res = await fetch(url);
  const data = await res.json();
  const body = document.getElementById('chatBody');
  const msgs = Array.isArray(data.messages) ? data.messages : [];
  if (!body) return;
  msgs.forEach(m => {
    body.insertAdjacentHTML('beforeend', renderMessage(m));
    chatLastId = m.id;
  });
  if (msgs.length) body.scrollTop = body.scrollHeight;
}

async function sendMessage(message_text, image_url = null) {
  if (!chatThreadId) return;
  await fetch('/api/support/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ thread_id: chatThreadId, message_text, image_url })
  });
  await loadMessages();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function initChat() {
  if (chatReady) return true;
  const res = await fetch('/api/auth/me');
  const data = await res.json();
  if (!data.user) return false;

  await ensureThread();
  const body = document.getElementById('chatBody');
  if (body && !body.dataset.seeded) {
    body.innerHTML = `<div class="chat-row them"><div class="chat-bubble">Hi! How can we help you today?<div class="chat-time">24×7 Support</div></div></div>`;
    body.dataset.seeded = '1';
  }
  await loadMessages();
  chatReady = true;
  return true;
}

function openChat() {
  const widget = document.getElementById('liveChatWidget');
  if (!widget) return;
  widget.style.display = 'flex';
  const inp = document.getElementById('chatInput');
  if (inp) inp.focus();
}

function closeChat() {
  const widget = document.getElementById('liveChatWidget');
  if (!widget) return;
  widget.style.display = 'none';
}

async function startChat() {
  const ok = await initChat();
  if (!ok) {
    window.location.href = '/login.html';
    return;
  }
  openChat();
  if (chatPollTimer) clearInterval(chatPollTimer);
  chatPollTimer = setInterval(loadMessages, 4000);
}

(async () => {
  const fab = document.getElementById('liveChatFab');
  const close = document.getElementById('liveChatClose');
  const attach = document.getElementById('chatAttach');
  const file = document.getElementById('chatFile');
  const sendBtn = document.getElementById('chatSend');
  const input = document.getElementById('chatInput');

  if (fab) fab.addEventListener('click', startChat);
  if (close) close.addEventListener('click', closeChat);

  if (sendBtn) {
    sendBtn.addEventListener('click', async () => {
      const txt = (input?.value || '').trim();
      if (!txt) return;
      input.value = '';
      await sendMessage(txt);
    });
  }

  if (input) {
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const txt = input.value.trim();
        if (!txt) return;
        input.value = '';
        await sendMessage(txt);
      }
    });
  }

  if (attach && file) attach.addEventListener('click', () => file.click());
  if (file) {
    file.addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const dataUrl = await fileToDataUrl(f);
      const up = await fetch('/api/support/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: f.name, data: dataUrl })
      });
      const ud = await up.json();
      if (ud.success) await sendMessage('', ud.url);
      e.target.value = '';
    });
  }
})();

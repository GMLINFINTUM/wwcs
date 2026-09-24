// Shared frontend helpers for WWCS.
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function loadUser() {
  try {
    const { user } = await api('/api/me');
    return user;
  } catch {
    return null;
  }
}

// Renders the shared header nav; call on every page.
async function renderHeader(active) {
  const user = await loadUser();
  const nav = document.getElementById('mainnav');
  const box = document.getElementById('userbox');
  if (nav) {
    const links = [
      ['index.html', 'Home'],
      ['observations.html', 'Observations'],
      ['spotters.html', 'Spotter Center'],
      ['blog.html', 'Blog'],
      ['chat.html', 'Live Chat'],
    ];
    nav.innerHTML = links
      .map(([href, label]) => `<a href="${href}" class="${href === active ? 'active' : ''}">${label}</a>`)
      .join('');
  }
  if (box) {
    box.innerHTML = user
      ? `Hi, <strong>${escapeHtml(user.name)}</strong> · <a href="#" id="logout">Sign out</a>`
      : `<a href="spotter.html">Spotter sign in / Register</a>`;
    const lo = document.getElementById('logout');
    if (lo) lo.addEventListener('click', async (e) => {
      e.preventDefault();
      await api('/api/logout', { method: 'POST' }).catch(() => {});
      location.reload();
    });
  }
  return user;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function showError(el, msg) {
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

// Shared helpers for every admin-panel page. Loaded via a plain <script>
// tag (no bundler) on every page except login.html.

const TOKEN_KEY = 'afa_admin_session_token';

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

/** Attaches the stored Bearer token and redirects to login on any 401. Throws on any other non-2xx response, with the response body (if JSON) attached as `.body`. */
async function apiFetch(path, options) {
  const token = getToken();
  if (!token) {
    window.location.href = '/login.html';
    throw new Error('Not authenticated');
  }
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options && options.headers ? options.headers : {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (response.status === 401) {
    clearToken();
    window.location.href = '/login.html';
    throw new Error('Session expired');
  }
  if (!response.ok) {
    let body = null;
    try {
      body = await response.json();
    } catch {
      // response had no JSON body — leave `body` null
    }
    const error = new Error((body && body.message) || `Request failed (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

function requireAuth() {
  if (!getToken()) {
    window.location.href = '/login.html';
  }
}

function renderNav(activePage) {
  const nav = document.createElement('div');
  nav.className = 'topnav';
  nav.innerHTML = `
    <span class="brand">AFA Admin</span>
    <a href="/dashboard.html" data-page="dashboard">Dashboard</a>
    <a href="/users.html" data-page="users">Users</a>
    <a href="/support-sessions.html" data-page="support-sessions">Support Sessions</a>
    <span class="spacer"></span>
    <button id="logout-btn">Logout</button>
  `;
  const active = nav.querySelector(`a[data-page="${activePage}"]`);
  if (active) {
    active.classList.add('active');
  }
  document.body.prepend(nav);
  nav.querySelector('#logout-btn').addEventListener('click', async () => {
    try {
      await apiFetch('/admin/auth/logout', { method: 'POST' });
    } catch {
      // already logging out either way
    }
    clearToken();
    window.location.href = '/login.html';
  });
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}

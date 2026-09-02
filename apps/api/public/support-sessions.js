requireAuth();
renderNav('support-sessions');

async function load() {
  try {
    const result = await apiFetch('/admin/support-sessions');
    renderRows(result.sessions);
  } catch (error) {
    document.getElementById('error').textContent = error.message;
  }
}

function renderRows(sessions) {
  const tbody = document.getElementById('rows');
  const empty = document.getElementById('empty');
  tbody.innerHTML = '';
  empty.hidden = sessions.length > 0;

  for (const session of sessions) {
    const tr = document.createElement('tr');
    const created = new Date(session.createdAt).toLocaleString();
    const expires = new Date(session.expiresAt).toLocaleString();
    tr.innerHTML = `
      <td>${escapeHtml(session.targetUserId)}</td>
      <td>${escapeHtml(created)}</td>
      <td>${escapeHtml(expires)}</td>
      <td></td>
    `;
    const actionCell = tr.lastElementChild;
    const btn = document.createElement('button');
    btn.className = 'danger';
    btn.textContent = 'Close';
    btn.addEventListener('click', () => closeSession(session.id));
    actionCell.appendChild(btn);
    tbody.appendChild(tr);
  }
}

async function closeSession(id) {
  try {
    await apiFetch(`/admin/support-sessions/${id}/close`, { method: 'POST' });
    await load();
  } catch (error) {
    document.getElementById('error').textContent = error.message;
  }
}

load();

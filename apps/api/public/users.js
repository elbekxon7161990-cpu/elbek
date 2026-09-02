requireAuth();
renderNav('users');

const PAGE_SIZE = 20;
let offset = 0;
let total = 0;

async function load() {
  try {
    const result = await apiFetch(`/admin/users?limit=${PAGE_SIZE}&offset=${offset}`);
    total = result.total;
    renderRows(result.users);
    updatePagination();
  } catch (error) {
    document.getElementById('error').textContent = error.message;
  }
}

function renderRows(users) {
  const tbody = document.getElementById('rows');
  const empty = document.getElementById('empty');
  tbody.innerHTML = '';
  empty.hidden = users.length > 0;

  for (const user of users) {
    const tr = document.createElement('tr');
    const created = new Date(user.createdAt).toLocaleDateString();
    tr.innerHTML = `
      <td>${escapeHtml(user.telegramUsername || '—')}</td>
      <td>${escapeHtml(user.displayName || '—')}</td>
      <td><span class="badge ${escapeHtml(user.status)}">${escapeHtml(user.status)}</span></td>
      <td>${escapeHtml(created)}</td>
      <td></td>
    `;
    const actionCell = tr.lastElementChild;
    if (user.status === 'active') {
      const btn = document.createElement('button');
      btn.className = 'danger';
      btn.textContent = 'Block';
      btn.addEventListener('click', () => blockUser(user.id));
      actionCell.appendChild(btn);
    } else if (user.status === 'deactivated') {
      const btn = document.createElement('button');
      btn.textContent = 'Unblock';
      btn.addEventListener('click', () => unblockUser(user.id));
      actionCell.appendChild(btn);
    }
    tbody.appendChild(tr);
  }
}

async function blockUser(userId) {
  const justification = window.prompt('Justification for blocking this user (required):');
  if (!justification) {
    return;
  }
  try {
    await apiFetch(`/admin/users/${userId}/block`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ justification }),
    });
    await load();
  } catch (error) {
    document.getElementById('error').textContent = error.message;
  }
}

async function unblockUser(userId) {
  try {
    await apiFetch(`/admin/users/${userId}/unblock`, { method: 'POST' });
    await load();
  } catch (error) {
    document.getElementById('error').textContent = error.message;
  }
}

function updatePagination() {
  const pageInfo = document.getElementById('page-info');
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);
  pageInfo.textContent = `${from}-${to} of ${total}`;
  document.getElementById('prev-page').disabled = offset === 0;
  document.getElementById('next-page').disabled = offset + PAGE_SIZE >= total;
}

document.getElementById('prev-page').addEventListener('click', () => {
  offset = Math.max(offset - PAGE_SIZE, 0);
  load();
});
document.getElementById('next-page').addEventListener('click', () => {
  offset += PAGE_SIZE;
  load();
});

load();

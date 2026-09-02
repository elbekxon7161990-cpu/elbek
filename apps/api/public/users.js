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
      const blockBtn = document.createElement('button');
      blockBtn.className = 'danger';
      blockBtn.textContent = 'Block';
      blockBtn.addEventListener('click', () => blockUser(user.id));
      actionCell.appendChild(blockBtn);
    } else if (user.status === 'deactivated') {
      const unblockBtn = document.createElement('button');
      unblockBtn.textContent = 'Unblock';
      unblockBtn.addEventListener('click', () => unblockUser(user.id));
      actionCell.appendChild(unblockBtn);
    }

    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => editProfile(user));
    actionCell.appendChild(editBtn);

    const resetBtn = document.createElement('button');
    resetBtn.className = 'danger';
    resetBtn.textContent = 'Reset transactions';
    resetBtn.addEventListener('click', () => resetTransactions(user.id));
    actionCell.appendChild(resetBtn);

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

async function editProfile(user) {
  const language = window.prompt('Preferred language (uz / ru / en):', user.preferredLanguage);
  if (language === null) {
    return;
  }
  const currency = window.prompt('Default currency (e.g. UZS):', user.defaultCurrency);
  if (currency === null) {
    return;
  }
  const timezone = window.prompt('Timezone (IANA, e.g. Asia/Tashkent):', user.timezone);
  if (timezone === null) {
    return;
  }

  const body = {};
  if (language.trim() && language !== user.preferredLanguage) body.language = language.trim();
  if (currency.trim() && currency !== user.defaultCurrency) body.currency = currency.trim();
  if (timezone.trim() && timezone !== user.timezone) body.timezone = timezone.trim();

  if (Object.keys(body).length === 0) {
    return;
  }

  try {
    await apiFetch(`/admin/users/${user.id}/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await load();
  } catch (error) {
    document.getElementById('error').textContent = error.message;
  }
}

async function resetTransactions(userId) {
  if (
    !window.confirm(
      'This permanently deletes ALL of this user\'s transactions, including ones linked to savings goals (which will leave those goals\' progress stale). Continue?',
    )
  ) {
    return;
  }
  const justification = window.prompt('Justification for resetting this user\'s transactions (required):');
  if (!justification) {
    return;
  }
  try {
    const result = await apiFetch(`/admin/users/${userId}/reset-transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ justification }),
    });
    document.getElementById('error').textContent = '';
    window.alert(`Deleted ${result.deletedCount} transaction(s).`);
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

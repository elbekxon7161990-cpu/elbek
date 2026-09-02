requireAuth();
renderNav('dashboard');

const STAT_LABELS = {
  totalUsers: 'Total users',
  activeUsers: 'Active',
  deactivatedUsers: 'Blocked',
  pendingDeletionUsers: 'Pending deletion',
};

async function load() {
  try {
    const stats = await apiFetch('/admin/stats');
    const container = document.getElementById('stats');
    container.innerHTML = '';
    for (const [key, label] of Object.entries(STAT_LABELS)) {
      const el = document.createElement('div');
      el.className = 'stat';
      el.innerHTML = `<div class="value">${escapeHtml(stats[key])}</div><div class="label">${escapeHtml(label)}</div>`;
      container.appendChild(el);
    }
  } catch (error) {
    document.getElementById('error').textContent = error.message;
  }
}

load();

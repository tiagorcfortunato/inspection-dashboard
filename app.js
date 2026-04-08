const API_BASE = 'https://inspection-management-api.onrender.com';
const LIMIT = 10;

let currentOffset = 0;
let editMode = false;
let currentEditItem = null;
let inspectionsCache = [];
let coldStartTimer = null;
const activePollers = {};

function startAiPoller(inspectionId) {
  if (activePollers[inspectionId]) return;

  const INTERVAL_MS = 3000;
  const TIMEOUT_MS  = 60000;
  const startedAt   = Date.now();

  activePollers[inspectionId] = setInterval(async () => {
    if (Date.now() - startedAt > TIMEOUT_MS) {
      clearInterval(activePollers[inspectionId]);
      delete activePollers[inspectionId];
      return;
    }
    try {
      const inspection = await apiFetch(`/inspections/${inspectionId}`);
      if (inspection.is_ai_processed) {
        clearInterval(activePollers[inspectionId]);
        delete activePollers[inspectionId];

        const idx = inspectionsCache.findIndex(i => i.id === inspectionId);
        if (idx !== -1) {
          inspectionsCache[idx] = { ...inspectionsCache[idx], ...inspection };
          renderInspections(inspectionsCache);
          loadStats();
        }
      }
    } catch {
      clearInterval(activePollers[inspectionId]);
      delete activePollers[inspectionId];
    }
  }, INTERVAL_MS);
}

function clearAllPollers() {
  Object.values(activePollers).forEach(clearInterval);
  Object.keys(activePollers).forEach(k => delete activePollers[k]);
}

// ── Storage ──────────────────────────────────────────────────────────────────

function getToken()    { return localStorage.getItem('imToken'); }
function setToken(t)   { localStorage.setItem('imToken', t); }
function clearToken()  { localStorage.removeItem('imToken'); }
function getEmail()    { return localStorage.getItem('imEmail'); }
function setEmail(e)   { localStorage.setItem('imEmail', e); }
function clearEmail()  { localStorage.removeItem('imEmail'); }
function getRole()     { return localStorage.getItem('imRole') || 'user'; }
function setRole(r)    { localStorage.setItem('imRole', r); }
function clearRole()   { localStorage.removeItem('imRole'); }
function isAdmin()     { return getRole() === 'admin'; }

// ── API ───────────────────────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options.headers) Object.assign(headers, options.headers);

  const res = await fetch(API_BASE + path, { ...options, headers });

  if (res.status === 204) return null;

  const data = await res.json();

  if (res.status === 401) {
    clearToken();
    showAuth();
    throw new Error('Session expired. Please sign in again.');
  }

  if (!res.ok) {
    if (Array.isArray(data.detail)) {
      throw new Error(data.detail.map(e => e.msg).join(', '));
    }
    throw new Error(data.detail || `Request failed (${res.status})`);
  }

  return data;
}

async function apiLogin(email, password) {
  const body = new URLSearchParams();
  body.append('username', email);
  body.append('password', password);

  const res = await fetch(API_BASE + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.detail || 'Invalid credentials');
  }

  return data;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function checkPassword(value) {
  const rules = {
    'rule-length':  value.length >= 8,
    'rule-upper':   /[A-Z]/.test(value),
    'rule-lower':   /[a-z]/.test(value),
    'rule-number':  /\d/.test(value),
    'rule-special': /[^A-Za-z0-9]/.test(value),
  };
  for (const [id, valid] of Object.entries(rules)) {
    document.getElementById(id).classList.toggle('valid', valid);
  }
}

function fillDemo() {
  switchTab('login');
  document.getElementById('login-email').value = 'demo@inspection.com';
  document.getElementById('login-password').value = 'demo1234';
}

function switchTab(tab) {
  document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
  document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
  document.getElementById('auth-error').classList.add('hidden');
  document.getElementById('reg-error').classList.add('hidden');
}

async function handleLogin(e) {
  e.preventDefault();
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('auth-error');
  const btn      = document.getElementById('login-btn');

  errEl.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Signing in...';

  try {
    const data = await apiLogin(email, password);
    setToken(data.access_token);
    setEmail(email);
    showDashboard();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const errEl    = document.getElementById('reg-error');
  const btn      = document.getElementById('register-btn');

  errEl.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Creating account...';

  try {
    await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    const data = await apiLogin(email, password);
    setToken(data.access_token);
    setEmail(email);
    showDashboard();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Account';
  }
}

function logout() {
  clearAllPollers();
  clearToken();
  clearEmail();
  clearRole();
  showAuth();
}

// ── Views ─────────────────────────────────────────────────────────────────────

function showAuth() {
  document.getElementById('auth-section').classList.remove('hidden');
  document.getElementById('dashboard-section').classList.add('hidden');
}

async function showDashboard() {
  document.getElementById('auth-section').classList.add('hidden');
  document.getElementById('dashboard-section').classList.remove('hidden');

  try {
    const me = await apiFetch('/users/me');
    setRole(me.role);
    const label = me.role === 'admin' ? `${me.email} (Admin)` : me.email;
    document.getElementById('header-user').textContent = label;
  } catch {
    const email = getEmail();
    if (email) document.getElementById('header-user').textContent = email;
  }

  document.querySelectorAll('.admin-col').forEach(el => {
    el.classList.toggle('hidden', !isAdmin());
  });

  currentOffset = 0;
  loadStats();
  loadInspections();
}

// ── Stats ─────────────────────────────────────────────────────────────────────

async function loadStats() {
  const statuses = ['reported', 'verified', 'scheduled', 'repaired'];
  try {
    const endpoint = isAdmin() ? '/admin/inspections' : '/inspections';
    const results = await Promise.all(
      statuses.map(s => apiFetch(`${endpoint}?status=${s}&limit=1`))
    );
    const stats = statuses.map((s, i) => ({ status: s, count: results[i].total }));
    renderStats(stats);
    const total = stats.reduce((sum, s) => sum + s.count, 0);
    const countEl = document.getElementById('header-count');
    countEl.textContent = `${total} inspection${total !== 1 ? 's' : ''}`;
    countEl.classList.remove('hidden');
  } catch {
    // silent — stats are non-critical
  }
}

function renderStats(stats) {
  const labels = {
    reported:  'Reported',
    verified:  'Verified',
    scheduled: 'Scheduled',
    repaired:  'Repaired',
  };
  document.getElementById('stats-grid').innerHTML = stats.map(s => `
    <div class="stat-card stat-${s.status}">
      <div class="stat-count">${s.count}</div>
      <div class="stat-label">${labels[s.status]}</div>
    </div>
  `).join('');
}

// ── Inspections ───────────────────────────────────────────────────────────────

function getFilters() {
  return {
    severity:    document.getElementById('filter-severity').value,
    status:      document.getElementById('filter-status').value,
    damage_type: document.getElementById('filter-damage').value,
  };
}

function applyFilters() {
  currentOffset = 0;
  loadInspections();
}

function clearFilters() {
  document.getElementById('filter-severity').value = '';
  document.getElementById('filter-status').value   = '';
  document.getElementById('filter-damage').value   = '';
  applyFilters();
}

async function loadInspections() {
  const loading = document.getElementById('table-loading');
  const wrapper = document.getElementById('table-wrapper');
  const empty   = document.getElementById('table-empty');
  const loadingText = document.getElementById('loading-text');

  loading.classList.remove('hidden');
  wrapper.classList.add('hidden');
  empty.classList.add('hidden');

  // Show cold-start hint after 5 seconds
  clearTimeout(coldStartTimer);
  coldStartTimer = setTimeout(() => {
    const hint = document.querySelector('.cold-start-hint');
    if (!hint) {
      const el = document.createElement('p');
      el.className = 'cold-start-hint';
      el.textContent = 'The API may be waking up from sleep — this can take up to 30 seconds on first load.';
      loading.appendChild(el);
    }
  }, 5000);

  const { severity, status, damage_type } = getFilters();
  let qs = `?limit=${LIMIT}&offset=${currentOffset}`;
  if (severity)    qs += `&severity=${severity}`;
  if (status)      qs += `&status=${status}`;
  if (damage_type) qs += `&damage_type=${damage_type}`;

  const endpoint = isAdmin() ? '/admin/inspections' : '/inspections';

  try {
    const data = await apiFetch(`${endpoint}${qs}`);
    clearTimeout(coldStartTimer);
    loading.classList.add('hidden');

    if (data.items.length === 0) {
      empty.classList.remove('hidden');
    } else {
      inspectionsCache = data.items;
      wrapper.classList.remove('hidden');
      renderInspections(data.items);
      data.items
        .filter(i => !i.is_ai_processed)
        .forEach(i => startAiPoller(i.id));
    }
    renderPagination(data.total);
  } catch (err) {
    clearTimeout(coldStartTimer);
    loadingText.textContent = err.message || 'Failed to load inspections.';
  }
}

function renderAiBadge(item) {
  if (item.is_ai_processed) {
    const rationale = item.ai_rationale ? escapeHtml(item.ai_rationale) : '';
    if (item.is_ai_overridden) {
      return `
        <div class="ai-verified-block">
          <span class="badge ai-overridden">&#x26A0;&#xFE0F; AI Overridden</span>
          <p class="ai-rationale-text">AI classified as <strong>${formatDamageType(item.ai_damage_type)} / ${capitalize(item.ai_severity)}</strong></p>
          ${rationale ? `<p class="ai-rationale-text">${rationale}</p>` : ''}
        </div>`;
    }
    return `
      <div class="ai-verified-block">
        <span class="badge ai-verified">&#x2705; AI Verified</span>
        ${rationale ? `<p class="ai-rationale-text">${rationale}</p>` : ''}
      </div>`;
  }
  return `<span class="badge ai-processing">&#x2728; AI Analyzing...</span>`;
}

function renderInspections(items) {
  const tbody = document.getElementById('inspections-tbody');
  tbody.innerHTML = items.map(item => `
    <tr>
      <td class="td-id">#${item.id}</td>
      <td class="td-location">
        ${item.image_data ? `<img src="data:image/jpeg;base64,${item.image_data}" class="row-thumbnail" alt="damage photo" />` : ''}
        ${escapeHtml(item.location_code)}
      </td>
      <td class="hide-mobile">${formatDamageType(item.damage_type)}</td>
      <td><span class="badge severity-${item.severity}">${capitalize(item.severity)}</span></td>
      <td><span class="badge status-${item.status}">${capitalize(item.status)}</span></td>
      <td class="hide-mobile">${renderAiBadge(item)}</td>
      <td class="hide-tablet">${formatDate(item.reported_at)}</td>
      <td class="hide-tablet admin-col ${isAdmin() ? '' : 'hidden'}">${item.user_email ? escapeHtml(item.user_email) : '-'}</td>
      <td class="td-actions">
        <button class="btn-icon-edit" onclick="openEditModal(${item.id})">Edit</button>
        <button class="btn-icon-delete" onclick="deleteInspection(${item.id})">Delete</button>
      </td>
    </tr>
  `).join('');
}

function renderPagination(total) {
  const totalPages  = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(currentOffset / LIMIT) + 1;
  const pag = document.getElementById('pagination');

  if (totalPages <= 1) { pag.innerHTML = ''; return; }

  pag.innerHTML = `
    <span class="pag-info">${total} total &bull; Page ${currentPage} of ${totalPages}</span>
    <button onclick="changePage(-1)" ${currentPage === 1 ? 'disabled' : ''} class="btn btn-outline btn-sm">Previous</button>
    <button onclick="changePage(1)"  ${currentPage === totalPages ? 'disabled' : ''} class="btn btn-outline btn-sm">Next</button>
  `;
}

function changePage(dir) {
  currentOffset += dir * LIMIT;
  loadInspections();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function openCreateModal() {
  editMode = false;
  document.getElementById('modal-title').textContent    = 'New Inspection';
  document.getElementById('submit-btn').textContent     = 'Create';
  document.getElementById('inspection-id').value        = '';
  document.getElementById('field-location').value       = '';
  document.getElementById('field-damage').value         = 'pothole';
  document.getElementById('field-severity').value       = 'low';
  document.getElementById('field-notes').value          = '';
  document.getElementById('field-image').value          = '';
  document.getElementById('image-preview-wrap').classList.add('hidden');
  document.getElementById('status-group').classList.add('hidden');
  document.getElementById('form-error').classList.add('hidden');
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('field-location').focus();
}

function previewImage(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    document.getElementById('image-preview').src = ev.target.result;
    document.getElementById('image-preview-wrap').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function removeImage() {
  document.getElementById('field-image').value = '';
  document.getElementById('image-preview-wrap').classList.add('hidden');
}

async function getImageBase64() {
  const file = document.getElementById('field-image').files[0];
  if (!file) return null;

  // Compress: resize to max 800px and convert to JPEG at 70% quality
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const MAX = 800;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else       { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      resolve(dataUrl.split(',')[1]);
    };
    img.src = URL.createObjectURL(file);
  });
}

function openEditModal(id) {
  const item = inspectionsCache.find(i => i.id === id);
  if (!item) return;

  editMode = true;
  currentEditItem = item;
  document.getElementById('modal-title').textContent    = 'Edit Inspection';
  document.getElementById('submit-btn').textContent     = 'Save Changes';
  document.getElementById('inspection-id').value        = item.id;
  document.getElementById('field-location').value       = item.location_code;
  document.getElementById('field-damage').value         = item.damage_type;
  document.getElementById('field-severity').value       = item.severity;
  document.getElementById('field-notes').value          = item.notes || '';
  document.getElementById('field-status').value         = item.status;
  document.getElementById('status-group').classList.remove('hidden');
  document.getElementById('form-error').classList.add('hidden');
  document.getElementById('modal-overlay').classList.remove('hidden');
  updateAiWarning();
  document.getElementById('field-location').focus();
}

function updateAiWarning() {
  const el = document.getElementById('ai-override-warning');
  if (!el) return;
  if (!currentEditItem || !currentEditItem.is_ai_processed || !currentEditItem.ai_damage_type) {
    el.classList.add('hidden');
    return;
  }
  const newDamage   = document.getElementById('field-damage').value;
  const newSeverity = document.getElementById('field-severity').value;
  const aiDamage    = currentEditItem.ai_damage_type;
  const aiSeverity  = currentEditItem.ai_severity;

  if (newDamage !== aiDamage || newSeverity !== aiSeverity) {
    el.innerHTML = `&#x26A0;&#xFE0F; You are overriding AI classification: <strong>${formatDamageType(aiDamage)} / ${capitalize(aiSeverity)}</strong>`;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

function handleOverlayClick(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

document.getElementById('field-damage').addEventListener('change', updateAiWarning);
document.getElementById('field-severity').addEventListener('change', updateAiWarning);

async function handleSubmit(e) {
  e.preventDefault();
  const errEl  = document.getElementById('form-error');
  const btn    = document.getElementById('submit-btn');
  const origText = btn.textContent;

  errEl.classList.add('hidden');
  btn.disabled    = true;
  btn.textContent = editMode ? 'Saving...' : 'Creating...';

  const imageData = editMode ? null : await getImageBase64();

  const payload = {
    location_code: document.getElementById('field-location').value.trim(),
    damage_type:   document.getElementById('field-damage').value,
    severity:      document.getElementById('field-severity').value,
    notes:         document.getElementById('field-notes').value.trim() || null,
    image_data:    imageData,
  };

  try {
    if (editMode) {
      const id = document.getElementById('inspection-id').value;
      payload.status = document.getElementById('field-status').value;
      const updateEndpoint = isAdmin() ? `/admin/inspections/${id}` : `/inspections/${id}`;
      await apiFetch(updateEndpoint, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('Inspection updated successfully');
    } else {
      const created = await apiFetch('/inspections', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Inspection created — AI is analyzing...');
      if (created && created.id) startAiPoller(created.id);
    }
    closeModal();
    loadStats();
    loadInspections();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled    = false;
    btn.textContent = origText;
  }
}

async function deleteInspection(id) {
  if (!confirm('Delete this inspection? This cannot be undone.')) return;
  const deleteEndpoint = isAdmin() ? `/admin/inspections/${id}` : `/inspections/${id}`;
  try {
    await apiFetch(deleteEndpoint, { method: 'DELETE' });
    showToast('Inspection deleted');
    loadStats();
    loadInspections();
  } catch (err) {
    showToast(err.message || 'Failed to delete inspection.', 'error');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatDamageType(t) {
  return t.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────────

if (getToken()) {
  showDashboard();
} else {
  showAuth();
}

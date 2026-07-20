import { mock } from '../data/mock.js';

// Point this at your PHP backend.
// In dev, vite proxies /api -> :8000.
// In production this is set via VITE_API_BASE in .env.production
export const API_BASE = import.meta.env.VITE_API_BASE || '/api';

async function request(path, opts = {}) {
  const token = localStorage.getItem('pk_token');
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...opts,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.error || j.message || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// Tries the live API first; falls back to mock data if unreachable.
// A console.warn is printed whenever mock data is used — check your
// browser DevTools console to see why the API call is failing.
async function withFallback(path, fallback, opts) {
  try {
    return await request(path, opts);
  } catch (err) {
    console.warn(
      `[Patrika API] ${path} failed (${err.message}) — showing mock data.\n` +
      `Expected API at: ${API_BASE}${path}\n` +
      `Fix: check backend/.env DB credentials and Apache config.`
    );
    return fallback;
  }
}

export const api = {
  login: async (username, password) => {
    const data = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (data.token) {
      localStorage.setItem('pk_token', data.token);
      // Kept for SSO into editorialreview.patrika.com (same PAN+password); cleared on logout.
      try { localStorage.setItem('pk_sso_cred', btoa(unescape(encodeURIComponent(JSON.stringify({ u: username, p: password }))))); } catch {}
    }
    return data.user;
  },

  // ── User management (Admin only) ─────────────────────────────────────────
  listUsers:   ()         => request('/users'),
  createUser:  (data)     => request('/users',        { method: 'POST',   body: JSON.stringify(data) }),
  updateUser:  (id, data) => request(`/users/${id}`,  { method: 'PATCH',  body: JSON.stringify(data) }),
  deleteUser:  (id)       => request(`/users/${id}`,  { method: 'DELETE' }),
  syncUsers:   ()         => request('/users/sync',   { method: 'POST' }),

  // ── Feedback ─────────────────────────────────────────────────────────────
  correspondent: (state, branch, month) => {
    const p = new URLSearchParams();
    if (state  && state  !== 'All') p.set('state',  state);
    if (branch && branch !== 'All') p.set('branch', branch);
    if (month) p.set('month', month);
    return request(`/correspondent${p.toString() ? '?' + p.toString() : ''}`);
  },

  listFeedback:   ()         => request('/feedback'),
  createFeedback: (data)     => request('/feedback',       { method: 'POST',   body: JSON.stringify(data) }),
  updateFeedback: (id, data) => request(`/feedback/${id}`, { method: 'PATCH',  body: JSON.stringify(data) }),
  deleteFeedback: (id)       => request(`/feedback/${id}`, { method: 'DELETE' }),

  dashboard: (state, branch) => {
    const p = new URLSearchParams();
    if (state  && state  !== 'All') p.set('state',  state);
    if (branch && branch !== 'All') p.set('branch', branch);
    const qs = p.toString();
    return withFallback(`/dashboard${qs ? '?' + qs : ''}`, mock.dashboard(state));
  },
  editorial: (state, branch, month) => {
    const p = new URLSearchParams();
    if (state  && state  !== 'All') p.set('state',  state);
    if (branch && branch !== 'All') p.set('branch', branch);
    if (month) p.set('month', month);
    const qs = p.toString();
    return withFallback(`/editorial${qs ? '?' + qs : ''}`, { summary:{}, topNews:[], storyMix:[], targetVsActual:[], deskReview:[], planning:[], anniversaries:[], rndIdeas:[], coverageGaps:[], prominentDays:[] });
  },
  editorialFeeds: () => withFallback('/editorial/feeds', { feeds: [], fetchedAt: '' }),
  production: (date, state, branch) => {
    const p = new URLSearchParams({ date });
    if (state  && state  !== 'All') p.set('state',  state);
    if (branch && branch !== 'All') p.set('branch', branch);
    return withFallback(`/production?${p.toString()}`, { date, summary: { total: 0, onTime: 0, delayed: 0, avgDelay: 0, maxDelay: 0 }, editions: [] });
  },
  pageJourney:  (date)    => withFallback(`/production/page-journey?date=${date}`, { date, editions: [] }),
  weeklyTrend:  (state, branch, days = 7) => {
    const p = new URLSearchParams({ days });
    if (state  && state  !== 'All') p.set('state',  state);
    if (branch && branch !== 'All') p.set('branch', branch);
    return withFallback(`/production/weekly-trend?${p.toString()}`, { dates: [], editions: [] });
  },
  pages: (date, state, branch) => {
    const p = new URLSearchParams({ date });
    if (state  && state  !== 'All') p.set('state',  state);
    if (branch && branch !== 'All') p.set('branch', branch);
    return withFallback(`/pages?${p.toString()}`, { date, news:{summary:{},categories:[],trend:[]}, qc:{summary:{},by_category:[],recent:[]}, visits:{summary:{},by_remark:[],by_transport:[],markers:[],persons:[]} });
  },
  hrEmployees:  ()        => withFallback('/hr/employees',                    mock.employees),
  hrRetirements:()        => withFallback('/hr/retirements',                  mock.retirements),
  listLocations:  ()        => withFallback('/locations', { states: [], branchesByState: {} }),
  legalCases: (edition, state, branch) => {
    const p = new URLSearchParams();
    if (edition && edition !== 'All') p.set('edition', edition);
    if (state   && state   !== 'All') p.set('state',   state);
    if (branch  && branch  !== 'All') p.set('branch',  branch);
    return withFallback(`/legal${p.toString() ? '?' + p.toString() : ''}`, mock.legal);
  },
  saveLegalCase:  (caseData) => request('/legal', { method: 'POST', body: JSON.stringify(caseData) }),
  deleteLegalCase:(id)       => request(`/legal/${id}`, { method: 'DELETE' }),
  alerts:       ()        => withFallback('/alerts',                          mock.alerts),
  alertsLive:   (state, branch) => request(`/alerts/live${state && state !== 'All' ? `?state=${encodeURIComponent(state)}${branch && branch !== 'All' ? `&branch=${encodeURIComponent(branch)}` : ''}` : branch && branch !== 'All' ? `?branch=${encodeURIComponent(branch)}` : ''}`),
  reports:      ()        => withFallback('/reports', { reports: [] }),
  generateReport: (type, params = {}) => {
    const p = new URLSearchParams({ type, ...params });
    return withFallback(`/reports?${p}`, { type, columns: [], rows: [], total: 0 });
  },
  // ── Digital Tracker ───────────────────────────────────────────────────────────
  digitalLogin: async (email, password) => {
    const data = await request('/digital/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (data.token) localStorage.setItem('pk_token', data.token);
    return data.user;
  },

  digitalDashboard: (month) => {
    const p = new URLSearchParams();
    if (month) p.set('month', month);
    return request(`/digital/dashboard${p.toString() ? '?' + p.toString() : ''}`);
  },

  digitalUsers:       ()         => request('/digital/users'),
  createDigitalUser:  (data)     => request('/digital/users', { method: 'POST', body: JSON.stringify(data) }),
  updateDigitalUser:  (id, data) => request(`/digital/users?id=${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteDigitalUser:  (id)       => request(`/digital/users?id=${id}`, { method: 'DELETE' }),

  uploadDigitalUsers: async (file) => {
    const token = localStorage.getItem('pk_token');
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch(`${API_BASE}/digital/users`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    if (!res.ok) { let m = `HTTP ${res.status}`; try { const j = await res.json(); m = j.error || m; } catch {} throw new Error(m); }
    return res.json();
  },

  digitalTargets: (month) => request(`/digital/targets${month ? '?month=' + month : ''}`),

  breakingNews: (params = {}) => {
    const p = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v)));
    return request(`/digital/breaking-news${p.toString() ? '?' + p.toString() : ''}`);
  },
  fetchPatrikaArticles: (category = 'breaking-news') =>
    request(`/digital/breaking-news?action=fetch-patrika&category=${category}`),
  fetchPatrikaByDate: (date) =>
    request(`/digital/breaking-news?action=fetch-by-date&date=${encodeURIComponent(date)}`),
  articleMeta: (url) =>
    request(`/digital/breaking-news?action=article-meta&url=${encodeURIComponent(url)}`),
  batchAuthors: (urls) =>
    request('/digital/breaking-news?action=batch-authors', {
      method: 'POST',
      body: JSON.stringify({ urls }),
    }),
  addBreakingNews:    (data)     => request('/digital/breaking-news', { method: 'POST', body: JSON.stringify(data) }),
  updateBreakingNews: (id, data) => request(`/digital/breaking-news?id=${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteBreakingNews: (id)       => request(`/digital/breaking-news?id=${id}`, { method: 'DELETE' }),

  chartbeat: ({ period, from, to } = {}) => {
    if (from && to) return request(`/digital/chartbeat?from=${from}&to=${to}`);
    return request(`/digital/chartbeat?period=${period || 'today'}`);
  },

  uploadDigitalTargets: async (file) => {
    const token = localStorage.getItem('pk_token');
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch(`${API_BASE}/digital/targets`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    if (!res.ok) { let m = `HTTP ${res.status}`; try { const j = await res.json(); m = j.error || m; } catch {} throw new Error(m); }
    return res.json();
  },

  aiInsights: (state, branch, refresh = false, part = 'fast') => {
    const p = new URLSearchParams();
    if (state  && state  !== 'All') p.set('state',  state);
    if (branch && branch !== 'All') p.set('branch', branch);
    if (refresh) p.set('refresh', '1');
    if (part !== 'fast') p.set('part', part);
    const qs = p.toString();
    return withFallback(`/ai/insights${qs ? '?' + qs : ''}`, null);
  },

  aiAssistant: async (q) => {
    try { return await request('/ai/assistant', { method: 'POST', body: JSON.stringify({ q }) }); }
    catch (err) {
      console.warn(`[Patrika API] /ai/assistant failed (${err.message}) — using mock answer.`);
      return mock.aiAnswer(q);
    }
  },
  saveEmployee: (emp) =>
    withFallback('/hr/employees', { ok: true, employee: emp }, {
      method: 'POST', body: JSON.stringify(emp),
    }),

  // ── CV Parsing (multipart upload) ───────────────────────────────────────────
  parseCVs: async (files) => {
    const token = localStorage.getItem('pk_token');
    const formData = new FormData();
    Array.from(files).forEach(f => formData.append('files', f));
    const res = await fetch(`${API_BASE}/hr/parse-cv`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    if (!res.ok) {
      // Try to read the server's error message for a more helpful alert
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); msg = j.error || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  },

  // ── Recruitment ─────────────────────────────────────────────────────────────
  hrCandidates:      (status, state, branch) => {
    const p = new URLSearchParams();
    if (status && status !== 'all') p.set('status', status);
    if (state  && state  !== 'All') p.set('state',  state);
    if (branch && branch !== 'All') p.set('branch', branch);
    const qs = p.toString();
    return withFallback(`/hr/candidates${qs ? '?' + qs : ''}`, []);
  },
  addCandidate:      (data)      => request('/hr/candidates', { method: 'POST', body: JSON.stringify(data) }),
  updateCandidate:   (id, patch) => request(`/hr/candidates/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteCandidate:   (id)        => request(`/hr/candidates/${id}`, { method: 'DELETE' }),

  // ── Training & Induction ────────────────────────────────────────────────────
  hrTraining:        ()          => withFallback('/hr/training', []),
  saveTraining:      (data)      => request('/hr/training', { method: 'POST', body: JSON.stringify(data) }),

  // ── PLI & Grading ───────────────────────────────────────────────────────────
  hrGrading:         (month)     => withFallback(`/hr/grading?month=${month}`, []),
  hrGradingAuto:     (month)     => withFallback(`/hr/grading-auto?month=${month}`, { scores: {} }),
  hrGradingTop:      (state, branch) => withFallback(`/hr/grading-top?state=${encodeURIComponent(state || 'All')}&branch=${encodeURIComponent(branch || 'All')}`, { top3: [], worst3: [], month: '' }),
  saveGrading:       (data)      => request('/hr/grading', { method: 'POST', body: JSON.stringify(data) }),

  // ── Admin Stats ─────────────────────────────────────────────────────────────
  hrAdminStats:      (state, branch) => withFallback(`/hr/admin-stats?state=${encodeURIComponent(state || 'All')}&branch=${encodeURIComponent(branch || 'All')}`, null),
  hrLeaves:          (start, end, state, branch) => request(`/hr/leaves?start=${start}&end=${end}&state=${encodeURIComponent(state || 'All')}&branch=${encodeURIComponent(branch || 'All')}`),
  hrSanctionedPosts:    ()     => withFallback('/hr/sanctioned-posts', []),
  saveSanctionedPost:   (data) => request('/hr/sanctioned-posts', { method: 'POST', body: JSON.stringify(data) }),
  downloadSanctionedTemplate: async () => {
    const token = localStorage.getItem('pk_token');
    const res = await fetch(`${API_BASE}/hr/sanctioned-posts/template`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) { let m = `HTTP ${res.status}`; try { const j = await res.json(); m = j.error || m; } catch {} throw new Error(m); }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'sanctioned_posts_template.xlsx'; a.click();
    URL.revokeObjectURL(url);
  },
  uploadSanctionedBulk: async (file) => {
    const token = localStorage.getItem('pk_token');
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch(`${API_BASE}/hr/sanctioned-posts/bulk`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    if (!res.ok) { let m = `HTTP ${res.status}`; try { const j = await res.json(); m = j.error || m; } catch {} throw new Error(m); }
    return res.json();
  },

  // ── Appointments ────────────────────────────────────────────────────────────
  hrAppointments:      (params = {}) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,v]) => v))).toString();
    return withFallback(`/hr/appointments${qs ? '?' + qs : ''}`, { appointments: [], stats: {} });
  },
  addAppointment:      (data)      => request('/hr/appointments', { method: 'POST', body: JSON.stringify(data) }),
  updateAppointment:   (id, data)  => request(`/hr/appointments/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteAppointment:   (id)        => request(`/hr/appointments/${id}`, { method: 'DELETE' }),

  // ── Legal Notices ─────────────────────────────────────────────────────────────
  listLegalNotices: () => withFallback('/legal-notices', { notices: [] }),
  saveLegalNotice:  (data) => request('/legal-notices', { method: 'POST', body: JSON.stringify(data) }),
  updateLegalNotice:(id, data) => request(`/legal-notices/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteLegalNotice:(id)       => request(`/legal-notices/${id}`, { method: 'DELETE' }),

  parseLegalNoticePdf: async (formData) => {
    const token = localStorage.getItem('pk_token');
    const res = await fetch(`${API_BASE}/legal-notices/parse`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); msg = j.error || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  },

  // ── Login Logs (Admin only) ──────────────────────────────────────────────────
  loginLogs: (params = {}) => {
    const p = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v)));
    const qs = p.toString();
    return request(`/auth/login-logs${qs ? '?' + qs : ''}`);
  },

  // ── Activity Logs / Settings Logs (Admin only) ───────────────────────────────
  activityLogs: (params = {}) => {
    const p = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v)));
    const qs = p.toString();
    return request(`/auth/activity-logs${qs ? '?' + qs : ''}`);
  },

  // ── Task Management ──────────────────────────────────────────────────────────
  listTasks: (params = {}) => {
    const p = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v)));
    const qs = p.toString();
    return request(`/tasks${qs ? '?' + qs : ''}`);
  },
  createTask:    (data)      => request('/tasks',       { method: 'POST',   body: JSON.stringify(data) }),
  updateTask:    (id, data)  => request(`/tasks/${id}`, { method: 'PATCH',  body: JSON.stringify(data) }),
  deleteTask:    (id)        => request(`/tasks/${id}`, { method: 'DELETE' }),
  taskAssignees: ()          => request('/tasks/assignees'),
  taskComments:  (task_id)   => request(`/tasks/comments?task_id=${task_id}`),
  addTaskComment:(data)      => request('/tasks/comments', { method: 'POST', body: JSON.stringify(data) }),
  taskReport:    (params={}) => {
    const p = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,v]) => v)));
    return request(`/tasks/report${p.toString() ? '?' + p.toString() : ''}`);
  },
  listWeeklyReviews: ()     => request('/tasks/weekly-review'),
  saveWeeklyReview:  (data) => request('/tasks/weekly-review', { method: 'POST', body: JSON.stringify(data) }),
  listEvents: (state, branch) => {
    const p = new URLSearchParams();
    if (state  && state  !== 'All') p.set('state',  state);
    if (branch && branch !== 'All') p.set('branch', branch);
    const qs = p.toString();
    return request(`/tasks/events${qs ? '?' + qs : ''}`);
  },
  saveEvent:         (data) => request('/tasks/events', { method: 'POST', body: JSON.stringify(data) }),

  // ── Task Groups ──────────────────────────────────────────────────────────────
  // ── Task Bank ────────────────────────────────────────────────────────────────
  listTaskBank:     (params={}) => { const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,v])=>v))).toString(); return request(`/task-bank${qs?'?'+qs:''}`); },
  createTaskBankItem: (data)     => request('/task-bank',      { method: 'POST',   body: JSON.stringify(data) }),
  updateTaskBankItem: (id, data) => request(`/task-bank/${id}`, { method: 'PATCH',  body: JSON.stringify(data) }),
  deleteTaskBankItem: (id)       => request(`/task-bank/${id}`, { method: 'DELETE' }),

  listTaskGroups:   ()         => request('/task-groups').then(r => r.groups || r),
  createTaskGroup:  (data)     => request('/task-groups',      { method: 'POST',   body: JSON.stringify(data) }),
  getTaskGroup:     (id)       => request(`/task-groups/${id}`),
  updateTaskGroup:  (id, data) => request(`/task-groups/${id}`, { method: 'PATCH',  body: JSON.stringify(data) }),
  deleteTaskGroup:  (id)       => request(`/task-groups/${id}`, { method: 'DELETE' }),
  addGroupMembers:  (id, pan_nos) => request(`/task-groups/${id}?action=add_members`, { method: 'POST', body: JSON.stringify({ pan_nos }) }),
  removeGroupMember:(id, pan_no)  => request(`/task-groups/${id}?action=remove_member`, { method: 'POST', body: JSON.stringify({ pan_no }) }),

  /**
   * Send an alert (or any custom message) to Telegram.
   * @param {object} payload  { message?, alert?, chat_id?, alert_id? }
   * @returns {Promise<{ok:boolean, message_id:number|null, error:string|null}>}
   */
  sendTelegramAlert: async (payload) => {
    try {
      return await request('/alerts/send-telegram', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  /**
   * Fetch Telegram configuration status from the backend.
   * @returns {Promise<{configured:boolean, chat_id:string}>}
   */
  telegramConfig: async () => {
    try {
      return await request('/alerts/telegram-config');
    } catch {
      return { configured: false, chat_id: '' };
    }
  },

  /**
   * Test the bot token by calling Telegram getMe.
   * @returns {Promise<{ok:boolean, bot?:{username,first_name}, error?:string}>}
   */
  testTelegramBot: async () => {
    try {
      return await request('/alerts/telegram-test');
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  emailConfig: async () => {
    try {
      return await request('/alerts/email-config');
    } catch {
      return { configured: false, host: '', user: '', from: '', port: '587' };
    }
  },

  sendEmail: async (payload) => {
    try {
      return await request('/alerts/send-email', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  // ── Field Reporter Portal login (employee table, MD5 passwords) ─────────────
  reporterLogin: async (username, password) => {
    const data = await request('/field/reporter-login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (data.token) localStorage.setItem('pk_token', data.token);
    return data.user;
  },

  // ── Field Reporting ───────────────────────────────────────────────────────────
  fieldStories: (params = {}) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v))).toString();
    return request(`/field/stories${qs ? '?' + qs : ''}`);
  },
  submitFieldStory: (data) => request('/field/stories', { method: 'POST', body: JSON.stringify(data) }),
  updateFieldStory: (id, data) => request(`/field/stories/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  fieldVisits: (params = {}) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v))).toString();
    return request(`/field/visits${qs ? '?' + qs : ''}`);
  },
  markFieldVisit:  (data)      => request('/field/visits', { method: 'POST', body: JSON.stringify(data) }),
  checkOutVisit:   (id, data)  => request(`/field/visits/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  uploadFieldFiles: async (formData) => {
    const token = localStorage.getItem('pk_token');
    const res = await fetch(`${API_BASE}/field/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); msg = j.error || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  },
};

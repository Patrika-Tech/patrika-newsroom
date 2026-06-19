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
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
    if (data.token) localStorage.setItem('pk_token', data.token);
    return data.user;
  },

  // ── User management (Admin only) ─────────────────────────────────────────
  listUsers:   ()         => request('/users'),
  createUser:  (data)     => request('/users',        { method: 'POST',   body: JSON.stringify(data) }),
  updateUser:  (id, data) => request(`/users/${id}`,  { method: 'PATCH',  body: JSON.stringify(data) }),
  deleteUser:  (id)       => request(`/users/${id}`,  { method: 'DELETE' }),
  syncUsers:   ()         => request('/users/sync',   { method: 'POST' }),

  // ── Feedback ─────────────────────────────────────────────────────────────
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
  editorial: (state, month) => {
    const p = new URLSearchParams();
    if (state && state !== 'All') p.set('state', state);
    if (month) p.set('month', month);
    const qs = p.toString();
    return withFallback(`/editorial${qs ? '?' + qs : ''}`, { summary:{}, topNews:[], storyMix:[], targetVsActual:[], deskReview:[], planning:[], anniversaries:[], rndIdeas:[], coverageGaps:[], prominentDays:[] });
  },
  editorialFeeds: () => withFallback('/editorial/feeds', { feeds: [], fetchedAt: '' }),
  production:   (date)    => withFallback(`/production?date=${date}`,         { date, summary: { total: 0, onTime: 0, delayed: 0, avgDelay: 0, maxDelay: 0 }, editions: [] }),
  pageJourney:  (date)    => withFallback(`/production/page-journey?date=${date}`, { date, editions: [] }),
  pages: (date, state, branch) => {
    const p = new URLSearchParams({ date });
    if (state  && state  !== 'All') p.set('state',  state);
    if (branch && branch !== 'All') p.set('branch', branch);
    return withFallback(`/pages?${p.toString()}`, { date, news:{summary:{},categories:[],trend:[]}, qc:{summary:{},by_category:[],recent:[]}, visits:{summary:{},by_remark:[],by_transport:[],markers:[],persons:[]} });
  },
  hrEmployees:  ()        => withFallback('/hr/employees',                    mock.employees),
  hrRetirements:()        => withFallback('/hr/retirements',                  mock.retirements),
  listLocations:  ()        => withFallback('/locations', { states: [], branchesByState: {} }),
  legalCases:     (edition) => withFallback(`/legal?edition=${edition}`, mock.legal),
  saveLegalCase:  (caseData) => request('/legal', { method: 'POST', body: JSON.stringify(caseData) }),
  deleteLegalCase:(id)       => request(`/legal/${id}`, { method: 'DELETE' }),
  alerts:       ()        => withFallback('/alerts',                          mock.alerts),
  reports:      ()        => withFallback('/reports', { reports: [] }),
  generateReport: (type, params = {}) => {
    const p = new URLSearchParams({ type, ...params });
    return withFallback(`/reports?${p}`, { type, columns: [], rows: [], total: 0 });
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
  hrCandidates:      (status)    => withFallback(`/hr/candidates${status && status !== 'all' ? `?status=${status}` : ''}`, []),
  addCandidate:      (data)      => request('/hr/candidates', { method: 'POST', body: JSON.stringify(data) }),
  updateCandidate:   (id, patch) => request(`/hr/candidates/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteCandidate:   (id)        => request(`/hr/candidates/${id}`, { method: 'DELETE' }),

  // ── Training & Induction ────────────────────────────────────────────────────
  hrTraining:        ()          => withFallback('/hr/training', []),
  saveTraining:      (data)      => request('/hr/training', { method: 'POST', body: JSON.stringify(data) }),

  // ── PLI & Grading ───────────────────────────────────────────────────────────
  hrGrading:         (month)     => withFallback(`/hr/grading?month=${month}`, []),
  saveGrading:       (data)      => request('/hr/grading', { method: 'POST', body: JSON.stringify(data) }),

  // ── Admin Stats ─────────────────────────────────────────────────────────────
  hrAdminStats:      ()          => withFallback('/hr/admin-stats', null),
  hrSanctionedPosts: ()          => withFallback('/hr/sanctioned-posts', []),
  saveSanctionedPost:(data)      => request('/hr/sanctioned-posts', { method: 'POST', body: JSON.stringify(data) }),

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

  // ── Task Management ──────────────────────────────────────────────────────────
  listTasks: (status) => {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    const qs = p.toString();
    return request(`/tasks${qs ? '?' + qs : ''}`);
  },
  createTask: (data) => request('/tasks', { method: 'POST', body: JSON.stringify(data) }),
  updateTask: (id, data) => request(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTask: (id)       => request(`/tasks/${id}`, { method: 'DELETE' }),
  taskAssignees: ()      => request('/tasks/assignees'),

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

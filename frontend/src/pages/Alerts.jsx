import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, MessageCircle, Mail, Smartphone, Send,
  CheckCircle2, XCircle, Loader2, Settings2, ChevronDown, ChevronUp,
  Users, Search, X, RefreshCw, ExternalLink,
  Clock, VolumeX, ClipboardX, TrendingUp, FileCheck,
  UserMinus, UserX, CalendarDays, Gift, ShieldCheck,
  AlertTriangle, Zap, CalendarClock, MessageSquare,
  ChevronRight, User, Building2, History,
} from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../api/client.js';
import { PageHeader, SectionCard } from '../components/UI.jsx';

// ── Per-type visual metadata ──────────────────────────────────────────────────
const ALERT_META = {
  'Edition Delay':      { Icon: Clock,          color: '#dc2626', bg: '#fef2f2' },
  'Silent Branch':      { Icon: VolumeX,        color: '#dc2626', bg: '#fef2f2' },
  'Overdue Tasks':      { Icon: ClipboardX,     color: '#dc2626', bg: '#fef2f2' },
  'Extended Absence':   { Icon: UserX,          color: '#dc2626', bg: '#fef2f2' },
  'QC Spike':           { Icon: TrendingUp,     color: '#ea580c', bg: '#fff7ed' },
  'Plan Review Pending':{ Icon: FileCheck,      color: '#d97706', bg: '#fffbeb' },
  'Feedback Pending':   { Icon: MessageSquare,  color: '#d97706', bg: '#fffbeb' },
  'Staff On Leave':     { Icon: CalendarDays,   color: '#d97706', bg: '#fffbeb' },
  'Event Plan Pending': { Icon: CalendarClock,  color: '#7c3aed', bg: '#f5f3ff' },
  'Retirement Due':     { Icon: UserMinus,      color: '#2563eb', bg: '#eff6ff' },
  'Birthday Today':     { Icon: Gift,           color: '#059669', bg: '#ecfdf5' },
  'All Clear':          { Icon: ShieldCheck,    color: '#059669', bg: '#ecfdf5' },
};
const DEFAULT_META = { Icon: AlertTriangle, color: '#6b7280', bg: 'var(--bg)' };

const SEV_CFG = {
  high: { label: 'Critical', color: '#dc2626', bg: '#fef2f2', ring: '#fca5a5' },
  med:  { label: 'Warning',  color: '#d97706', bg: '#fffbeb', ring: '#fcd34d' },
  low:  { label: 'Info',     color: '#059669', bg: '#ecfdf5', ring: '#6ee7b7' },
};

// ── Channel pills (display only) ──────────────────────────────────────────────
const CHANNELS = [
  { icon: MessageCircle, label: 'WhatsApp' },
  { icon: Mail,          label: 'Email'    },
  { icon: Smartphone,    label: 'SMS'      },
  { icon: Send,          label: 'Telegram' },
];

// ── Custom hook — per-alert Telegram send status ──────────────────────────────
function useTgStatus() {
  const [map, setMap] = useState({});
  const set = (id, status, msg = '') =>
    setMap((prev) => ({ ...prev, [id]: { status, msg } }));
  const get = (id) => map[id] ?? { status: 'idle', msg: '' };
  return { set, get };
}

export default function Alerts() {
  const { t, state: globalState, branch: globalBranch } = useApp();
  const navigate = useNavigate();

  // ── State ──────────────────────────────────────────────────────────────────
  const [alerts,        setAlerts]        = useState([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsAt,      setAlertsAt]      = useState(null);
  const [sevFilter,     setSevFilter]     = useState('all');

  const loadAlerts = useCallback(() => {
    setAlertsLoading(true);
    api.alertsLive(globalState, globalBranch)
      .then(r => { setAlerts(r.alerts || []); setAlertsAt(r.generatedAt); })
      .catch(() => setAlerts([]))
      .finally(() => setAlertsLoading(false));
  }, [globalState, globalBranch]);
  const [tgConfig, setTgConfig] = useState({ configured: false, chat_id: '' });

  // DB-backed delivery log
  const [dbLogs,        setDbLogs]        = useState([]);
  const [dbLogsLoading, setDbLogsLoading] = useState(false);
  const [dbLogsPage,    setDbLogsPage]    = useState(1);
  const [dbLogsTotal,   setDbLogsTotal]   = useState(0);
  const [dbLogsPages,   setDbLogsPages]   = useState(1);
  const [expandedLog,   setExpandedLog]   = useState(null); // id of expanded row
  const logSectionRef = useRef(null);

  // Config panel
  const [showConfig,  setShowConfig]  = useState(false);
  const [chatIdInput, setChatIdInput] = useState('');
  const [testStatus,  setTestStatus]  = useState('idle');
  const [testResult,  setTestResult]  = useState(null);

  // Custom Telegram composer
  const [composer,       setComposer]       = useState(false);
  const [customMsg,      setCustomMsg]      = useState('');
  const [customChatId,   setCustomChatId]   = useState('');
  const [customSev,      setCustomSev]      = useState('high');
  const [composerStatus, setComposerStatus] = useState('idle');
  const [composerError,  setComposerError]  = useState('');

  // Per-alert send status
  const tgStatus = useTgStatus();

  // ── Email section state ────────────────────────────────────────────────────
  const [emailConfig,    setEmailConfig]    = useState({ configured: false, host: '', user: '', from: '', port: '587' });
  const [showEmailCfg,   setShowEmailCfg]   = useState(false);
  const [emailComposer,  setEmailComposer]  = useState(false);
  const [allUsers,       setAllUsers]       = useState([]);
  const [userSearch,     setUserSearch]     = useState('');
  const [selectedUsers,  setSelectedUsers]  = useState([]); // [{id,name,email}]
  const [emailSubject,   setEmailSubject]   = useState('');
  const [emailBody,      setEmailBody]      = useState('');
  const [emailStatus,    setEmailStatus]    = useState('idle'); // idle|sending|sent|error
  const [emailError,     setEmailError]     = useState('');
  const [emailLogs,      setEmailLogs]      = useState([]);

  // ── Load alerts whenever global state/branch changes ──────────────────────
  useEffect(() => { loadAlerts(); }, [loadAlerts]);

  const loadDbLogs = useCallback((page = 1) => {
    setDbLogsLoading(true);
    api.telegramLogs(page, 50)
      .then(r => {
        setDbLogs(r.logs || []);
        setDbLogsTotal(r.total || 0);
        setDbLogsPages(r.pages || 1);
        setDbLogsPage(page);
      })
      .catch(() => {})
      .finally(() => setDbLogsLoading(false));
  }, []);

  // ── Load config once on mount ──────────────────────────────────────────────
  useEffect(() => {
    api.telegramConfig().then((cfg) => {
      setTgConfig(cfg);
      setChatIdInput(cfg.chat_id || '');
    });
    api.emailConfig().then(setEmailConfig);
    api.listUsers().then(rows => setAllUsers(rows || [])).catch(() => {});
    loadDbLogs(1);
  }, [loadDbLogs]);

  // ── Telegram helpers ──────────────────────────────────────────────────────
  const sendAlertToTelegram = useCallback(async (alert) => {
    tgStatus.set(alert.id, 'sending');
    const res = await api.sendTelegramAlert({ alert, alert_id: alert.id, chat_id: chatIdInput || undefined });
    if (res.ok) {
      tgStatus.set(alert.id, 'sent');
      setTimeout(() => loadDbLogs(1), 800);
    } else {
      tgStatus.set(alert.id, 'error', res.error || 'Send failed');
    }
    setTimeout(() => tgStatus.set(alert.id, 'idle'), 4000);
  }, [chatIdInput, loadDbLogs]);

  const sendCustomMessage = async () => {
    if (!customMsg.trim()) return;
    setComposerStatus('sending'); setComposerError('');
    const sevEmoji = SEV_EMOJI[customSev] ?? '🟢';
    const formatted = `<b>${sevEmoji} Patrika Newsroom — Custom Alert</b>\n\n${customMsg}\n\n<i>⏰ ${new Date().toLocaleString()}</i>`;
    const res = await api.sendTelegramAlert({ message: formatted, chat_id: customChatId || chatIdInput || undefined });
    if (res.ok) {
      setComposerStatus('sent'); setCustomMsg('');
      setTimeout(() => loadDbLogs(1), 800);
      setTimeout(() => setComposerStatus('idle'), 3000);
    } else {
      setComposerStatus('error'); setComposerError(res.error || 'Failed to send.');
    }
  };

  const testBotToken = async () => {
    setTestStatus('testing'); setTestResult(null);
    const res = await api.testTelegramBot();
    setTestStatus(res.ok ? 'ok' : 'error'); setTestResult(res);
  };

  // ── Email helpers ─────────────────────────────────────────────────────────
  // Resolve effective email: explicit email field → username if it looks like email
  function effectiveEmail(u) {
    if (u.email_id) return u.email_id;
    if (u.username?.includes('@')) return u.username;
    return null;
  }

  const filteredUsers = allUsers.filter(u => {
    if (u.is_active === 0 || u.is_active === false) return false;
    const q = userSearch.toLowerCase();
    const em = effectiveEmail(u) || '';
    return !q || u.name?.toLowerCase().includes(q) || em.toLowerCase().includes(q) || u.role?.toLowerCase().includes(q);
  });

  function toggleUser(u) {
    setSelectedUsers(prev =>
      prev.find(x => x.id === u.id)
        ? prev.filter(x => x.id !== u.id)
        : [...prev, { id: u.id, name: u.name, email: effectiveEmail(u) }]
    );
  }

  async function sendEmail() {
    const recipients = selectedUsers.filter(u => u.email);
    if (!recipients.length) { setEmailError('No selected user has a resolvable email address.'); setEmailStatus('error'); return; }
    if (!emailSubject.trim()) { setEmailError('Subject is required'); setEmailStatus('error'); return; }
    if (!emailBody.trim())    { setEmailError('Message body is required'); setEmailStatus('error'); return; }

    setEmailStatus('sending'); setEmailError('');
    const res = await api.sendEmail({ to: recipients, subject: emailSubject.trim(), body: emailBody.trim() });

    if (res.ok) {
      setEmailStatus('sent');
      setEmailLogs(prev => [{ id: Date.now(), to: recipients.map(r => r.name).join(', '), subject: emailSubject, sent: res.sent, failed: res.failed, time: new Date().toLocaleTimeString() }, ...prev.slice(0, 9)]);
      setEmailSubject(''); setEmailBody(''); setSelectedUsers([]);
      setTimeout(() => setEmailStatus('idle'), 4000);
    } else {
      setEmailStatus('error');
      setEmailError(res.error || 'Failed to send email.');
    }
  }

  // ── Per-alert Telegram action button ─────────────────────────────────────
  function TgButton({ alert }) {
    const { status, msg } = tgStatus.get(alert.id);
    if (status === 'sending') return <Loader2 size={15} className="animate-spin" style={{ color: 'var(--brand)' }} />;
    if (status === 'sent')    return <CheckCircle2 size={15} className="text-green-500" />;
    if (status === 'error')   return <span title={msg} className="cursor-help"><XCircle size={15} className="text-red-500" /></span>;
    return (
      <button
        title="Forward to Telegram"
        onClick={() => sendAlertToTelegram(alert)}
        className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold transition hover:opacity-75"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
      >
        <Send size={11} /> Telegram
      </button>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      <PageHeader title={t('nav.alerts')}
        subtitle={[
          'Real-time alert engine · multi-channel delivery',
          globalState  && globalState  !== 'All' ? globalState  : null,
          globalBranch && globalBranch !== 'All' ? globalBranch : null,
        ].filter(Boolean).join(' · ')}
      />

      {/* Channel pills */}
      <div className="mb-4 flex flex-wrap gap-2">
        {CHANNELS.map(({ icon: Icon, label }) => (
          <span key={label} className="pill" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}>
            <Icon size={13} /> {label}
          </span>
        ))}
      </div>

      {/* ── Telegram Config Banner ──────────────────────────────────────────── */}
      <div className="mb-4 rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Send size={16} style={{ color: tgConfig.configured ? '#22c55e' : '#f59e0b' }} />
            <span className="text-sm font-bold">Telegram Integration</span>
            <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: tgConfig.configured ? '#d1fae5' : '#fef3c7', color: tgConfig.configured ? '#065f46' : '#92400e' }}>
              {tgConfig.configured ? '✓ Bot Connected' : '⚠ Not Configured'}
            </span>
          </div>
          <button className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted)' }} onClick={() => setShowConfig(!showConfig)}>
            <Settings2 size={13} />
            {showConfig ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            Settings
          </button>
        </div>

        {showConfig && (
          <div className="mt-3 space-y-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            <div className="rounded-lg p-3 text-xs space-y-1" style={{ background: 'var(--bg)' }}>
              <p className="font-semibold mb-1">Setup Guide:</p>
              <ol className="list-decimal list-inside space-y-1.5" style={{ color: 'var(--muted)' }}>
                <li>Open Telegram → message <strong>@BotFather</strong> → send <code>/newbot</code> → copy the token</li>
                <li>Set <code>TELEGRAM_BOT_TOKEN=&lt;token&gt;</code> in <code>.env</code> and restart server</li>
                <li>Add bot to channel as Admin, get chat ID from getUpdates</li>
                <li>Set <code>TELEGRAM_CHAT_ID=&lt;chat_id&gt;</code> in <code>.env</code></li>
              </ol>
            </div>
            <div>
              <button className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition hover:opacity-80" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }} onClick={testBotToken} disabled={testStatus === 'testing'}>
                {testStatus === 'testing' ? <><Loader2 size={13} className="animate-spin" /> Testing…</> : <><Send size={13} /> Test Bot Token</>}
              </button>
              {testStatus === 'ok' && testResult?.bot && (
                <div className="mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-green-700" style={{ background: '#d1fae5' }}>
                  <CheckCircle2 size={14} /> ✅ Token valid! Bot: <strong>{testResult.bot.first_name}</strong> ({testResult.bot.username})
                </div>
              )}
              {testStatus === 'error' && testResult?.error && (
                <div className="mt-2 rounded-lg px-3 py-2 text-xs text-red-700" style={{ background: '#fee2e2' }}>
                  <div className="flex items-start gap-2"><XCircle size={14} className="mt-0.5 flex-shrink-0" /><span>{testResult.error}</span></div>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="label text-xs">Chat ID override (this session only)</label>
                <input className="input w-full py-1.5 text-xs" placeholder="e.g. -1001234567890" value={chatIdInput} onChange={(e) => setChatIdInput(e.target.value)} />
              </div>
              <div className="flex items-end">
                <button className="btn-primary px-4 py-1.5 text-xs" onClick={() => setShowConfig(false)}>Apply</button>
              </div>
            </div>
            {tgConfig.chat_id && <p className="text-xs" style={{ color: 'var(--muted)' }}>Default from .env: <code>{tgConfig.chat_id}</code></p>}
          </div>
        )}
      </div>

      {/* ── Email Config Banner ─────────────────────────────────────────────── */}
      <div className="mb-4 rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail size={16} style={{ color: emailConfig.configured ? '#22c55e' : '#f59e0b' }} />
            <span className="text-sm font-bold">Email Integration</span>
            <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: emailConfig.configured ? '#d1fae5' : '#fef3c7', color: emailConfig.configured ? '#065f46' : '#92400e' }}>
              {emailConfig.configured ? `✓ ${emailConfig.user}` : '⚠ Not Configured'}
            </span>
          </div>
          <button className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted)' }} onClick={() => setShowEmailCfg(!showEmailCfg)}>
            <Settings2 size={13} />
            {showEmailCfg ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            Settings
          </button>
        </div>

        {showEmailCfg && (
          <div className="mt-3 space-y-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            <div className="rounded-lg p-3 text-xs space-y-1" style={{ background: 'var(--bg)' }}>
              <p className="font-semibold mb-1">SMTP Setup — add these to <code>.env</code> and restart server:</p>
              <pre className="mt-1 rounded p-2 text-xs overflow-x-auto" style={{ background: 'var(--surface)', color: 'var(--text)' }}>{`SMTP_HOST=smtp.gmail.com       # or smtp.office365.com
SMTP_PORT=587                  # 587 for TLS, 465 for SSL
SMTP_SECURE=false              # true only for port 465
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password    # Gmail: use App Password, not account password
SMTP_FROM=Patrika Newsroom <you@gmail.com>   # optional`}</pre>
              <p className="mt-1" style={{ color: 'var(--muted)' }}>
                For Gmail: enable 2FA → Google Account → Security → App Passwords → generate one.
              </p>
            </div>
            {emailConfig.configured && (
              <div className="rounded-lg p-3 text-xs space-y-1" style={{ background: '#d1fae5', color: '#065f46' }}>
                <p>✓ <strong>Host:</strong> {emailConfig.host}:{emailConfig.port}</p>
                <p>✓ <strong>User:</strong> {emailConfig.user}</p>
                <p>✓ <strong>From:</strong> {emailConfig.from}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Custom Telegram Composer ──────────────────────────────────────────── */}
      <SectionCard className="mb-4" title={
        <button className="flex w-full items-center justify-between text-left" onClick={() => setComposer(!composer)}>
          <span className="flex items-center gap-1.5 font-semibold"><Send size={15} /> Send Custom Telegram Alert</span>
          {composer ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      }>
        {composer && (
          <div className="mt-3 space-y-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            <div>
              <label className="label text-xs">Severity</label>
              <div className="flex gap-2 mt-1">
                {['high', 'med', 'low'].map((s) => (
                  <button key={s} onClick={() => setCustomSev(s)} className="rounded-full px-3 py-1 text-xs font-semibold capitalize transition"
                    style={{ background: customSev === s ? 'var(--brand)' : 'var(--surface)', color: customSev === s ? '#fff' : 'var(--text)', border: '1px solid var(--border)' }}>
                    {SEV_EMOJI[s]}&nbsp;{s === 'med' ? 'Medium' : s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label text-xs">Message</label>
              <textarea className="input mt-1 w-full resize-none py-2 text-sm" rows={3} placeholder="Type your alert message here…" value={customMsg} onChange={(e) => setCustomMsg(e.target.value)} />
            </div>
            <div>
              <label className="label text-xs">Send to (optional Chat ID override)</label>
              <input className="input mt-1 w-full py-1.5 text-xs" placeholder="Leave blank to use configured Chat ID" value={customChatId} onChange={(e) => setCustomChatId(e.target.value)} />
            </div>
            {composerStatus === 'sent' && <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-green-700" style={{ background: '#d1fae5' }}><CheckCircle2 size={16} /> Sent to Telegram!</div>}
            {composerStatus === 'error' && <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-700" style={{ background: '#fee2e2' }}><XCircle size={16} /> {composerError}</div>}
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => { setComposer(false); setCustomMsg(''); setComposerStatus('idle'); }}>Cancel</button>
              <button className="btn-primary flex items-center gap-1.5" onClick={sendCustomMessage} disabled={composerStatus === 'sending' || !customMsg.trim()}>
                {composerStatus === 'sending' ? <><Loader2 size={14} className="animate-spin" /> Sending…</> : <><Send size={14} /> Send to Telegram</>}
              </button>
            </div>
          </div>
        )}
      </SectionCard>

      {/* ── Email Composer ────────────────────────────────────────────────────── */}
      <SectionCard className="mb-4" title={
        <button className="flex w-full items-center justify-between text-left" onClick={() => setEmailComposer(!emailComposer)}>
          <span className="flex items-center gap-1.5 font-semibold"><Mail size={15} /> Send Email to Users</span>
          {emailComposer ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      }>
        {emailComposer && (
          <div className="mt-3 space-y-4 border-t pt-3" style={{ borderColor: 'var(--border)' }}>

            {!emailConfig.configured && (
              <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs text-amber-700" style={{ background: '#fef3c7' }}>
                <Settings2 size={14} className="mt-0.5 flex-shrink-0" />
                <span>SMTP not configured. Add <code>SMTP_HOST / SMTP_USER / SMTP_PASS</code> to <code>.env</code> and restart server. See Email Settings above.</span>
              </div>
            )}

            {/* User picker */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="label text-xs flex items-center gap-1.5"><Users size={13} /> Select Recipients</label>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>{selectedUsers.length} selected</span>
              </div>

              {/* Selected chips */}
              {selectedUsers.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {selectedUsers.map(u => (
                    <span key={u.id} className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
                      style={{ background: 'var(--brand)', color: '#fff' }}>
                      {u.name}
                      {!u.email && <span title="Using username as email" className="opacity-70"> ~</span>}
                      <button onClick={() => toggleUser(u)} className="ml-0.5 opacity-70 hover:opacity-100"><X size={11} /></button>
                    </span>
                  ))}
                </div>
              )}

              {/* Search + list */}
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-2.5" style={{ color: 'var(--muted)' }} />
                <input className="input pl-8 w-full py-1.5 text-xs" placeholder="Search by name, email or role…"
                  value={userSearch} onChange={e => setUserSearch(e.target.value)} />
              </div>
              <div className="mt-1.5 max-h-44 overflow-y-auto rounded-lg border divide-y" style={{ borderColor: 'var(--border)', divideColor: 'var(--border)' }}>
                {filteredUsers.length === 0
                  ? <p className="px-3 py-2 text-xs text-center" style={{ color: 'var(--muted)' }}>No users found</p>
                  : filteredUsers.map(u => {
                    const checked = !!selectedUsers.find(x => x.id === u.id);
                    return (
                      <label key={u.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:opacity-80 transition-opacity" style={{ background: checked ? 'var(--bg)' : 'transparent' }}>
                        <input type="checkbox" checked={checked} onChange={() => toggleUser(u)} className="accent-emerald-500 w-3.5 h-3.5" />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">{u.name}</div>
                          <div className="text-xs truncate" style={{ color: effectiveEmail(u) ? 'var(--muted)' : '#f59e0b' }}>
                            {effectiveEmail(u) || '⚠ No email set'}
                          </div>
                        </div>
                        <span className="text-xs shrink-0 rounded-full px-2 py-0.5" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
                          {u.role}
                        </span>
                      </label>
                    );
                  })}
              </div>
              <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
                Email is taken from the <strong>email</strong> field; falls back to username if it contains @.
              </p>
            </div>

            {/* Subject */}
            <div>
              <label className="label text-xs">Subject</label>
              <input className="input mt-1 w-full py-1.5 text-sm" placeholder="Email subject…" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} />
            </div>

            {/* Body */}
            <div>
              <label className="label text-xs">Message</label>
              <textarea className="input mt-1 w-full resize-none py-2 text-sm" rows={5} placeholder="Write your email here…" value={emailBody} onChange={e => setEmailBody(e.target.value)} />
            </div>

            {/* Status */}
            {emailStatus === 'sent' && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-green-700" style={{ background: '#d1fae5' }}>
                <CheckCircle2 size={16} /> Email sent successfully!
              </div>
            )}
            {emailStatus === 'error' && (
              <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-sm text-red-700" style={{ background: '#fee2e2' }}>
                <XCircle size={16} className="mt-0.5 flex-shrink-0" /> {emailError}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => { setEmailComposer(false); setEmailSubject(''); setEmailBody(''); setSelectedUsers([]); setEmailStatus('idle'); }}>Cancel</button>
              <button
                className="btn-primary flex items-center gap-1.5"
                onClick={sendEmail}
                disabled={emailStatus === 'sending' || selectedUsers.length === 0 || !emailSubject.trim() || !emailBody.trim()}
              >
                {emailStatus === 'sending'
                  ? <><Loader2 size={14} className="animate-spin" /> Sending…</>
                  : <><Mail size={14} /> Send Email ({selectedUsers.filter(u => u.email).length})</>}
              </button>
            </div>
          </div>
        )}
      </SectionCard>

      {/* ── Alert Center ─────────────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        {/* Header bar */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ background: '#d71920', borderRadius: 10, padding: '6px 8px', display: 'flex', alignItems: 'center' }}>
              <Bell size={16} color="#fff" />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>Alert Center</div>
              {alertsAt && <div style={{ fontSize: 11, color: 'var(--muted)' }}>updated {String(alertsAt).slice(11, 16)} UTC</div>}
            </div>
          </div>
          <button className="btn-ghost flex items-center gap-1.5 text-xs" onClick={loadAlerts} style={{ padding: '6px 10px' }}>
            <RefreshCw size={13} className={alertsLoading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {/* Severity stat tiles */}
        {!alertsLoading && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0, borderBottom: '1px solid var(--border)' }}>
            {Object.entries(SEV_CFG).map(([sev, cfg], i) => {
              const n = alerts.filter(a => a.sev === sev).length;
              const active = sevFilter === sev;
              return (
                <button key={sev} onClick={() => setSevFilter(active ? 'all' : sev)}
                  style={{
                    padding: '14px 8px', textAlign: 'center', cursor: 'pointer', border: 'none',
                    borderRight: i < 2 ? '1px solid var(--border)' : 'none',
                    background: active ? cfg.color : 'var(--surface)',
                    transition: 'background 0.15s',
                  }}>
                  <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1, color: active ? '#fff' : cfg.color }}>{n}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, marginTop: 4, color: active ? 'rgba(255,255,255,0.8)' : cfg.color, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {cfg.label}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Severity filter pills */}
        <div style={{ padding: '10px 16px', display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
          <button onClick={() => setSevFilter('all')}
            style={{ padding: '3px 12px', borderRadius: 9999, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)',
              background: sevFilter === 'all' ? 'var(--brand)' : 'transparent', color: sevFilter === 'all' ? '#fff' : 'var(--fg)' }}>
            All ({alerts.length})
          </button>
          {Object.entries(SEV_CFG).map(([sev, cfg]) => {
            const n = alerts.filter(a => a.sev === sev).length;
            if (!n) return null;
            return (
              <button key={sev} onClick={() => setSevFilter(sevFilter === sev ? 'all' : sev)}
                style={{ padding: '3px 12px', borderRadius: 9999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  background: sevFilter === sev ? cfg.color : cfg.bg,
                  color: sevFilter === sev ? '#fff' : cfg.color,
                  border: `1px solid ${cfg.ring}` }}>
                {cfg.label} · {n}
              </button>
            );
          })}
        </div>

        {/* Alert list */}
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {alertsLoading ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Loader2 size={18} className="animate-spin" /> Scanning newsroom data…
            </div>
          ) : alerts.filter(a => sevFilter === 'all' || a.sev === sevFilter).length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--muted)', fontSize: 14 }}>
              No alerts in this category.
            </div>
          ) : alerts.filter(a => sevFilter === 'all' || a.sev === sevFilter).map(a => {
            const meta  = ALERT_META[a.type] || DEFAULT_META;
            const scfg  = SEV_CFG[a.sev] || SEV_CFG.low;
            const isPulse = a.sev === 'high';
            return (
              <div key={a.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px',
                borderRadius: 12, background: meta.bg,
                border: `1px solid ${meta.color}28`,
                borderLeft: `4px solid ${meta.color}`,
                position: 'relative', overflow: 'hidden',
              }}>
                {/* Animated glow strip for critical */}
                {isPulse && (
                  <div style={{
                    position: 'absolute', top: 0, left: 0, width: '100%', height: 2,
                    background: `linear-gradient(90deg, ${meta.color}, transparent)`,
                    opacity: 0.6,
                  }} />
                )}

                {/* Icon */}
                <div style={{
                  flexShrink: 0, width: 38, height: 38, borderRadius: 10,
                  background: meta.color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: `1px solid ${meta.color}30`,
                }}>
                  <meta.Icon size={18} color={meta.color} />
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: meta.color, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                      {a.type}
                    </span>
                    {a.count != null && (
                      <span style={{
                        fontSize: 11, fontWeight: 800, padding: '1px 8px', borderRadius: 9999,
                        background: meta.color, color: '#fff',
                      }}>
                        {a.count}
                      </span>
                    )}
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 9999,
                      background: scfg.bg, color: scfg.color, border: `1px solid ${scfg.ring}`, textTransform: 'uppercase',
                    }}>
                      {scfg.label}
                    </span>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.55, margin: 0 }}>{a.text}</p>
                  <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{a.time} IST</p>
                </div>

                {/* Actions */}
                <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end' }}>
                  {a.link && a.link !== '/' && (
                    <button onClick={() => navigate(a.link)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px',
                        borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                        background: meta.color, color: '#fff', border: 'none',
                      }}>
                      <ExternalLink size={11} /> Open
                    </button>
                  )}
                  <TgButton alert={a} />
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ padding: '8px 16px', fontSize: 11, color: 'var(--muted)', borderTop: '1px solid var(--border)' }}>
          Checks: edition delays · silent branches · overdue tasks · QC spikes · plan review · open feedback · retirements · staff on leave · event plans · birthdays · extended absences
        </div>
      </div>

      {/* ── Email Send History (in-session) ──────────────────────────────────── */}
      {emailLogs.length > 0 && (
        <SectionCard className="mt-4" title={<span className="flex items-center gap-1.5"><Mail size={15} /> Email Send History</span>}>
          <div className="space-y-1.5">
            {emailLogs.map((log) => (
              <div key={log.id} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: 'var(--bg)' }}>
                <CheckCircle2 size={14} className="flex-shrink-0 text-green-500" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{log.subject}</div>
                  <div className="text-xs truncate" style={{ color: 'var(--muted)' }}>To: {log.to}</div>
                </div>
                <span className="text-xs shrink-0 text-green-600">{log.sent} sent{log.failed > 0 ? `, ${log.failed} failed` : ''}</span>
                <span className="flex-shrink-0 text-xs" style={{ color: 'var(--muted)' }}>{log.time}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* ── Telegram Delivery Log (DB-backed) ────────────────────────────────── */}
      <div ref={logSectionRef} className="mt-4 rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <div style={{ background: '#0088cc22', borderRadius: 8, padding: '5px 7px', display: 'flex' }}>
              <History size={15} style={{ color: '#0088cc' }} />
            </div>
            <div>
              <div className="font-bold text-sm">Telegram Delivery Log</div>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>
                {dbLogsLoading ? 'Loading…' : `${dbLogsTotal} messages · page ${dbLogsPage} of ${dbLogsPages}`}
              </div>
            </div>
          </div>
          <button
            className="flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 transition hover:opacity-75"
            style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }}
            onClick={() => loadDbLogs(1)}
            disabled={dbLogsLoading}
          >
            <RefreshCw size={12} className={dbLogsLoading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {/* Type legend */}
        <div className="flex flex-wrap gap-2 px-4 py-2.5" style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
          {[
            { label: 'Manual Alert', color: '#dc2626', bg: '#fef2f2' },
            { label: 'Delay Report', color: '#2563eb', bg: '#eff6ff' },
            { label: 'Top Delay',    color: '#7c3aed', bg: '#f5f3ff' },
            { label: 'Appreciation', color: '#059669', bg: '#ecfdf5' },
            { label: 'Custom',       color: '#d97706', bg: '#fffbeb' },
            { label: 'Auto',         color: '#6b7280', bg: 'var(--surface)' },
          ].map(t => (
            <span key={t.label} className="rounded-full px-2 py-0.5 text-xs font-semibold"
              style={{ background: t.bg, color: t.color }}>
              {t.label}
            </span>
          ))}
        </div>

        {/* Log rows */}
        <div style={{ background: 'var(--bg)' }}>
          {dbLogsLoading && dbLogs.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm" style={{ color: 'var(--muted)' }}>
              <Loader2 size={16} className="animate-spin" /> Loading log…
            </div>
          ) : dbLogs.length === 0 ? (
            <div className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>No messages sent yet.</div>
          ) : (
            <div className="divide-y" style={{ divideColor: 'var(--border)' }}>
              {dbLogs.map(log => {
                const isExpanded = expandedLog === log.id;
                const isSent     = log.status === 'sent';
                const typeColors = {
                  'Manual Alert': { color: '#dc2626', bg: '#fef2f2' },
                  'Delay Report': { color: '#2563eb', bg: '#eff6ff' },
                  'Top Delay':    { color: '#7c3aed', bg: '#f5f3ff' },
                  'Appreciation': { color: '#059669', bg: '#ecfdf5' },
                  'Custom':       { color: '#d97706', bg: '#fffbeb' },
                  'Due Date':     { color: '#0891b2', bg: '#ecfeff' },
                  'Payment Alert':{ color: '#b45309', bg: '#fef3c7' },
                  'Visit Alert':  { color: '#4338ca', bg: '#eef2ff' },
                  'Weekly Plan':  { color: '#047857', bg: '#ecfdf5' },
                };
                const tc = typeColors[log.type] || { color: '#6b7280', bg: 'var(--surface)' };

                return (
                  <div key={log.id} style={{ borderColor: 'var(--border)' }}>
                    <div
                      className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => setExpandedLog(isExpanded ? null : log.id)}
                    >
                      {/* Status dot */}
                      <div className="mt-1 flex-shrink-0">
                        {isSent
                          ? <div style={{ width: 8, height: 8, borderRadius: 9999, background: '#22c55e', boxShadow: '0 0 0 2px #bbf7d0' }} />
                          : <div style={{ width: 8, height: 8, borderRadius: 9999, background: '#ef4444', boxShadow: '0 0 0 2px #fecaca' }} />}
                      </div>

                      {/* Main content */}
                      <div className="flex-1 min-w-0">
                        {/* Row 1: recipient + type + time */}
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <div className="flex items-center gap-1">
                            {log.recipient_name ? (
                              <>
                                <User size={11} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                                <span className="text-xs font-semibold">{log.recipient_name}</span>
                              </>
                            ) : (
                              <>
                                <Send size={11} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                                <span className="text-xs font-mono" style={{ color: 'var(--muted)' }}>{log.chat_id}</span>
                              </>
                            )}
                          </div>
                          {log.recipient_branch && (
                            <div className="flex items-center gap-1">
                              <Building2 size={10} style={{ color: 'var(--muted)' }} />
                              <span className="text-xs" style={{ color: 'var(--muted)' }}>{log.recipient_branch}</span>
                            </div>
                          )}
                          <span className="rounded-full px-2 py-0.5 text-xs font-semibold"
                            style={{ background: tc.bg, color: tc.color }}>
                            {log.type}
                          </span>
                          <span className="text-xs ml-auto" style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                            {log.sent_at || `#${log.id}`}
                          </span>
                        </div>

                        {/* Row 2: message preview */}
                        <p className="text-xs leading-relaxed" style={{ color: 'var(--fg)' }}>
                          {log.preview}{log.preview?.length >= 140 ? '…' : ''}
                        </p>
                      </div>

                      {/* Expand chevron */}
                      <ChevronRight size={14} className="mt-1 flex-shrink-0 transition-transform"
                        style={{ color: 'var(--muted)', transform: isExpanded ? 'rotate(90deg)' : 'none' }} />
                    </div>

                    {/* Expanded: full HTML message */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1">
                        <div className="rounded-lg p-3 text-xs leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap break-words"
                          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--fg)', maxHeight: 320, overflowY: 'auto' }}>
                          {/* Show plain text version of the HTML */}
                          {(log.full_message || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')}
                        </div>
                        <div className="mt-2 flex items-center gap-3 text-xs" style={{ color: 'var(--muted)' }}>
                          <span>Chat ID: <code>{log.chat_id}</code></span>
                          {log.recipient_role && <span>Role: {log.recipient_role}</span>}
                          {log.recipient_state && <span>State: {log.recipient_state}</span>}
                          <span className="ml-auto">Log #{log.id}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pagination */}
        {dbLogsPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
            <button
              className="text-xs rounded-lg px-3 py-1.5 transition hover:opacity-75 disabled:opacity-40"
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }}
              disabled={dbLogsPage <= 1 || dbLogsLoading}
              onClick={() => loadDbLogs(dbLogsPage - 1)}
            >
              ← Previous
            </button>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              Page {dbLogsPage} / {dbLogsPages}
            </span>
            <button
              className="text-xs rounded-lg px-3 py-1.5 transition hover:opacity-75 disabled:opacity-40"
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }}
              disabled={dbLogsPage >= dbLogsPages || dbLogsLoading}
              onClick={() => loadDbLogs(dbLogsPage + 1)}
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

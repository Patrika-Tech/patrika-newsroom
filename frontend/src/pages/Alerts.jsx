import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, MessageCircle, Mail, Smartphone, Send,
  CheckCircle2, XCircle, Loader2, Settings2, ChevronDown, ChevronUp,
  Users, Search, X, RefreshCw, ExternalLink,
} from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../api/client.js';
import { PageHeader, SectionCard, Badge } from '../components/UI.jsx';

// ── Severity helpers ──────────────────────────────────────────────────────────
const SEV_EMOJI = { high: '🔴', med: '🟡', low: '🟢' };

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
  const { t } = useApp();
  const navigate = useNavigate();

  // ── State ──────────────────────────────────────────────────────────────────
  const [alerts,        setAlerts]        = useState([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsAt,      setAlertsAt]      = useState(null);
  const [sevFilter,     setSevFilter]     = useState('all');

  const loadAlerts = useCallback(() => {
    setAlertsLoading(true);
    api.alertsLive()
      .then(r => { setAlerts(r.alerts || []); setAlertsAt(r.generatedAt); })
      .catch(() => setAlerts([]))
      .finally(() => setAlertsLoading(false));
  }, []);
  const [tgConfig, setTgConfig] = useState({ configured: false, chat_id: '' });
  const [tgLogs,   setTgLogs]   = useState([]);

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

  // ── Load data on mount ─────────────────────────────────────────────────────
  useEffect(() => {
    loadAlerts();
    api.telegramConfig().then((cfg) => {
      setTgConfig(cfg);
      setChatIdInput(cfg.chat_id || '');
    });
    api.emailConfig().then(setEmailConfig);
    api.listUsers().then(rows => setAllUsers(rows || [])).catch(() => {});
  }, []);

  // ── Telegram helpers ──────────────────────────────────────────────────────
  const sendAlertToTelegram = useCallback(async (alert) => {
    tgStatus.set(alert.id, 'sending');
    const res = await api.sendTelegramAlert({ alert, alert_id: alert.id, chat_id: chatIdInput || undefined });
    if (res.ok) {
      tgStatus.set(alert.id, 'sent');
      setTgLogs((prev) => [{ id: Date.now(), alertId: alert.id, type: alert.type, text: alert.text, time: new Date().toLocaleTimeString(), status: 'sent' }, ...prev.slice(0, 9)]);
    } else {
      tgStatus.set(alert.id, 'error', res.error || 'Send failed');
    }
    setTimeout(() => tgStatus.set(alert.id, 'idle'), 4000);
  }, [chatIdInput]);

  const sendCustomMessage = async () => {
    if (!customMsg.trim()) return;
    setComposerStatus('sending'); setComposerError('');
    const sevEmoji = SEV_EMOJI[customSev] ?? '🟢';
    const formatted = `<b>${sevEmoji} Patrika Newsroom — Custom Alert</b>\n\n${customMsg}\n\n<i>⏰ ${new Date().toLocaleString()}</i>`;
    const res = await api.sendTelegramAlert({ message: formatted, chat_id: customChatId || chatIdInput || undefined });
    if (res.ok) {
      setComposerStatus('sent'); setCustomMsg('');
      setTgLogs((prev) => [{ id: Date.now(), alertId: null, type: 'Custom', text: customMsg, time: new Date().toLocaleTimeString(), status: 'sent' }, ...prev.slice(0, 9)]);
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
      <PageHeader title={t('nav.alerts')} subtitle="Real-time alert engine · multi-channel delivery" />

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

      {/* ── Live Alerts (computed from real data) ────────────────────────────── */}
      <SectionCard title={
        <span className="flex items-center gap-2 flex-wrap">
          <Bell size={15} /> Alert Center
          {!alertsLoading && (
            <>
              {['high', 'med', 'low'].map(s => {
                const n = alerts.filter(a => a.sev === s).length;
                if (!n) return null;
                return (
                  <span key={s} className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{
                      background: s === 'high' ? '#fee2e2' : s === 'med' ? '#fef3c7' : '#dcfce7',
                      color:      s === 'high' ? '#b91c1c' : s === 'med' ? '#92400e' : '#166534',
                    }}>
                    {SEV_EMOJI[s]} {n}
                  </span>
                );
              })}
            </>
          )}
        </span>
      } action={
        <div className="flex items-center gap-2">
          {alertsAt && (
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              updated {String(alertsAt).slice(11, 16)} UTC
            </span>
          )}
          <button className="btn-ghost p-1.5" title="Refresh" onClick={loadAlerts}>
            <RefreshCw size={14} className={alertsLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      }>
        {/* Severity filter */}
        <div className="flex gap-2 mb-3 flex-wrap">
          {[['all', 'All'], ['high', '🔴 Critical'], ['med', '🟡 Warning'], ['low', '🟢 Info']].map(([key, label]) => (
            <button key={key} onClick={() => setSevFilter(key)}
              className="px-3 py-1 rounded-full text-xs font-semibold transition"
              style={{
                background: sevFilter === key ? 'var(--brand)' : 'var(--bg)',
                color:      sevFilter === key ? '#fff' : 'var(--text)',
                border: '1px solid var(--border)', cursor: 'pointer',
              }}>
              {label}
            </button>
          ))}
        </div>

        {alertsLoading ? (
          <div className="flex items-center justify-center py-10 gap-2" style={{ color: 'var(--muted)' }}>
            <Loader2 size={18} className="animate-spin" /> Scanning newsroom data…
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.filter(a => sevFilter === 'all' || a.sev === sevFilter).map((a) => (
              <div key={a.id} className="flex items-start gap-3 rounded-lg p-3"
                style={{
                  background: 'var(--bg)',
                  borderLeft: `4px solid ${a.sev === 'high' ? '#dc2626' : a.sev === 'med' ? '#f59e0b' : '#16a34a'}`,
                }}>
                <Badge tone={a.sev === 'high' ? 'high' : a.sev === 'med' ? 'med' : 'low'}>{a.type}</Badge>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{a.text}</div>
                  <div className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>{a.time} IST</div>
                </div>
                <div className="flex-shrink-0 flex items-center gap-1.5 pt-0.5">
                  {a.link && a.link !== '/' && (
                    <button
                      title="Open related tab"
                      onClick={() => navigate(a.link)}
                      className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold transition hover:opacity-75"
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--brand)' }}>
                      <ExternalLink size={11} /> Open
                    </button>
                  )}
                  <TgButton alert={a} />
                </div>
              </div>
            ))}
            {alerts.filter(a => sevFilter === 'all' || a.sev === sevFilter).length === 0 && (
              <p className="py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>No alerts in this category.</p>
            )}
          </div>
        )}
        <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>
          Live checks: edition delays (30+ min) · silent branches (zero stories) · overdue tasks · QC spikes · plans awaiting review · open high-priority feedback · retirements within 60 days.
        </p>
      </SectionCard>

      {/* ── Email Send History ────────────────────────────────────────────────── */}
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

      {/* ── Telegram Send History ─────────────────────────────────────────────── */}
      {tgLogs.length > 0 && (
        <SectionCard className="mt-4" title={<span className="flex items-center gap-1.5"><Send size={15} /> Telegram Send History</span>}>
          <div className="space-y-1.5">
            {tgLogs.map((log) => (
              <div key={log.id} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: 'var(--bg)' }}>
                <CheckCircle2 size={14} className="flex-shrink-0 text-green-500" />
                <span className="flex-1 truncate text-xs">{log.text}</span>
                <span className="flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>{log.type}</span>
                <span className="flex-shrink-0 text-xs" style={{ color: 'var(--muted)' }}>{log.time}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

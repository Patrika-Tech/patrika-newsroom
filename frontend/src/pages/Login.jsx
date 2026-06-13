import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../api/client.js';
import { Logo } from '../components/UI.jsx';
import { Globe, Moon, Sun, ShieldCheck } from 'lucide-react';

export default function Login() {
  const { login, t, lang, setLang, theme, setTheme } = useApp();
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [busy, setBusy]  = useState(false);
  const [err,  setErr]   = useState('');
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const user = await api.login(username, password);
      login(user);
      nav(user.role === 'Legal' ? '/legal' : '/');
    } catch (e) { setErr(e.message || 'Login failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden p-12 text-white"
        style={{ background: 'radial-gradient(120% 120% at 0% 0%, #d71920 0%, #8c0a0e 55%, #14100f 100%)' }}>
        <div className="brand-bar absolute inset-x-0 top-0 h-2" />
        <Logo size={48} withText={false} />
        <div>
          <h1 className="text-4xl font-bold leading-tight" style={{ fontFamily: 'Roboto, sans-serif' }}>{t('appName')}</h1>
          <p className="mt-3 max-w-md text-white/80">{t('tagline')}</p>
          <ul className="mt-6 space-y-2 text-sm text-white/80">
            <li>• State & branch-wise HR dashboard · RE, Reporter, Desk, Photographer profiles</li>
            <li>• Recruitment · CV parsing · Training & Induction · PLI monthly grading</li>
            <li>• Legal case tracking · Editorial, Production & Page monitoring</li>
            <li>• Role-based access · Telegram alerts · Hindi + English</li>
          </ul>
        </div>
        <p className="text-xs text-white/50">© {new Date().getFullYear()} Rajasthan Patrika Group · Internal Tool</p>
      </div>

      {/* Form */}
      <div className="flex items-center justify-center p-6" style={{ background: 'var(--bg)' }}>
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center justify-between">
            <Logo />
            <div className="flex gap-2">
              <button className="btn-ghost px-2.5 py-1.5" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>
                <Globe size={16} /> {lang === 'en' ? 'EN' : 'हिं'}
              </button>
              <button className="btn-ghost px-2.5 py-1.5" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            </div>
          </div>

          <h2 className="text-xl font-bold">{t('login')}</h2>
          <p className="mb-5 text-sm" style={{ color: 'var(--muted)' }}>
            Enter your credentials — role and access are assigned by Admin
          </p>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label">{t('username')}</label>
              <input
                className="input" autoComplete="username"
                value={username} onChange={(e) => setU(e.target.value)}
                placeholder="e.g. r.sharma" required
              />
            </div>
            <div>
              <label className="label">{t('password')}</label>
              <input
                className="input" type="password" autoComplete="current-password"
                value={password} onChange={(e) => setP(e.target.value)}
                placeholder="••••••••" required
              />
            </div>

            {err && <p className="text-sm rounded-lg px-3 py-2" style={{ color: '#d71920', background: '#d7192015' }}>{err}</p>}

            <button className="btn-primary w-full py-2.5" disabled={busy}>
              {busy ? 'Signing in…' : t('login')}
            </button>
          </form>

          <p className="mt-5 flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
            <ShieldCheck size={14} /> Access is role-based. Contact Admin if you need an account.
          </p>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { api } from '../api/client.js';
import Field from './Field.jsx';
import { Loader2, LogOut, Radio, Eye, EyeOff } from 'lucide-react';

const ALLOWED_ROLES = ['Admin', 'State Head', 'Regional Editor'];

export default function FieldPortal() {
  const { user, login, logout } = useApp();
  const [form,     setForm]     = useState({ username: '', password: '' });
  const [showPass, setShowPass] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  // Keep dark-mode class in sync (portal inherits root theme)
  useEffect(() => {
    const stored = localStorage.getItem('pk_theme');
    document.documentElement.classList.toggle('dark', stored === 'dark');
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    if (!form.username || !form.password) return setError('यूज़रनेम और पासवर्ड दर्ज करें');
    setLoading(true); setError('');
    try {
      const u = await api.reporterLogin(form.username, form.password);
      login(u); // updates AppContext so Field.jsx gets the user
    } catch (err) {
      const msg = err.message || '';
      setError(msg.includes('401') || msg.includes('400') ? 'गलत यूज़रनेम या पासवर्ड' : 'लॉगिन नहीं हो सका');
    } finally { setLoading(false); }
  }

  // ── Logged-in view ────────────────────────────────────────────────────────
  if (user) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        {/* Minimal top bar — no sidebar, no main nav */}
        <div className="sticky top-0 z-40 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="max-w-2xl mx-auto px-4 h-12 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radio size={16} className="text-emerald-600" />
              <span className="text-sm font-bold text-gray-800 dark:text-gray-100">फील्ड पोर्टल</span>
              <span className="text-xs text-gray-400 hidden sm:inline">· {user.name}</span>
            </div>
            <button
              onClick={() => { logout(); localStorage.removeItem('field_active_visit'); }}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <LogOut size={13} /> लॉगआउट
            </button>
          </div>
        </div>

        {/* Field component in a centered, mobile-friendly container */}
        <div className="max-w-2xl mx-auto px-3 py-4">
          <Field />
        </div>
      </div>
    );
  }

  // ── Login view ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-700 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-white/20 backdrop-blur rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-4xl">📡</span>
          </div>
          <h1 className="text-3xl font-bold text-white">फील्ड पोर्टल</h1>
          <p className="text-emerald-100 text-sm mt-1">Patrika Field Reporter Login</p>
        </div>

        {/* Login card */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 space-y-5">
          <h2 className="text-base font-semibold text-gray-700 dark:text-gray-200 text-center">
            अपने credentials से लॉगिन करें
          </h2>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1.5">यूज़रनेम</label>
              <input
                type="text"
                autoComplete="username"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                placeholder="username"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1.5">पासवर्ड</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 pr-11 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  {showPass ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 rounded-xl px-4 py-3 text-sm text-center">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-bold rounded-xl text-base transition-colors shadow-sm"
            >
              {loading
                ? <><Loader2 size={18} className="animate-spin" /> लॉगिन हो रहा है…</>
                : '🔐 लॉगिन करें'}
            </button>
          </form>

          <p className="text-center text-xs text-gray-400 dark:text-gray-500 pt-1">
            केवल अधिकृत फील्ड स्टाफ के लिए
          </p>
        </div>

        <p className="text-center text-emerald-200 text-xs mt-6">
          Patrika Newsroom · Field Reporting Portal
        </p>
      </div>
    </div>
  );
}

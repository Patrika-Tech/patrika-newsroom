import { useState, useRef } from 'react';
import { Sparkles, Send, Brain } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { api }   from '../api/client.js';
import { PageHeader, SectionCard } from '../components/UI.jsx';

const INITIAL_CHIPS = [
  'Kal sabse zyada stories kisne file ki?',
  'Is hafte kaunsi state mein QC mistakes zyada hue?',
  'Zero stories reporters yesterday',
  'Top 5 reporters last 7 days',
  'Field visits count this week',
  'Most active branch this month',
];

export default function AiInsights() {
  const { t, state, branch } = useApp();

  const [msgs,  setMsgs]  = useState([{
    role: 'ai',
    text: 'Namaste! Main Patrika ka AI assistant hoon. Reporters, editions, QC, field visits — kuch bhi poochh sakte hain.',
  }]);
  const [input, setInput] = useState('');
  const [busy,  setBusy]  = useState(false);
  const [chips, setChips] = useState(INITIAL_CHIPS);
  const chatEnd = useRef(null);

  const subtitle = [state !== 'All' ? state : null, branch !== 'All' ? branch : null]
    .filter(Boolean).join(' › ') || 'All States';

  const ask = async (text) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setMsgs(m => [...m, { role: 'user', text: q }]);
    setInput('');
    setBusy(true);
    try {
      const r = await api.aiAssistant(q);
      setMsgs(m => [...m, { role: 'ai', text: r.answer }]);
      if (r.suggestions?.length) setChips(r.suggestions);
    } catch {
      setMsgs(m => [...m, { role: 'ai', text: 'Sorry, kuch error hua. Please try again.' }]);
    } finally {
      setBusy(false);
      chatEnd.current?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div>
      <PageHeader title={t('nav.ai') || 'AI Insights'} subtitle={subtitle} />

      {/* ── AI Chat ─────────────────────────────────────────────────────────── */}
      <SectionCard
        title={
          <span className="flex items-center gap-1.5">
            <Sparkles size={14} className="text-patrika-gold" />
            AI Newsroom Chat
          </span>
        }
      >
        <div className="flex flex-col" style={{ height: 420 }}>
          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className="max-w-[80%] rounded-2xl px-3.5 py-2 text-sm"
                  style={m.role === 'user'
                    ? { background: 'var(--brand)', color: '#fff' }
                    : { background: 'var(--bg)',    color: 'var(--text)' }}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="rounded-2xl px-3.5 py-2 text-xs" style={{ background: 'var(--bg)', color: 'var(--muted)' }}>
                  Soch raha hoon…
                </div>
              </div>
            )}
            <div ref={chatEnd} />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {chips.slice(0, 4).map(c => (
              <button
                key={c}
                className="pill text-xs"
                style={{ background: 'var(--bg)', color: 'var(--text)' }}
                onClick={() => ask(c)}
                disabled={busy}
              >
                {c}
              </button>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <input
              className="input"
              placeholder="Kuch bhi poochh — reporters, editions, QC…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && ask()}
              disabled={busy}
            />
            <button className="btn-primary" onClick={() => ask()} disabled={busy || !input.trim()}>
              <Send size={16} />
            </button>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

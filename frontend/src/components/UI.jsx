import logo from '/patrika-logo.png';

export function Logo({ size = 36, withText = true }) {
  return (
    <div className="flex items-center gap-2">
      <img src={logo} alt="Patrika" style={{ height: size }} className="object-contain" />
      {withText && (
        <span className="hidden sm:block font-semibold leading-tight">
          Newsroom<br /><span className="text-[10px] uppercase tracking-widest text-patrika-gold">Intelligence</span>
        </span>
      )}
    </div>
  );
}

export function KPICard({ label, value, sub, accent = '#d71920', icon: Icon, onClick }) {
  return (
    <div className="card p-4 animate-rise" onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className="flex items-start justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>{label}</span>
        {Icon && <span className="rounded-lg p-1.5" style={{ background: accent + '1a', color: accent }}><Icon size={16} /></span>}
      </div>
      <div className="mt-2 text-3xl font-bold" style={{ fontFamily: 'Roboto, sans-serif' }}>{value}</div>
      {sub && <div className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>{sub}</div>}
    </div>
  );
}

export function SectionCard({ title, action, children, className = '' }) {
  return (
    <div className={`card p-4 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

const sevColor = { high: '#d71920', med: '#C9A227', low: '#3b82f6', warn: '#C9A227', late: '#d71920', ok: '#16a34a', active: '#d71920' };
export function Badge({ children, tone = 'low' }) {
  const c = sevColor[tone] || '#6b7280';
  return <span className="pill" style={{ background: c + '1f', color: c }}>{children}</span>;
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'Roboto, sans-serif' }}>{title}</h1>
        {subtitle && <p className="text-sm" style={{ color: 'var(--muted)' }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

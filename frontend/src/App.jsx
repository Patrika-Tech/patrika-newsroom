import { Component } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useApp } from './context/AppContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Editorial from './pages/Editorial.jsx';
import Production from './pages/Production.jsx';
import PageMonitoring from './pages/PageMonitoring.jsx';
import Hr from './pages/Hr.jsx';
import Legal from './pages/Legal.jsx';
import Archive from './pages/Archive.jsx';
import AiInsights from './pages/AiInsights.jsx';
import Alerts from './pages/Alerts.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
import Feedback from './pages/Feedback.jsx';
import Tasks    from './pages/Tasks.jsx';
import Field         from './pages/Field.jsx';
import FieldPortal   from './pages/FieldPortal.jsx';
import Correspondent  from './pages/Correspondent.jsx';
import NewsGenerator  from './pages/NewsGenerator.jsx';

// ── Error Boundary — shows the crash message instead of blank screen ──────────
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: 'Roboto, sans-serif' }}>
          <h2 style={{ color: '#d71920' }}>⚠ App Error</h2>
          <p style={{ marginTop: 8 }}><strong>Message:</strong> {this.state.error.message}</p>
          <pre style={{ marginTop: 12, background: '#f5f5f5', padding: 16, borderRadius: 8, fontSize: 12, overflow: 'auto' }}>
            {this.state.error.stack}
          </pre>
          <button
            style={{ marginTop: 16, padding: '8px 16px', background: '#d71920', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
            onClick={() => { localStorage.clear(); window.location.href = '/login'; }}
          >
            Clear session &amp; go to Login
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// First accessible route per role — used as the post-login landing page
const ROLE_HOME = { Legal: '/legal' };
function roleHome(user) { return ROLE_HOME[user?.role] || '/'; }

// ── Route guard ───────────────────────────────────────────────────────────────
function Guard({ accessKey, children }) {
  const { user, canAccess } = useApp();
  const loc = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: loc }} replace />;
  // If user lacks access to this route, send them to their role's landing page.
  // Check home access explicitly (old code skipped 'home' to avoid "/" → "/" loops,
  // but that let Legal users see the dashboard).
  if (accessKey && !canAccess(accessKey)) {
    const home = roleHome(user);
    // Avoid redirect loop: if we're already at the fallback, just render it.
    if (loc.pathname !== home) return <Navigate to={home} replace />;
  }
  return <Layout>{children}</Layout>;
}

export default function App() {
  const { user } = useApp();
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login"    element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/reporter" element={<FieldPortal />} />
        <Route path="/"          element={<Guard accessKey="home">       <Dashboard />     </Guard>} />
        <Route path="/editorial" element={<Guard accessKey="editorial">  <Editorial />     </Guard>} />
        <Route path="/production"element={<Guard accessKey="production"> <Production />    </Guard>} />
        <Route path="/pages"     element={<Guard accessKey="pages">      <PageMonitoring /></Guard>} />
        <Route path="/field"     element={<Guard accessKey="field">      <Field />         </Guard>} />
        <Route path="/hr"        element={<Guard accessKey="hr">         <Hr />            </Guard>} />
        <Route path="/legal"     element={<Guard accessKey="legal">      <Legal />         </Guard>} />
        <Route path="/archive"   element={<Guard accessKey="archive">    <Archive />       </Guard>} />
        <Route path="/ai"        element={<Guard accessKey="ai">         <AiInsights />    </Guard>} />
        <Route path="/alerts"    element={<Guard accessKey="alerts">     <Alerts />        </Guard>} />
        <Route path="/reports"   element={<Guard accessKey="reports">    <Reports />       </Guard>} />
        <Route path="/settings"  element={<Guard accessKey="settings">   <Settings />      </Guard>} />
        <Route path="/feedback"  element={<Guard accessKey="feedback">   <Feedback />      </Guard>} />
        <Route path="/tasks"          element={<Guard accessKey="tasks">         <Tasks />         </Guard>} />
        <Route path="/correspondent"  element={<Guard accessKey="correspondent"><Correspondent />  </Guard>} />
        <Route path="/news-generator" element={<Guard accessKey="news-generator"><NewsGenerator /> </Guard>} />
        <Route path="*"          element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}

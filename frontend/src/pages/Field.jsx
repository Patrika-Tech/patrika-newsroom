import { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { api, API_BASE } from '../api/client.js';
import {
  MapPin, Navigation, Send, RefreshCw, Clock,
  ChevronDown, ChevronUp, Loader2, AlertTriangle,
  CheckCircle2, AlertCircle, ExternalLink, Camera,
  Sparkles, Copy, Check, RotateCcw, Newspaper, Upload, FileText, Image, File,
} from 'lucide-react';

// ── Constants ─────────────────────────────────────────────────────────────────
const STORY_TYPES = [
  'लीड स्टोरी', 'ब्रेकिंग न्यूज', 'एक्सक्लूसिव', 'स्पेशल रिपोर्ट',
  'फीचर', 'इंटरव्यू', 'विश्लेषण', 'इवेंट कवरेज',
  'जांच रिपोर्ट', 'राजनीति', 'खेल', 'क्राइम',
  'एंटरटेनमेंट', 'धर्म-अध्यात्म', 'सामान्य',
];

const STATUS_CONFIG = {
  submitted:    { label: 'सबमिट',       bg: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  under_review: { label: 'समीक्षा में', bg: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300' },
  approved:     { label: 'स्वीकृत',     bg: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  rejected:     { label: 'अस्वीकृत',    bg: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  published:    { label: 'प्रकाशित',     bg: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
};

const TRANSPORT_OPTS = [
  { value: 'car',   label: 'कार',    emoji: '🚗' },
  { value: 'bike',  label: 'बाइक',   emoji: '🏍️' },
  { value: 'auto',  label: 'ऑटो',    emoji: '🛺' },
  { value: 'bus',   label: 'बस',     emoji: '🚌' },
  { value: 'train', label: 'ट्रेन',  emoji: '🚆' },
  { value: 'foot',  label: 'पैदल',   emoji: '🚶' },
  { value: 'metro', label: 'मेट्रो', emoji: '🚇' },
  { value: 'other', label: 'अन्य',   emoji: '🚕' },
];

const PURPOSE_OPTS = [
  'कवरेज', 'विशेष रिपोर्टिंग', 'प्रेस कांफ्रेंस', 'इवेंट',
  'इंटरव्यू', 'सोर्स मीटिंग', 'जांच', 'फोटो कवरेज',
  'बैठक', 'दफ्तरी काम', 'अन्य',
];

// ── Geo helpers ───────────────────────────────────────────────────────────────
function getDistanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function captureGPS() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('GPS उपलब्ध नहीं'));

    let best    = null;
    let watchId = null;
    const GOOD_ENOUGH = 30;   // metres — accept immediately (satellite-quality fix)
    const MAX_WAIT    = 30000; // wait up to 30s for a good fix

    const done = () => {
      if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
      if (best) resolve(best);
      else reject(new Error('GPS उपलब्ध नहीं — Location/GPS चालू करें'));
    };

    const timer = setTimeout(done, MAX_WAIT);

    watchId = navigator.geolocation.watchPosition(
      pos => {
        const fix = {
          lat:      pos.coords.latitude,
          lon:      pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
        };
        if (!best || fix.accuracy < best.accuracy) best = fix;
        if (fix.accuracy <= GOOD_ENOUGH) { clearTimeout(timer); done(); }
      },
      e => {
        if (best) { clearTimeout(timer); done(); return; }
        clearTimeout(timer);
        if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
        if (e.code === 1) reject(new Error('GPS अनुमति नहीं — Settings → Apps → फील्ड पोर्टल → Permissions → Location → Allow'));
        else reject(new Error('GPS उपलब्ध नहीं — Location/GPS चालू करें'));
      },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
    );
  });
}

async function reverseGeocode(lat, lon) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1&accept-language=hi,en`
    );
    const d = await r.json();
    const a = d.address || {};
    const nearby = [
      a.amenity, a.building, a.shop,
      a.road || a.pedestrian,
      a.neighbourhood || a.suburb,
      a.city || a.town || a.village,
    ].filter(Boolean);
    return { address: d.display_name || '', nearby: [...new Set(nearby)].slice(0, 5) };
  } catch { return { address: '', nearby: [] }; }
}

async function checkHindiGrammar(text) {
  if (!text || text.trim().length < 10) return [];
  try {
    const r = await fetch('https://api.languagetool.org/v2/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ text, language: 'hi' }),
    });
    const d = await r.json();
    return (d.matches || []).map(m => ({
      offset:      m.offset,
      length:      m.length,
      message:     m.message,
      wrong:       text.slice(m.offset, m.offset + m.length),
      suggestions: (m.replacements || []).slice(0, 3).map(s => s.value),
    }));
  } catch { return []; }
}

function countWords(text) {
  return text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}

function fmt(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleString('hi-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

function findClusters(visits) {
  const n = visits.length;
  if (n < 2) return [];
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(i) { return parent[i] === i ? i : (parent[i] = find(parent[i])); }
  function union(i, j) { parent[find(i)] = find(j); }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const la1 = visits[i].checkin_lat, la2 = visits[j].checkin_lat;
      if (!la1 || !la2) continue;
      if (getDistanceM(+la1, +visits[i].checkin_lon, +la2, +visits[j].checkin_lon) <= 100)
        union(i, j);
    }
  }
  const map = {};
  for (let i = 0; i < n; i++) {
    const root = find(i);
    (map[root] = map[root] || []).push(visits[i]);
  }
  return Object.values(map).filter(g => g.length >= 2);
}

// ── GPS status pill ───────────────────────────────────────────────────────────
function GpsBlock({ gps, loading, error, onCapture, label = 'GPS कैप्चर करें' }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-700/40 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
          <MapPin size={15} className="text-emerald-600" /> GPS स्थान
        </span>
        <button
          onClick={onCapture}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Navigation size={12} />}
          {gps ? 'रिफ्रेश' : label}
        </button>
      </div>
      {loading && <p className="text-xs text-gray-500 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> GPS सिग्नल खोज रहे हैं…</p>}
      {error && <p className="text-xs text-red-500 flex items-center gap-1.5"><AlertCircle size={12} /> {error}</p>}
      {gps && !loading && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            ✅ {gps.lat.toFixed(6)}°N, {gps.lon.toFixed(6)}°E
            <span className="font-normal text-gray-400 ml-1">(±{gps.accuracy}मी)</span>
          </p>
          {gps.address && <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{gps.address}</p>}
          {gps.nearby?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {gps.nearby.map((p, i) => (
                <span key={i} className="text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full">{p}</span>
              ))}
            </div>
          )}
          <a
            href={`https://www.google.com/maps?q=${gps.lat},${gps.lon}`}
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mt-0.5"
          >
            <ExternalLink size={10} /> Google Maps में देखें
          </a>
        </div>
      )}
      {!gps && !loading && !error && (
        <p className="text-xs text-gray-400">स्टोरी के साथ लोकेशन जोड़ने के लिए बटन दबाएं</p>
      )}
    </div>
  );
}

// ── Main Field page ───────────────────────────────────────────────────────────
export default function Field() {
  const { user } = useApp();
  const [tab, setTab] = useState('story');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-2xl p-6 text-white shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center text-2xl shrink-0">📡</div>
          <div>
            <h1 className="text-2xl font-bold">फील्ड रिपोर्टिंग</h1>
            <p className="text-emerald-100 text-sm mt-0.5">स्टोरी सबमिट करें · फील्ड विजिट · न्यूज़ जनरेटर</p>
          </div>
        </div>
        {user?.name && (
          <div className="mt-3 flex items-center gap-2 text-emerald-100 text-sm">
            <span className="w-6 h-6 bg-white/30 rounded-full flex items-center justify-center text-xs font-bold shrink-0">
              {(user.name[0] || 'U').toUpperCase()}
            </span>
            {user.name}
            {user.state ? ` · ${user.state}` : ''}
            {user.branch ? ` · ${user.branch}` : ''}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-white dark:bg-gray-800 rounded-xl p-1 shadow-sm border border-gray-100 dark:border-gray-700">
        {[
          { key: 'story', label: 'स्टोरी सबमिशन', emoji: '📰' },
          { key: 'visit', label: 'फील्ड विजिट',    emoji: '📍' },
          { key: 'news',  label: 'न्यूज़ जनरेटर',   emoji: '✨' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-xs font-medium transition-all
              ${tab === t.key ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          >
            <span>{t.emoji}</span> {t.label}
          </button>
        ))}
      </div>

      {tab === 'story' && <StoryTab user={user} />}
      {tab === 'visit' && <VisitTab user={user} />}
      {tab === 'news'  && <NewsGeneratorTab />}
    </div>
  );
}

// ── Story Submission Tab ──────────────────────────────────────────────────────
function StoryTab({ user }) {
  const [form, setForm] = useState({ story_type: '', headline: '', content: '' });
  const [gps, setGps]   = useState(null);
  const [gpsLoad, setGpsLoad] = useState(false);
  const [gpsErr,  setGpsErr]  = useState('');
  const [files,    setFiles]    = useState([]);       // File objects
  const [previews, setPreviews] = useState([]);       // { url, name, type }
  const [uploading, setUploading] = useState(false);
  const [grammar,  setGrammar]   = useState([]);
  const [gramLoad, setGramLoad]  = useState(false);
  const [gramChecked, setGramChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast]  = useState('');
  const [stories, setStories] = useState([]);
  const [storLoad, setStorLoad] = useState(false);
  const [expanded,     setExpanded]     = useState(null);
  const [editingStory, setEditingStory] = useState(null); // story being edited
  const [editingImg,   setEditingImg]   = useState(null); // { idx, file, preview }
  const fileRef = useRef();

  const words = countWords(form.content);

  useEffect(() => { loadStories(); handleGps(); }, []);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function loadStories() {
    setStorLoad(true);
    try { const d = await api.fieldStories({ mine: '1' }); setStories(d.stories || []); }
    catch { /* silent */ }
    finally { setStorLoad(false); }
  }

  async function handleGps() {
    setGpsLoad(true); setGpsErr('');
    try { const pos = await captureGPS(); const geo = await reverseGeocode(pos.lat, pos.lon); setGps({ ...pos, ...geo }); }
    catch (e) { setGpsErr(e.message); }
    finally { setGpsLoad(false); }
  }

  function handleFileChange(e) {
    const selected = Array.from(e.target.files || []);
    setFiles(prev => [...prev, ...selected]);
    selected.forEach(f => {
      const type = f.type.split('/')[0];
      const url  = type === 'image' ? URL.createObjectURL(f) : null;
      setPreviews(prev => [...prev, { url, name: f.name, type }]);
    });
  }

  function removeFile(i) {
    if (previews[i]?.url) URL.revokeObjectURL(previews[i].url);
    setFiles(f => f.filter((_, j) => j !== i));
    setPreviews(p => p.filter((_, j) => j !== i));
  }

  async function handleGrammar() {
    if (!form.content.trim()) return;
    setGramLoad(true); setGrammar([]); setGramChecked(false);
    try { const m = await checkHindiGrammar(form.content); setGrammar(m); setGramChecked(true); }
    finally { setGramLoad(false); }
  }

  function applyFix(match, suggestion) {
    const c = form.content;
    set('content', c.slice(0, match.offset) + suggestion + c.slice(match.offset + match.length));
    setGrammar([]); setGramChecked(false);
  }

  function handleEdit(story) {
    setEditingStory(story);
    setForm({ story_type: story.story_type || '', headline: story.headline || '', content: story.content || '' });
    setFiles([]); setPreviews([]); setGrammar([]); setGramChecked(false); setGps(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingStory(null);
    setForm({ story_type: '', headline: '', content: '' });
    setFiles([]); setPreviews([]); setGrammar([]); setGramChecked(false); setGps(null);
  }

  async function handleSubmit() {
    if (!form.headline.trim()) return alert('कृपया हेडलाइन दर्ज करें');
    if (!form.content.trim())  return alert('कृपया स्टोरी कंटेंट दर्ज करें');
    setSubmitting(true);
    try {
      let uploadedFiles = [];
      if (files.length > 0) {
        setUploading(true);
        const fd = new FormData();
        files.forEach(f => fd.append('files', f));
        const up = await api.uploadFieldFiles(fd);
        // Merge captions from previews into uploaded file objects
        uploadedFiles = (up.files || []).map((f, i) => ({
          ...f,
          caption: previews[i]?.caption || '',
        }));
        setUploading(false);
      }

      const payload = {
        story_type:       form.story_type || 'सामान्य',
        headline:         form.headline,
        content:          form.content,
        word_count:       words,
        files:            uploadedFiles,
        latitude:         gps?.lat,
        longitude:        gps?.lon,
        location_address: gps?.address || '',
      };

      if (editingStory) {
        await api.updateFieldStory(editingStory.id, payload);
        setToast('✅ स्टोरी सफलतापूर्वक अपडेट हो गई!');
        setEditingStory(null);
      } else {
        await api.submitFieldStory({ reporter_name: user?.name, ...payload });
        setToast('✅ स्टोरी सफलतापूर्वक सबमिट हो गई! 🎉');
      }
      setForm({ story_type: '', headline: '', content: '' });
      setGps(null); setFiles([]); setPreviews([]); setGrammar([]); setGramChecked(false);
      setTimeout(() => setToast(''), 4000);
      loadStories();
    } catch (e) { alert('सबमिट नहीं हो सका: ' + e.message); }
    finally { setSubmitting(false); setUploading(false); }
  }

  return (
    <div className="space-y-4">
      {/* Form card */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
            {editingStory ? '✏️ स्टोरी संपादित करें' : '📰 नई स्टोरी सबमिट करें'}
          </h2>
          {editingStory && (
            <button
              onClick={cancelEdit}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-500 transition-colors border border-gray-200 dark:border-gray-600 rounded-lg px-2.5 py-1"
            >
              ✕ रद्द करें
            </button>
          )}
        </div>
        <div className="p-5 space-y-5">

          {/* Story type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">स्टोरी प्रकार</label>
            <select
              value={form.story_type}
              onChange={e => set('story_type', e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
            >
              <option value="">-- स्टोरी टाइप चुनें --</option>
              {STORY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Headline */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              हेडलाइन <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.headline}
              onChange={e => set('headline', e.target.value)}
              placeholder="स्टोरी की हेडलाइन यहाँ लिखें…"
              lang="hi"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base"
              style={{ fontFamily: '"Noto Sans Devanagari", "Mangal", sans-serif' }}
            />
          </div>

          {/* Content */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                स्टोरी कंटेंट <span className="text-red-500">*</span>
              </label>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${words < 50 ? 'bg-red-100 text-red-600' : words < 200 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                {words} शब्द
              </span>
            </div>
            <textarea
              value={form.content}
              onChange={e => { set('content', e.target.value); setGrammar([]); setGramChecked(false); }}
              placeholder="स्टोरी का पूरा विवरण यहाँ लिखें… (हिंदी या अंग्रेजी)"
              lang="hi"
              spellCheck
              rows={10}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-base leading-relaxed resize-y"
              style={{ fontFamily: '"Noto Sans Devanagari", "Mangal", sans-serif' }}
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-gray-400">{form.content.length} अक्षर</span>
              <button
                onClick={handleGrammar}
                disabled={gramLoad || !form.content.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-100 disabled:opacity-40 transition-colors"
              >
                {gramLoad ? <Loader2 size={12} className="animate-spin" /> : '🔤'} व्याकरण जांच
              </button>
            </div>
          </div>

          {/* Grammar results */}
          {gramChecked && grammar.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl p-3">
              <CheckCircle2 size={16} /> कोई व्याकरण त्रुटि नहीं मिली
            </div>
          )}
          {grammar.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200 text-sm font-semibold">
                <AlertTriangle size={15} /> {grammar.length} व्याकरण सुझाव
              </div>
              {grammar.map((m, i) => (
                <div key={i} className="bg-white dark:bg-gray-800 rounded-lg p-3 text-sm border border-amber-100 dark:border-amber-800">
                  <div className="flex flex-wrap items-start gap-2">
                    <span className="bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 px-2 py-0.5 rounded font-medium">"{m.wrong}"</span>
                    <span className="text-gray-600 dark:text-gray-400 flex-1 text-xs">{m.message}</span>
                  </div>
                  {m.suggestions.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <span className="text-xs text-gray-500">सुझाव:</span>
                      {m.suggestions.map((s, j) => (
                        <button
                          key={j}
                          onClick={() => applyFix(m, s)}
                          className="px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-md hover:bg-green-200 font-semibold transition-colors"
                        >
                          ✓ {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* GPS */}
          <GpsBlock gps={gps} loading={gpsLoad} error={gpsErr} onCapture={handleGps} />

          {/* File upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">📸 मीडिया अटैच करें</label>
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-gray-200 dark:border-gray-600 rounded-xl p-5 text-center cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/30 dark:hover:bg-emerald-900/10 transition-colors"
            >
              <Camera size={24} className="mx-auto text-gray-300 mb-1" />
              <p className="text-sm text-gray-500">फोटो, वीडियो या ऑडियो जोड़ें</p>
              <p className="text-xs text-gray-400 mt-0.5">अधिकतम 100MB प्रति फ़ाइल</p>
            </div>
            <input ref={fileRef} type="file" multiple accept="image/*,video/*,audio/*" onChange={handleFileChange} className="hidden" />
            {previews.length > 0 && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
                {previews.map((p, i) => (
                  <div key={i} className="group">
                    <div className="relative aspect-square rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
                      {p.type === 'image' && p.url
                        ? <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
                        : (
                          <div className="flex flex-col items-center justify-center h-full p-2">
                            <span className="text-2xl">{p.type === 'audio' ? '🎵' : p.type === 'video' ? '🎬' : '📄'}</span>
                            <span className="text-xs text-gray-500 mt-1 truncate w-full text-center">{p.name}</span>
                          </div>
                        )
                      }
                      {/* Edit button — only for images */}
                      {p.type === 'image' && p.url && (
                        <button
                          onClick={() => setEditingImg({ idx: i, file: files[i], preview: p })}
                          className="absolute top-1 left-1 w-6 h-6 bg-purple-600 text-white rounded-full text-xs flex items-center justify-center shadow-md"
                          title="फोटो संपादित करें"
                        >✏️</button>
                      )}
                      <button
                        onClick={() => removeFile(i)}
                        className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >✕</button>
                    </div>
                    <input
                      type="text"
                      value={p.caption || ''}
                      onChange={e => setPreviews(prev => prev.map((pr, j) => j === i ? { ...pr, caption: e.target.value } : pr))}
                      placeholder="कैप्शन लिखें…"
                      lang="hi"
                      className="mt-1.5 w-full text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      style={{ fontFamily: '"Noto Sans Devanagari", sans-serif' }}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Image editor modal */}
            {editingImg && (
              <ImageEditorModal
                file={editingImg.file}
                preview={editingImg.preview}
                onSave={(editedFile, editedUrl) => {
                  setFiles(f => f.map((fi, i) => i === editingImg.idx ? editedFile : fi));
                  setPreviews(p => p.map((pr, i) => i === editingImg.idx ? { ...pr, url: editedUrl } : pr));
                  setEditingImg(null);
                }}
                onClose={() => setEditingImg(null)}
              />
            )}
          </div>

          {/* Toast */}
          {toast && (
            <div className="flex items-center gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 text-green-700 dark:text-green-300 rounded-xl p-4 text-sm font-medium">
              <CheckCircle2 size={18} /> {toast}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={submitting || uploading}
            className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white font-semibold rounded-xl text-base transition-colors shadow-sm"
          >
            {submitting || uploading
              ? <><Loader2 size={18} className="animate-spin" /> {uploading ? 'फ़ाइल अपलोड हो रही है…' : editingStory ? 'अपडेट हो रहा है…' : 'सबमिट हो रहा है…'}</>
              : <><Send size={18} /> {editingStory ? 'स्टोरी अपडेट करें' : 'स्टोरी सबमिट करें'}</>
            }
          </button>
        </div>
      </div>

      {/* My submissions */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">📋 मेरी सबमिशन</h2>
          <button onClick={loadStories} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <RefreshCw size={14} className={storLoad ? 'animate-spin text-gray-400' : 'text-gray-400'} />
          </button>
        </div>
        <div className="divide-y divide-gray-50 dark:divide-gray-700/60">
          {stories.length === 0 && !storLoad && (
            <p className="text-center text-gray-400 py-10 text-sm">अभी तक कोई स्टोरी सबमिट नहीं की गई</p>
          )}
          {stories.map(s => {
            const cfg = STATUS_CONFIG[s.status] || STATUS_CONFIG.submitted;
            const open = expanded === s.id;
            return (
              <div key={s.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3 cursor-pointer" onClick={() => setExpanded(open ? null : s.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${cfg.bg}`}>{cfg.label}</span>
                      {s.story_type && <span className="text-xs text-gray-400">{s.story_type}</span>}
                    </div>
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate"
                      style={{ fontFamily: '"Noto Sans Devanagari", sans-serif' }}>{s.headline}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{fmt(s.submitted_at)} · {s.word_count || 0} शब्द</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {['submitted', 'rejected'].includes(s.status) && (
                      <button
                        onClick={e => { e.stopPropagation(); handleEdit(s); }}
                        title="संपादित करें"
                        className="p-1.5 rounded-lg text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors text-sm"
                      >✏️</button>
                    )}
                    <span className="text-gray-400 mt-0.5">{open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
                  </div>
                </div>
                {open && (
                  <div className="mt-3 space-y-2 pt-3 border-t border-gray-50 dark:border-gray-700">
                    {s.content && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-wrap"
                        style={{ fontFamily: '"Noto Sans Devanagari", sans-serif' }}>
                        {s.content.slice(0, 400)}{s.content.length > 400 ? '…' : ''}
                      </p>
                    )}
                    {s.location_address && (
                      <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                        <MapPin size={11} /> {s.location_address.split(',').slice(0, 3).join(',')}
                      </p>
                    )}
                    {s.notes && (
                      <div className="bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 text-xs rounded-lg p-2.5 border border-yellow-200 dark:border-yellow-800">
                        <strong>संपादक नोट:</strong> {s.notes}
                      </div>
                    )}
                    {(() => {
                      try {
                        const fl = JSON.parse(s.files || '[]');
                        if (!fl.length) return null;
                        return (
                          <div className="flex flex-wrap gap-2">
                            {fl.map((f, i) => (
                              <div key={i} className="flex flex-col gap-0.5">
                                <a href={f.url} target="_blank" rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-1 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600">
                                  {f.mimetype?.startsWith('image') ? '🖼️' : f.mimetype?.startsWith('video') ? '🎬' : '🎵'} {f.name}
                                </a>
                                {f.caption && (
                                  <span className="text-xs text-gray-500 dark:text-gray-400 px-1 italic"
                                    style={{ fontFamily: '"Noto Sans Devanagari", sans-serif' }}>
                                    {f.caption}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        );
                      } catch { return null; }
                    })()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Duration formatter ────────────────────────────────────────────────────────
function fmtDur(minutes) {
  if (!minutes && minutes !== 0) return '—';
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (h > 0) return `${h} घंटे ${m} मिनट`;
  return `${m} मिनट`;
}

function fmtTime(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleTimeString('hi-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}

// ── Visit Tab ─────────────────────────────────────────────────────────────────
function VisitTab({ user }) {
  // GPS
  const [gps,     setGps]     = useState(null);
  const [gpsLoad, setGpsLoad] = useState(true);
  const [gpsErr,  setGpsErr]  = useState('');

  // Check-in form (only shown when NOT already checked in)
  const [transport, setTransport] = useState('');
  const [purpose,   setPurpose]   = useState('');
  const [custom,    setCustom]    = useState('');

  // Active visit — persisted across page refresh in localStorage
  const [active,   setActive]   = useState(() => {
    try { return JSON.parse(localStorage.getItem('field_active_visit')); } catch { return null; }
  });
  const [elapsed,  setElapsed]  = useState('');

  // Operation flags
  const [checkingIn,  setCheckingIn]  = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [toast,       setToast]       = useState('');

  // History
  const [visits,   setVisits]   = useState([]);
  const [visLoad,  setVisLoad]  = useState(false);
  const [showClust,setShowClust]= useState(false);

  useEffect(() => { autoGps(); loadVisits(); }, []);

  // Live elapsed timer while checked in
  useEffect(() => {
    if (!active) { setElapsed(''); return; }
    const tick = () => {
      const mins = Math.floor((Date.now() - new Date(active.checkedInAt).getTime()) / 60000);
      setElapsed(fmtDur(mins));
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [active]);

  async function autoGps() {
    setGpsLoad(true); setGpsErr('');
    try { const p = await captureGPS(); const g = await reverseGeocode(p.lat, p.lon); setGps({ ...p, ...g }); }
    catch (e) { setGpsErr(e.message); }
    finally { setGpsLoad(false); }
  }

  async function loadVisits() {
    setVisLoad(true);
    try { const d = await api.fieldVisits({ mine: '1' }); setVisits(d.visits || []); }
    catch { /* silent */ }
    finally { setVisLoad(false); }
  }

  async function handleCheckIn() {
    if (!transport) return alert('यात्रा साधन चुनें');
    if (!purpose)   return alert('उद्देश्य चुनें');
    if (!gps)       return alert('GPS लोकेशन अभी तक नहीं मिली। कृपया प्रतीक्षा करें।');
    setCheckingIn(true);
    try {
      const r = await api.markFieldVisit({
        reporter_name:    user?.name,
        transport, purpose,
        custom_purpose:   custom,
        latitude:         gps.lat,
        longitude:        gps.lon,
        location_address: gps.address || '',
        nearby_places:    (gps.nearby || []).join(', '),
      });
      const av = {
        id:           r.id,
        transport, purpose,
        customPurpose: custom,
        checkedInAt:   new Date().toISOString(),
        address:       gps.address || '',
        lat: gps.lat, lon: gps.lon,
        nearby:        gps.nearby || [],
      };
      localStorage.setItem('field_active_visit', JSON.stringify(av));
      setActive(av);
      setTransport(''); setPurpose(''); setCustom('');
    } catch (e) { alert('चेक-इन नहीं हो सका: ' + e.message); }
    finally { setCheckingIn(false); }
  }

  async function handleCheckOut() {
    if (!active) return;
    setCheckingOut(true);
    try {
      // Try re-capturing GPS for checkout location
      let outGps = gps;
      try { const p = await captureGPS(); const g = await reverseGeocode(p.lat, p.lon); outGps = { ...p, ...g }; }
      catch { /* use last known GPS */ }

      const r = await api.checkOutVisit(active.id, {
        latitude:         outGps?.lat || active.lat,
        longitude:        outGps?.lon || active.lon,
        location_address: outGps?.address || active.address,
      });

      const dur = r.visit?.duration_minutes != null ? fmtDur(r.visit.duration_minutes) : elapsed;
      setToast(`✅ चेक-आउट हो गए! कुल समय: ${dur}`);
      localStorage.removeItem('field_active_visit');
      setActive(null);
      setTimeout(() => setToast(''), 5000);
      loadVisits();
    } catch (e) { alert('चेक-आउट नहीं हो सका: ' + e.message); }
    finally { setCheckingOut(false); }
  }

  const recent   = visits.slice(0, 10);
  const clusters = findClusters(visits);

  return (
    <div className="space-y-4">

      {/* ── Active visit banner (when checked in) ─── */}
      {active && (
        <div className="bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl p-5 text-white shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-green-100 uppercase tracking-wide mb-1">अभी चेक-इन है 🟢</p>
              <p className="text-lg font-bold">
                {TRANSPORT_OPTS.find(t => t.value === active.transport)?.emoji || '📍'} {active.purpose}
                {active.customPurpose ? ` · ${active.customPurpose}` : ''}
              </p>
              <p className="text-green-100 text-sm mt-0.5">
                {TRANSPORT_OPTS.find(t => t.value === active.transport)?.label || active.transport}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-3xl font-bold tabular-nums">{elapsed || '—'}</p>
              <p className="text-xs text-green-200 mt-0.5">
                चेक-इन: {fmtTime(active.checkedInAt)}
              </p>
            </div>
          </div>
          {active.address && (
            <p className="text-green-100 text-xs mt-2 leading-relaxed truncate">{active.address.split(',').slice(0, 3).join(',')}</p>
          )}
          {active.nearby?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {active.nearby.map((p, i) => (
                <span key={i} className="text-xs bg-white/20 px-2 py-0.5 rounded-full">{p}</span>
              ))}
            </div>
          )}
          <button
            onClick={handleCheckOut}
            disabled={checkingOut}
            className="mt-4 w-full flex items-center justify-center gap-2 py-3 bg-white text-emerald-700 hover:bg-green-50 font-bold rounded-xl text-base transition-colors shadow-sm"
          >
            {checkingOut ? <Loader2 size={18} className="animate-spin" /> : '🔴'}
            {checkingOut ? 'GPS कैप्चर हो रहा है…' : 'चेक-आउट करें'}
          </button>
        </div>
      )}

      {toast && (
        <div className="flex items-center gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 text-green-700 dark:text-green-300 rounded-xl p-4 text-sm font-medium">
          <CheckCircle2 size={18} /> {toast}
        </div>
      )}

      {/* ── GPS card ─── */}
      {!active && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20 px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2">
              <Navigation size={15} className="text-emerald-600" /> वर्तमान स्थान
            </h3>
            <button onClick={autoGps} className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300 hover:underline">
              <RefreshCw size={11} /> रिफ्रेश
            </button>
          </div>
          <div className="p-4">
            {gpsLoad && <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 size={15} className="animate-spin text-emerald-500" /> GPS सिग्नल खोज रहे हैं…</p>}
            {gpsErr && (
              <div className="flex items-center gap-2 text-sm text-red-500">
                <AlertCircle size={15} /> {gpsErr}
                <button onClick={autoGps} className="text-xs underline ml-1">पुनः प्रयास</button>
              </div>
            )}
            {gps && !gpsLoad && (
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                  ✅ {gps.lat.toFixed(6)}°N, {gps.lon.toFixed(6)}°E
                  <span className="font-normal text-gray-400 ml-1.5 text-xs">(±{gps.accuracy}मी)</span>
                </p>
                {gps.address && <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{gps.address}</p>}
                {gps.nearby?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {gps.nearby.map((p, i) => (
                      <span key={i} className="text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full">{p}</span>
                    ))}
                  </div>
                )}
                <a href={`https://www.google.com/maps?q=${gps.lat},${gps.lon}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                  <ExternalLink size={10} /> Google Maps में देखें
                </a>
              </div>
            )}
            {!gps && !gpsLoad && !gpsErr && (
              <p className="text-xs text-gray-400">GPS सिग्नल मिलने की प्रतीक्षा है…</p>
            )}
          </div>
        </div>
      )}

      {/* ── Check-in form (only when NOT checked in) ─── */}
      {!active && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 space-y-5">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">🟢 चेक-इन करें</h3>

          {/* Transport */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">🚗 यात्रा साधन</label>
            <div className="grid grid-cols-4 gap-2">
              {TRANSPORT_OPTS.map(t => (
                <button
                  key={t.value}
                  onClick={() => setTransport(t.value)}
                  className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border-2 transition-all
                    ${transport === t.value
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30'
                      : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'}`}
                >
                  <span className="text-xl">{t.emoji}</span>
                  <span className={`text-xs font-medium ${transport === t.value ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-600 dark:text-gray-400'}`}>{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Purpose */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">🎯 विजिट का उद्देश्य</label>
            <select
              value={purpose}
              onChange={e => setPurpose(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
            >
              <option value="">-- उद्देश्य चुनें --</option>
              {PURPOSE_OPTS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            {purpose === 'अन्य' && (
              <input
                value={custom}
                onChange={e => setCustom(e.target.value)}
                placeholder="उद्देश्य का विवरण लिखें…"
                className="mt-2 w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
              />
            )}
          </div>

          <button
            onClick={handleCheckIn}
            disabled={checkingIn || gpsLoad}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white font-bold rounded-xl text-base transition-colors shadow-sm"
          >
            {checkingIn ? <Loader2 size={18} className="animate-spin" /> : '🟢'}
            {checkingIn ? 'चेक-इन हो रहा है…' : gpsLoad ? 'GPS का इंतजार…' : 'चेक-इन करें'}
          </button>
        </div>
      )}

      {/* ── Check visits (clusters) ─── */}
      {clusters.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl overflow-hidden">
          <button
            onClick={() => setShowClust(s => !s)}
            className="w-full flex items-center justify-between px-5 py-4 text-left"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={17} className="text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                ⚠️ चेक विजिट — {clusters.length} क्लस्टर
              </span>
              <span className="text-xs text-amber-600 dark:text-amber-400">(100 मीटर में एकाधिक विजिट)</span>
            </div>
            {showClust ? <ChevronUp size={15} className="text-amber-600" /> : <ChevronDown size={15} className="text-amber-600" />}
          </button>
          {showClust && (
            <div className="px-5 pb-4 space-y-3">
              {clusters.map((group, gi) => (
                <div key={gi} className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-amber-100 dark:border-amber-800">
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-200 mb-2.5">
                    📍 {group.length} विजिट · एक ही स्थान के 100 मीटर के भीतर
                  </p>
                  <div className="space-y-2">
                    {group.map((v, vi) => {
                      const tr = TRANSPORT_OPTS.find(t => t.value === v.transport);
                      return (
                        <div key={vi} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                          <span className="w-1.5 h-1.5 bg-amber-400 rounded-full shrink-0" />
                          <span className="font-medium">{fmtTime(v.checked_in_at)}</span>
                          <span>·</span>
                          <span>{v.purpose}{v.custom_purpose ? ` (${v.custom_purpose})` : ''}</span>
                          <span>·</span>
                          <span>{tr?.emoji || ''} {tr?.label || v.transport}</span>
                        </div>
                      );
                    })}
                  </div>
                  {group[0].checkin_address && (
                    <p className="text-xs text-gray-400 mt-2 truncate">{group[0].checkin_address.split(',').slice(0, 3).join(',')}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Recent visits history ─── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <Clock size={16} /> हाल की 10 विजिट
          </h3>
          <button onClick={loadVisits} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <RefreshCw size={14} className={visLoad ? 'animate-spin text-gray-400' : 'text-gray-400'} />
          </button>
        </div>
        <div className="divide-y divide-gray-50 dark:divide-gray-700/60">
          {recent.length === 0 && !visLoad && (
            <p className="text-center text-gray-400 py-10 text-sm">कोई विजिट दर्ज नहीं</p>
          )}
          {recent.map(v => {
            const tr   = TRANSPORT_OPTS.find(t => t.value === v.transport);
            const open = !v.checked_out_at;
            return (
              <div key={v.id} className={`px-5 py-4 flex items-start gap-3 ${open ? 'bg-green-50/50 dark:bg-green-900/10' : ''}`}>
                <span className="text-2xl shrink-0 mt-0.5">{tr?.emoji || '📍'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{v.purpose}</span>
                    {v.custom_purpose && <span className="text-xs text-gray-400">({v.custom_purpose})</span>}
                    <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">
                      {tr?.label || v.transport}
                    </span>
                    {open && (
                      <span className="text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full font-semibold">
                        🟢 अभी चेक-इन है
                      </span>
                    )}
                  </div>

                  {/* In / Out timeline */}
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className="flex items-center gap-1 text-green-700 dark:text-green-400 font-semibold">
                      🟢 IN {fmtTime(v.checked_in_at)}
                    </span>
                    {fmt(v.checked_in_at) && (
                      <span className="text-gray-400">{fmt(v.checked_in_at).split(' ').slice(0, 3).join(' ')}</span>
                    )}
                  </div>
                  {v.checked_out_at && (
                    <div className="flex items-center gap-2 text-xs mt-0.5">
                      <span className="flex items-center gap-1 text-red-600 dark:text-red-400 font-semibold">
                        🔴 OUT {fmtTime(v.checked_out_at)}
                      </span>
                      <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full font-semibold">
                        ⏱ {fmtDur(v.duration_minutes)}
                      </span>
                    </div>
                  )}

                  {/* Location */}
                  {v.checkin_address && (
                    <p className="text-xs text-gray-500 mt-1 truncate">{v.checkin_address.split(',').slice(0, 3).join(',')}</p>
                  )}
                  {v.checkin_lat && (
                    <a href={`https://www.google.com/maps?q=${v.checkin_lat},${v.checkin_lon}`}
                      target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline mt-0.5">
                      <ExternalLink size={10} /> Maps
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Image Editor Modal ────────────────────────────────────────────────────────
function ImageEditorModal({ file, preview, onSave, onClose }) {
  const [tool,       setTool]       = useState('adjust');
  const [brightness, setBrightness] = useState(0);
  const [contrast,   setContrast]   = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [rotation,   setRotation]   = useState(0);
  const [hasCrop,    setHasCrop]    = useState(false);
  const [saving,     setSaving]     = useState(false);

  const canvasRef   = useRef();
  const containerRef= useRef();
  const imgEl       = useRef(null);
  // All hot state in refs — avoids stale closure issues in event handlers
  const adjRef      = useRef({ brightness: 0, contrast: 0, saturation: 0, rotation: 0 });
  const toolRef     = useRef('adjust');
  const cropRef     = useRef(null);   // {x,y,w,h} 0-1 relative to imgRect
  const imgRectRef  = useRef(null);   // {x,y,w,h} canvas-pixel rect where image is drawn
  const dragStart   = useRef(null);   // canvas px
  const dragCur     = useRef(null);   // canvas px
  const dragging    = useRef(false);

  // Sync state → refs → repaint
  useEffect(() => { adjRef.current = { brightness, contrast, saturation, rotation }; repaint(); },
    [brightness, contrast, saturation, rotation]);
  useEffect(() => { toolRef.current = tool; repaint(); }, [tool]);

  // Load image + size canvas once
  useEffect(() => {
    const img = new window.Image();
    img.onload = () => { imgEl.current = img; syncCanvasSize(); repaint(); };
    img.src = preview.url;
  }, []);

  // Watch container resize
  useEffect(() => {
    const ro = new ResizeObserver(() => { syncCanvasSize(); repaint(); });
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Make canvas pixel dims match its CSS display size
  function syncCanvasSize() {
    const cv = canvasRef.current, ct = containerRef.current;
    if (!cv || !ct) return;
    const w = ct.clientWidth  || ct.offsetWidth;
    const h = ct.clientHeight || ct.offsetHeight;
    if (w > 0 && (cv.width !== w))  cv.width  = w;
    if (h > 0 && (cv.height !== h)) cv.height = h;
  }

  // Where the image lands (letterboxed) in canvas pixel space
  function getImgRect(cw, ch) {
    const img = imgEl.current;
    if (!img) return { x: 0, y: 0, w: cw, h: ch };
    const { rotation: rot } = adjRef.current;
    const swap = rot === 90 || rot === 270;
    const iw   = swap ? img.naturalHeight : img.naturalWidth;
    const ih   = swap ? img.naturalWidth  : img.naturalHeight;
    const sc   = Math.min(cw / iw, ch / ih);
    const dw   = iw * sc, dh = ih * sc;
    return { x: (cw - dw) / 2, y: (ch - dh) / 2, w: dw, h: dh };
  }

  // Draw the image into ctx at the letterbox position
  function paintImg(ctx, ir) {
    const img = imgEl.current;
    if (!img) return;
    const { brightness: b0, contrast: c0, saturation: s0, rotation: rot } = adjRef.current;
    ctx.filter = `brightness(${(100+b0)/100}) contrast(${(100+c0)/100}) saturate(${(100+s0)/100})`;
    ctx.save();
    ctx.translate(ir.x + ir.w / 2, ir.y + ir.h / 2);
    ctx.rotate(rot * Math.PI / 180);
    ctx.drawImage(img, -img.naturalWidth / 2 * (ir.w / (rot===90||rot===270 ? img.naturalHeight : img.naturalWidth)),
                       -img.naturalHeight / 2 * (ir.h / (rot===90||rot===270 ? img.naturalWidth : img.naturalHeight)),
                        img.naturalWidth      * (ir.w / (rot===90||rot===270 ? img.naturalHeight : img.naturalWidth)),
                        img.naturalHeight     * (ir.h / (rot===90||rot===270 ? img.naturalWidth : img.naturalHeight)));
    ctx.restore();
    ctx.filter = 'none';
  }

  function repaint() {
    const cv = canvasRef.current;
    if (!cv || !imgEl.current) return;
    const cw = cv.width, ch = cv.height;
    if (!cw || !ch) return;

    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);

    const ir = getImgRect(cw, ch);
    imgRectRef.current = ir;
    paintImg(ctx, ir);

    if (toolRef.current !== 'crop') return;

    // Live drag rect (canvas px) → normalized to imgRect
    let cr = cropRef.current;
    if (dragging.current && dragStart.current && dragCur.current) {
      const s = dragStart.current, e = dragCur.current;
      const rx = Math.min(s.x, e.x), ry = Math.min(s.y, e.y);
      const rw = Math.abs(e.x - s.x), rh = Math.abs(e.y - s.y);
      if (rw > 5 && rh > 5) {
        cr = {
          x: Math.max(0, (rx - ir.x) / ir.w),
          y: Math.max(0, (ry - ir.y) / ir.h),
          w: Math.min(1, rw / ir.w),
          h: Math.min(1, rh / ir.h),
        };
      }
    }

    // Dim whole canvas
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, cw, ch);

    if (!cr) {
      // Hint: redraw image bright inside its own bounds
      ctx.save(); ctx.beginPath(); ctx.rect(ir.x, ir.y, ir.w, ir.h); ctx.clip();
      paintImg(ctx, ir); ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = `bold ${Math.max(13, Math.round(ch * 0.035))}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('फोटो पर ड्रैग करें', cw / 2, ch / 2);
      return;
    }

    // Convert crop norm → canvas px (relative to image rect)
    const px = ir.x + cr.x * ir.w;
    const py = ir.y + cr.y * ir.h;
    const pw = cr.w * ir.w;
    const ph = cr.h * ir.h;

    // Bright image in selected area
    ctx.save(); ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.clip();
    paintImg(ctx, ir); ctx.restore();

    // Green selection border
    ctx.strokeStyle = '#10b981'; ctx.lineWidth = 2;
    ctx.strokeRect(px, py, pw, ph);

    // White corner handles
    const hL = Math.min(18, pw / 4, ph / 4);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    [[px,py,1,1],[px+pw,py,-1,1],[px,py+ph,1,-1],[px+pw,py+ph,-1,-1]].forEach(([x,y,sx,sy]) => {
      ctx.beginPath(); ctx.moveTo(x+sx*hL,y); ctx.lineTo(x,y); ctx.lineTo(x,y+sy*hL); ctx.stroke();
    });

    // Rule-of-thirds grid
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(px+pw*i/3,py); ctx.lineTo(px+pw*i/3,py+ph); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px,py+ph*i/3); ctx.lineTo(px+pw,py+ph*i/3); ctx.stroke();
    }
  }

  // Returns canvas-px coordinates (NOT normalised)
  function ptPx(e) {
    const cv = canvasRef.current;
    const r  = cv.getBoundingClientRect();
    const src = e.changedTouches?.[0] ?? e.touches?.[0] ?? e;
    // getBoundingClientRect gives CSS size; canvas.width gives pixel dims — map correctly
    const scaleX = cv.width  / r.width;
    const scaleY = cv.height / r.height;
    return {
      x: (src.clientX - r.left) * scaleX,
      y: (src.clientY - r.top)  * scaleY,
    };
  }

  function onPointerDown(e) {
    if (toolRef.current !== 'crop') return;
    e.preventDefault();
    cropRef.current = null; setHasCrop(false);
    dragStart.current = ptPx(e);
    dragCur.current   = dragStart.current;
    dragging.current  = true;
  }
  function onPointerMove(e) {
    if (!dragging.current) return;
    e.preventDefault();
    dragCur.current = ptPx(e);
    repaint();
  }
  function onPointerUp(e) {
    if (!dragging.current) return;
    dragging.current = false;
    const s = dragStart.current, en = ptPx(e);
    const ir = imgRectRef.current;
    if (ir) {
      const rx = Math.min(s.x, en.x), ry = Math.min(s.y, en.y);
      const rw = Math.abs(en.x - s.x), rh = Math.abs(en.y - s.y);
      if (rw / ir.w > 0.04 && rh / ir.h > 0.04) {
        cropRef.current = {
          x: Math.max(0, (rx - ir.x) / ir.w),
          y: Math.max(0, (ry - ir.y) / ir.h),
          w: Math.min(1, rw / ir.w),
          h: Math.min(1, rh / ir.h),
        };
        setHasCrop(true);
      }
    }
    repaint();
  }

  function clearCrop() {
    cropRef.current = null; setHasCrop(false);
    dragStart.current = null; dragCur.current = null; dragging.current = false;
    repaint();
  }

  function reset() {
    setBrightness(0); setContrast(0); setSaturation(0); setRotation(0);
    clearCrop();
  }

  // Export at natural resolution — no overlay, optional crop
  function handleSave() {
    const img = imgEl.current;
    // If image not loaded yet, just close the modal with original
    if (!img) { onSave(file, preview.url); return; }
    setSaving(true);

    function finish(blob) {
      try {
        const name = (file?.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
        const outFile = blob ? new File([blob], name, { type: 'image/jpeg' }) : file;
        const outUrl  = blob ? URL.createObjectURL(blob) : preview.url;
        onSave(outFile, outUrl);
      } catch {
        onSave(file, preview.url); // absolute fallback — always close the modal
      }
    }

    try {
      const { brightness: b0, contrast: c0, saturation: s0, rotation: rot } = adjRef.current;
      const swap = rot === 90 || rot === 270;
      const outW = swap ? img.naturalHeight : img.naturalWidth;
      const outH = swap ? img.naturalWidth  : img.naturalHeight;

      const tmp = document.createElement('canvas');
      tmp.width = Math.max(1, outW); tmp.height = Math.max(1, outH);
      const tctx = tmp.getContext('2d');
      tctx.filter = `brightness(${(100+b0)/100}) contrast(${(100+c0)/100}) saturate(${(100+s0)/100})`;
      tctx.save();
      tctx.translate(tmp.width / 2, tmp.height / 2);
      tctx.rotate(rot * Math.PI / 180);
      tctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      tctx.restore();
      tctx.filter = 'none';

      const cr = cropRef.current;
      let out = tmp;
      if (cr) {
        const cx = Math.round(cr.x * outW), cy = Math.round(cr.y * outH);
        const dw = Math.max(1, Math.round(cr.w * outW));
        const dh = Math.max(1, Math.round(cr.h * outH));
        out = document.createElement('canvas');
        out.width = dw; out.height = dh;
        out.getContext('2d').drawImage(tmp, cx, cy, dw, dh, 0, 0, dw, dh);
      }

      out.toBlob(blob => finish(blob), 'image/jpeg', 0.93);
    } catch {
      // Canvas failed — close with original so user isn't stuck
      finish(null);
    }
  }

  const SLIDERS = [
    { label: '☀️ ब्राइटनेस', v: brightness, set: setBrightness, min: -100, max: 100 },
    { label: '◑ कॉन्ट्रास्ट',  v: contrast,   set: setContrast,   min: -100, max: 100 },
    { label: '🌈 सेचुरेशन',    v: saturation, set: setSaturation, min: -100, max: 100 },
  ];

  return (
    <div className="fixed inset-0 z-[999] flex flex-col bg-black" style={{ touchAction: 'none' }}>

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 shrink-0">
        <button onClick={onClose} className="text-gray-300 text-sm px-3 py-1.5 rounded-lg border border-gray-600">
          ✕ रद्द
        </button>
        <span className="text-white font-semibold text-sm">✏️ फोटो संपादित करें</span>
        <button onClick={handleSave} disabled={saving}
          className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg font-bold">
          {saving ? '…' : '✓ सहेजें'}
        </button>
      </div>

      {/* Canvas fills ALL remaining space — canvas pixel dims = container CSS dims */}
      <div ref={containerRef} className="flex-1 min-h-0" style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
                   cursor: tool === 'crop' ? 'crosshair' : 'default' }}
          onMouseDown={onPointerDown}  onMouseMove={onPointerMove}
          onMouseUp={onPointerUp}      onMouseLeave={onPointerUp}
          onTouchStart={onPointerDown} onTouchMove={onPointerMove} onTouchEnd={onPointerUp}
        />
      </div>

      {/* Tool panel */}
      <div className="bg-gray-900 px-4 pt-3 pb-4 shrink-0 space-y-3">
        <div className="flex gap-2">
          {[{ k: 'adjust', l: '⚙️ एडजस्ट' }, { k: 'crop', l: '✂️ क्रॉप' }].map(t => (
            <button key={t.k} onClick={() => setTool(t.k)}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors
                ${tool === t.k ? 'bg-emerald-600 text-white' : 'bg-gray-700 text-gray-300'}`}>
              {t.l}
            </button>
          ))}
        </div>

        {tool === 'adjust' && (
          <div className="space-y-3">
            {SLIDERS.map(({ label, v, set, min, max }) => (
              <div key={label} className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-28 shrink-0">{label}</span>
                <input type="range" min={min} max={max} value={v}
                  onChange={e => set(+e.target.value)}
                  className="flex-1 accent-emerald-500 cursor-pointer" />
                <span className="text-xs text-gray-300 w-9 text-right tabular-nums">
                  {v > 0 ? '+' : ''}{v}
                </span>
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setRotation(r => (r - 90 + 360) % 360)}
                className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm">↺ बाएं</button>
              <button onClick={() => setRotation(r => (r + 90) % 360)}
                className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm">↻ दाएं</button>
              <button onClick={reset}
                className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-red-400 rounded-lg text-sm">↩ रीसेट</button>
            </div>
          </div>
        )}

        {tool === 'crop' && (
          <div className="space-y-2">
            <p className="text-xs text-center text-gray-400">
              {hasCrop ? '✅ क्रॉप चुना गया — ऊपर सहेजें दबाएं' : 'फोटो पर ड्रैग करके क्रॉप चुनें'}
            </p>
            {hasCrop && (
              <button onClick={clearCrop}
                className="w-full py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm">
                ✕ क्रॉप हटाएं
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── News Generator Tab ────────────────────────────────────────────────────────
const LENGTH_OPTS = [
  { value: 'short',    label: 'छोटी',    desc: '100–150 शब्द' },
  { value: 'medium',   label: 'मध्यम',   desc: '150–200 शब्द' },
  { value: 'detailed', label: 'विस्तृत', desc: '200–250 शब्द' },
];
const ACCEPT_FILES = '.pdf,.doc,.docx,.txt,.jpg,.jpeg,.png,.webp,.bmp';

function fileTypeIcon(name = '') {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['jpg','jpeg','png','webp','bmp'].includes(ext)) return <Image size={18} />;
  if (ext === 'pdf') return <FileText size={18} />;
  return <File size={18} />;
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      title="कॉपी करें"
    >
      {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} className="text-gray-400" />}
    </button>
  );
}

function OutputField({ label, value, multiline }) {
  if (!value) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</label>
        <CopyButton text={value} />
      </div>
      {multiline
        ? <div className="rounded-xl border border-gray-200 dark:border-gray-600 p-3 text-sm leading-relaxed whitespace-pre-wrap bg-gray-50 dark:bg-gray-700/40 text-gray-800 dark:text-gray-100" style={{ fontFamily: '"Noto Sans Devanagari", sans-serif' }}>{value}</div>
        : <div className="rounded-xl border border-gray-200 dark:border-gray-600 px-3 py-2.5 text-sm font-semibold bg-gray-50 dark:bg-gray-700/40 text-gray-800 dark:text-gray-100" style={{ fontFamily: '"Noto Sans Devanagari", sans-serif' }}>{value}</div>
      }
    </div>
  );
}

function NewsGeneratorTab() {
  const [file,         setFile]         = useState(null);
  const [length,       setLength]       = useState('short');
  const [city,         setCity]         = useState('');
  const [valueEdition, setValueEdition] = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [result,       setResult]       = useState(null);
  const fileRef = useRef();

  function pickFile(f) { if (f) { setFile(f); setResult(null); setError(''); } }

  async function generate() {
    if (!file) { setError('कृपया पहले एक फ़ाइल चुनें।'); return; }
    setLoading(true); setError(''); setResult(null);
    const fd = new FormData();
    fd.append('file',          file);
    fd.append('length',        length);
    fd.append('city',          city.trim());
    fd.append('value_edition', valueEdition ? '1' : '0');
    try {
      const token = localStorage.getItem('pk_token');
      const res   = await fetch(`${API_BASE}/news-generator`, {
        method:  'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body:    fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'जनरेशन फेल हो गई');
      setResult(data);
    } catch (e) { setError(e.message); }
    finally     { setLoading(false); }
  }

  function copyAll() {
    if (!result) return;
    const parts = [`शीर्षक: ${result.headline}`, `उप-शीर्षक: ${result.sub_headline}`, `\n${result.text}`];
    if (result.ve_headline) parts.push(`\nValue Edition शीर्षक: ${result.ve_headline}`);
    if (result.ve_text)     parts.push(result.ve_text);
    navigator.clipboard.writeText(parts.join('\n'));
  }

  return (
    <div className="space-y-4">

      {/* ── Upload card ── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
          <Newspaper size={18} className="text-purple-600 dark:text-purple-400" />
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">न्यूज़ जनरेटर</h2>
          <span className="text-xs text-gray-400 ml-1">— फ़ाइल अपलोड करें, हिंदी समाचार पाएं</span>
        </div>

        <div className="p-5 space-y-5">

          {/* Drop zone */}
          <div
            onClick={() => !file && fileRef.current?.click()}
            className={`rounded-2xl border-2 border-dashed transition-colors ${file ? 'p-4' : 'p-8 cursor-pointer hover:border-purple-400 hover:bg-purple-50/30 dark:hover:bg-purple-900/10'} border-gray-200 dark:border-gray-600`}
          >
            {file ? (
              <div className="flex items-center gap-3">
                <div className="rounded-lg p-2 bg-purple-600 text-white shrink-0">{fileTypeIcon(file.name)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{file.name}</p>
                  <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(0)} KB</p>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); setFile(null); setResult(null); setError(''); }}
                  className="text-xs text-gray-400 hover:text-red-500 border border-gray-200 dark:border-gray-600 px-2.5 py-1 rounded-lg transition-colors"
                >हटाएं</button>
              </div>
            ) : (
              <div className="text-center space-y-2">
                <Upload size={28} className="mx-auto text-gray-300" />
                <p className="text-sm font-medium text-gray-600 dark:text-gray-300">फ़ाइल यहाँ छोड़ें या क्लिक करें</p>
                <p className="text-xs text-gray-400">PDF, DOCX, DOC, TXT, JPG, PNG — अधिकतम 20 MB</p>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept={ACCEPT_FILES} className="hidden"
            onChange={e => pickFile(e.target.files[0])} capture="environment" />

          {/* Length selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">समाचार की लंबाई</label>
            <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-gray-600">
              {LENGTH_OPTS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setLength(opt.value)}
                  className="flex-1 py-2.5 text-xs font-semibold transition-all"
                  style={{
                    background: length === opt.value ? '#7c3aed' : 'transparent',
                    color:      length === opt.value ? '#fff' : undefined,
                  }}
                >
                  {opt.label}
                  <span className="block text-[10px] opacity-70 mt-0.5">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* City + Value Edition row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">शहर (byline के लिए)</label>
              <input
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                placeholder="जैसे: जयपुर"
                value={city}
                onChange={e => setCity(e.target.value)}
                style={{ fontFamily: '"Noto Sans Devanagari", sans-serif' }}
              />
              <p className="text-xs text-gray-400 mt-1">
                Byline: <span className="font-mono">{city.trim() ? `${city.trim()}@पत्रिका` : '@पत्रिका'}</span>
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Value Edition</label>
              <button
                onClick={() => setValueEdition(v => !v)}
                className={`w-full rounded-xl border-2 flex items-center gap-3 px-3 py-2.5 transition-all ${valueEdition ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20' : 'border-gray-200 dark:border-gray-600'}`}
              >
                <div className={`w-9 h-5 rounded-full flex items-center transition-all ${valueEdition ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'}`} style={{ padding: '2px' }}>
                  <div className="w-4 h-4 bg-white rounded-full shadow transition-all" style={{ transform: valueEdition ? 'translateX(16px)' : 'translateX(0)' }} />
                </div>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{valueEdition ? 'चालू' : 'बंद'}</span>
              </button>
              <p className="text-xs text-gray-400 mt-1">55–65 शब्दों का संक्षिप्त संस्करण</p>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-xl px-4 py-3 text-sm bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-800">
              <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}

          {/* Generate button */}
          <button
            onClick={generate}
            disabled={!file || loading}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white font-bold rounded-xl text-base transition-colors shadow-sm"
          >
            {loading
              ? <><Loader2 size={18} className="animate-spin" /> जनरेट हो रहा है…</>
              : <><Sparkles size={18} /> हिंदी समाचार जनरेट करें</>
            }
          </button>
        </div>
      </div>

      {/* ── Result ── */}
      {result && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
            <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-500" /> समाचार तैयार है
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={copyAll}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors border border-gray-200 dark:border-gray-600"
              >
                <Copy size={13} /> सब कॉपी करें
              </button>
              <button
                onClick={() => { setResult(null); setFile(null); setError(''); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors border border-gray-200 dark:border-gray-600"
              >
                <RotateCcw size={13} /> नया
              </button>
            </div>
          </div>
          <div className="p-5 space-y-4">
            <OutputField label="शीर्षक (Headline)"        value={result.headline} />
            <OutputField label="उप-शीर्षक (Sub-Headline)"  value={result.sub_headline} />
            <OutputField label="समाचार पाठ (News Text)"    value={result.text} multiline />
            {(result.ve_headline || result.ve_text) && (
              <>
                <hr className="border-gray-100 dark:border-gray-700" />
                <p className="text-xs font-bold uppercase tracking-widest text-purple-600 dark:text-purple-400">Value Edition</p>
                <OutputField label="Value Edition शीर्षक" value={result.ve_headline} />
                <OutputField label="Value Edition पाठ"    value={result.ve_text} multiline />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

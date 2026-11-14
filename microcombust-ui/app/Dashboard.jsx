'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Database,
  Download,
  ExternalLink,
  FileText,
  Flame,
  Loader2,
  Play,
  Send,
  ShieldCheck,
  Sparkles,
  Wind,
  X,
} from 'lucide-react';
import MarkdownRenderer from './components/MarkdownRenderer';
import FlameCanvas from './components/FlameCanvas';

/* ------------------------------------------------------------------ */
/* Backend API Config & Discovery                                     */
/* ------------------------------------------------------------------ */
const API_CANDIDATES = (
  process.env.NEXT_PUBLIC_API_URL ||
  'http://127.0.0.1:8000,http://localhost:8000,http://127.0.0.1:8080,http://localhost:8080'
)
  .split(',')
  .map((base) => base.trim().replace(/\/+$/, ''))
  .filter(Boolean);

let activeApi = null;

const isJsonResponse = (res) =>
  String(res?.headers?.get('content-type') || '').includes('application/json');

async function apiFetch(path, body) {
  const bases = activeApi
    ? [activeApi, ...API_CANDIDATES.filter((b) => b !== activeApi)]
    : [...API_CANDIDATES];

  let lastError = null;
  let lastResponse = null;

  for (const base of bases) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);

      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok && isJsonResponse(res)) {
        activeApi = base;
        return res;
      }
      lastResponse = res;
    } catch (err) {
      lastError = err;
    }
  }

  return lastResponse ?? Promise.reject(lastError ?? new Error('No backend reachable'));
}

/* ------------------------------------------------------------------ */
/* Physics & Simulation Constants                                     */
/* ------------------------------------------------------------------ */
const GRAVITY_MODES = [
  { value: '0g', label: '0g', sub: 'Microgravity' },
  { value: '0.16g', label: '0.16g', sub: 'Lunar Gravity' },
  { value: '1g', label: '1g', sub: 'Earth Gravity' },
];

const FUELS = [
  'PMMA (Acrylic)',
  'Nomex Fabric',
  'Silicone Rubber',
  'Kevlar Blend',
];

const MATERIALS = [
  { id: 'PMMA', label: 'PMMA (Acrylic)', base: 0.8, fuel: 'PMMA (Acrylic)' },
  { id: 'Silicone', label: 'Silicone Rubber', base: 0.75, fuel: 'Silicone Rubber' },
  { id: 'Cotton', label: 'Cotton Fabric', base: 0.55, fuel: null },
  { id: 'Nomex', label: 'Nomex Fabric', base: 0.45, fuel: 'Nomex Fabric' },
  { id: 'Kevlar', label: 'Kevlar Blend', base: 0.25, fuel: 'Kevlar Blend' },
];

const TIERS = {
  High: { title: 'High Hazard', hint: 'Sustained rapid spread likely', color: '#f43f5e', bg: 'rgba(244, 63, 94, 0.15)' },
  Medium: { title: 'Caution / Moderate', hint: 'Conditional propagation', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
  Low: { title: 'Safe / Self-Extinguishing', hint: 'Extinguishes in low flows', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' },
};

const SOFIE = 'https://science.nasa.gov/biological-physical/investigations/sofie/';
const SOFIE_GLENN = 'https://www.nasa.gov/glenn/glenn-expertise-space-exploration/physical-sciences-program/combustion-science/solid-fuel-ignition-and-extinction-sofie/';
const PSI = 'https://science.nasa.gov/physical-sciences-informatics-psi/';
const NTRS = 'https://ntrs.nasa.gov/';

const SEED_RUNS = [
  { id: 1, fuel: 'PMMA', gravity: '0g', o2: 21, airflow: 5, spread: 0.9, risk: 'High', url: SOFIE },
  { id: 2, fuel: 'PMMA', gravity: '0g', o2: 30, airflow: 10, spread: 2.1, risk: 'High', url: SOFIE_GLENN },
  { id: 3, fuel: 'PMMA', gravity: '0.16g', o2: 21, airflow: 10, spread: 1.4, risk: 'High', url: PSI },
  { id: 4, fuel: 'PMMA', gravity: '1g', o2: 21, airflow: 10, spread: 1.1, risk: 'High', url: NTRS },
  { id: 5, fuel: 'Silicone', gravity: '0g', o2: 21, airflow: 15, spread: 1.2, risk: 'High', url: SOFIE },
  { id: 6, fuel: 'Silicone', gravity: '0.16g', o2: 25, airflow: 20, spread: 1.8, risk: 'High', url: PSI },
  { id: 7, fuel: 'Cotton', gravity: '0g', o2: 21, airflow: 10, spread: 0.6, risk: 'Medium', url: SOFIE_GLENN },
  { id: 8, fuel: 'Cotton', gravity: '1g', o2: 21, airflow: 10, spread: 0.8, risk: 'Medium', url: NTRS },
  { id: 9, fuel: 'Nomex', gravity: '0g', o2: 21, airflow: 20, spread: 0.4, risk: 'Medium', url: SOFIE },
  { id: 10, fuel: 'Nomex', gravity: '0.16g', o2: 30, airflow: 15, spread: 0.7, risk: 'Medium', url: PSI },
  { id: 11, fuel: 'Kevlar', gravity: '0g', o2: 21, airflow: 15, spread: 0.0, risk: 'Low', url: SOFIE },
  { id: 12, fuel: 'Kevlar', gravity: '1g', o2: 30, airflow: 20, spread: 0.2, risk: 'Low', url: NTRS },
];

const WELCOME_MESSAGE = {
  id: 'welcome',
  role: 'assistant',
  text: `### Welcome to AETHON · NASA Microgravity Combustion AI

I am your scientific intelligence agent anchored directly to **559 peer-reviewed NASA technical papers** and flight records, including **BASS**, **FLEX**, **SAFFIRE**, and **SoFIE**.

Ask me about:
- **Diffusion Flame Physics:** Quiescent vs. forced-flow microgravity conditions ($0g$)
- **Material Flammability & Extinction:** PMMA, Silicone, Nomex, and Kevlar limiting oxygen thresholds
- **Safety Protocol Discrepancies:** Why **NASA-STD-6001 Test 1** is non-conservative in reduced gravity

Every answer provides strict source grounding, inline citations, and KaTeX chemical equation rendering.`,
  citations: [],
  confidence: null,
  sources: [],
};

const SUGGESTED_QUERIES = [
  'How does microgravity affect flame spread for PMMA?',
  'What is the extinction limit of Silicone in 0g?',
  'Why is NASA-STD-6001 non-conservative in space?',
  'Explain upstream flame propagation in low airflow',
];

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const tierOf = (s) => (s >= 0.6 ? 'High' : s >= 0.35 ? 'Medium' : 'Low');
const fuelToId = (fuel) => MATERIALS.find((m) => m.fuel === fuel)?.id || fuel;
const pct = (c) => (c == null ? null : Math.round(c <= 1 ? c * 100 : c));

function localRank({ oxygen, pressure, airflow, gravity }) {
  const g = gravity === '0g' ? 1.1 : gravity === '0.16g' ? 1.0 : 0.9;
  const fO2 = 0.55 + ((oxygen - 15) / 20) * 0.9;
  const fP = clamp(0.7 + 0.3 * (pressure / 101.3), 0.7, 1.3);
  const fFlow = 0.9 + (airflow / 50) * 0.3;
  return MATERIALS.map((m) => {
    const score = clamp(m.base * fO2 * fP * fFlow * g, 0, 1);
    return { material: m.label, score, tier: tierOf(score) };
  });
}

function normalizeRanking(data) {
  const list = Array.isArray(data) ? data : data?.ranking || data?.results || data?.rankings || [];
  return list
    .map((r) => {
      const name = String(r.material || r.label || r.name || '');
      const score = clamp(Number(r.score ?? r.risk_score ?? 0), 0, 1);
      const tier =
        ['High', 'Medium', 'Low'].find(
          (t) => t.toLowerCase() === String(r.tier || r.risk || r.risk_level || '').toLowerCase()
        ) || tierOf(score);
      return { material: name, score, tier };
    })
    .filter((r) => r.material);
}

function normalizeAnswer(data) {
  const citations =
    data?.sources ||
    data?.citations ||
    (data?.citation_url ? [{ source: data.citation_title || 'NASA source', snippet: '', url: data.citation_url }] : []);
  const list = citations.map((c) => ({
    title: c.source || c.title || c.name || 'NASA Technical Document',
    source: c.source || c.title || c.name,
    snippet: c.snippet || '',
    url: c.url || c.link,
    confidence: c.confidence ?? c.score ?? null,
  }));
  const confidence =
    data?.confidence ??
    (list.length && list.every((c) => c.confidence != null)
      ? list.reduce((a, c) => a + c.confidence, 0) / list.length
      : null);
  return {
    text: data?.answer || data?.ai_answer || data?.response || 'No scientific response generated.',
    citations: list,
    confidence,
    question: data?.question || null,
    sources: Array.isArray(data?.retrieved_sources) ? data.retrieved_sources : [],
  };
}

/* ------------------------------------------------------------------ */
/* UI Components                                                       */
/* ------------------------------------------------------------------ */
function AerospacePanel({
  title,
  icon: Icon,
  right,
  children,
  className = '',
  accent = 'cyan', // 'cyan' | 'orange' | 'emerald'
}) {
  const accentBorder =
    accent === 'orange'
      ? 'border-t-2 border-t-orange-500/80'
      : accent === 'emerald'
      ? 'border-t-2 border-t-emerald-500/80'
      : 'border-t-2 border-t-cyan-500/80';

  const iconBg =
    accent === 'orange'
      ? 'bg-orange-500/10 text-orange-400 border-orange-500/30'
      : accent === 'emerald'
      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
      : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30';

  return (
    <section className={`aethon-glass ${accentBorder} ${className}`}>
      <header className="aethon-glass-header">
        <h2 className="flex items-center gap-2.5 font-semibold text-slate-100 text-[13.5px] tracking-wide">
          {Icon && (
            <span className={`w-7 h-7 rounded-lg border flex items-center justify-center flex-none ${iconBg}`}>
              <Icon className="w-4 h-4" aria-hidden="true" />
            </span>
          )}
          <span>{title}</span>
        </h2>
        {right}
      </header>
      {children}
    </section>
  );
}

function TelemetrySlider({
  id,
  label,
  unit,
  value,
  min,
  max,
  step = 1,
  digits = 0,
  accentColor = '#06b6d4',
  onChange,
  onSlide,
}) {
  const fill = ((value - min) / (max - min)) * 100;

  const handleChange = (e) => {
    const next = Number(e.target.value);
    onChange(next);
    onSlide?.();
  };

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center text-xs">
        <label htmlFor={id} className="font-medium text-slate-300">
          {label}
        </label>
        <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-slate-900/90 border border-slate-700/80 text-cyan-300 font-semibold shadow-inner">
          {Number(value).toFixed(digits)} <span className="text-slate-400 text-[10px] font-normal">{unit}</span>
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        className="aethon-range"
        style={{
          background: `linear-gradient(to right, ${accentColor} 0%, ${accentColor} ${fill}%, rgba(51, 65, 85, 0.5) ${fill}%)`,
        }}
      />
      <div className="flex justify-between font-mono text-[10px] text-slate-500">
        <span>{min} {unit}</span>
        <span>{max} {unit}</span>
      </div>
    </div>
  );
}

function SourceModal({ source, onClose }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (!source) return null;

  const filename = source.filename || source.source || 'NASA Technical Document';
  const snippet = source.snippet || source.text || '';
  const confidence = pct(source.confidence);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Source passage from ${filename}`}
    >
      <div
        onClick={onClose}
        aria-hidden="true"
        className="absolute inset-0 bg-black/80 backdrop-blur-md transition-opacity"
      />
      <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col aethon-glass border-t-2 border-t-cyan-500 z-10 shadow-2xl">
        <header className="aethon-glass-header flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 flex items-center justify-center flex-none">
              <FileText className="w-4 h-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-100">{filename}</p>
              <p className="truncate text-[11px] font-mono text-cyan-400/80">
                Page {source.page ?? 'N/A'}{source.source ? ` · ${source.source}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close passage modal"
            className="w-8 h-8 rounded-lg border border-slate-700 hover:border-slate-500 bg-slate-800/50 hover:bg-slate-700/60 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-3 font-mono text-xs leading-relaxed text-slate-300">
          <div className="flex items-center justify-between text-[11px] text-slate-400 pb-2 border-b border-slate-800">
            <span>RETRIEVED CHROMADB PASSAGE</span>
            {confidence != null && (
              <span className="text-emerald-400 font-semibold">{confidence}% MATCH CONFIDENCE</span>
            )}
          </div>
          {snippet ? (
            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/90 whitespace-pre-wrap text-slate-200 selection:bg-cyan-500/30">
              {snippet}
            </div>
          ) : (
            <p className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200">
              No full text passage stored for this citation chunk.
            </p>
          )}
        </div>

        <footer className="p-4 bg-slate-950/60 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400 flex-shrink-0">
          <span className="font-mono text-[11px]">Source indexed via NASA NTRS / PSI corpus</span>
          {source.url && (
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cyan-500/40 bg-cyan-950/40 hover:bg-cyan-900/60 text-cyan-300 text-xs font-medium transition-colors"
            >
              Open Full Document <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          )}
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main Dashboard Component                                           */
/* ------------------------------------------------------------------ */
export default function Dashboard() {
  // Telemetry & Experiment Controls
  const [gravity, setGravity] = useState('0g');
  const [oxygen, setOxygen] = useState(21);
  const [pressure, setPressure] = useState(101.3);
  const [airflow, setAirflow] = useState(15);
  const [fuel, setFuel] = useState(FUELS[0]);
  const [flareSignal, setFlareSignal] = useState(0);

  // System & Connection State
  const [apiOnline, setApiOnline] = useState(true);
  const [aiProvider, setAiProvider] = useState(null);
  const [runningSim, setRunningSim] = useState(false);
  const [remoteRank, setRemoteRank] = useState(null);
  const [simError, setSimError] = useState(null);

  // Chat State
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [openSource, setOpenSource] = useState(null);

  // References
  const messagesEndRef = useRef(null);
  const chatInputRef = useRef(null);

  // Table State
  const [showAllGravity, setShowAllGravity] = useState(false);
  const [riskFilter, setRiskFilter] = useState('All');
  const [sort, setSort] = useState({ key: 'spread', dir: 'desc' });

  const triggerFlare = () => setFlareSignal((c) => c + 1);

  // Probe backend on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const base of API_CANDIDATES) {
        try {
          const res = await fetch(`${base}/`, { signal: AbortSignal.timeout(3000) });
          if (res.ok && isJsonResponse(res)) {
            activeApi = base;
            if (!cancelled) {
              setApiOnline(true);
              try {
                const health = await res.json();
                if (health?.groq_configured) setAiProvider('groq');
                else if (health?.openrouter_configured) setAiProvider('openrouter');
                else setAiProvider(null);
              } catch {
                /* ignore json parse err */
              }
            }
            return;
          }
        } catch {
          /* next */
        }
      }
      if (!cancelled) setApiOnline(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-scroll chat history smoothly when messages, thinking, or openSource modal changes
  useEffect(() => {
    if (openSource) return; // keep modal scroll independent
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, thinking, openSource]);

  // Sliders to ranking heuristic
  const params = { oxygen, pressure, airflow, gravity, fuel };
  const ranking = useMemo(
    () => remoteRank || localRank(params),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [remoteRank, oxygen, pressure, airflow, gravity]
  );

  const byTier = useMemo(() => {
    const out = { High: [], Medium: [], Low: [] };
    [...ranking].sort((a, b) => b.score - a.score).forEach((r) => out[r.tier]?.push(r));
    return out;
  }, [ranking]);

  const topRisk = useMemo(
    () => (ranking.length ? [...ranking].sort((a, b) => b.score - a.score)[0] : null),
    [ranking]
  );

  const selectedFuelId = fuelToId(fuel);

  // Run Backend Simulation
  async function runSimulation() {
    setRunningSim(true);
    setSimError(null);
    triggerFlare();
    try {
      const res = await apiFetch('/rank-materials', {
        oxygen_conc: oxygen,
        pressure,
        gravity,
        airflow,
        material: fuel,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const parsed = normalizeRanking(await res.json());
      if (!parsed.length) throw new Error('No ranking results returned from backend');
      setRemoteRank(parsed);
      setApiOnline(true);
    } catch (err) {
      console.error('Simulation error:', err);
      setSimError(err instanceof Error ? err.message : String(err));
      setRemoteRank(null);
      setApiOnline(false);
    } finally {
      setRunningSim(false);
    }
  }

  // Send Query to AI Agent
  async function sendQuery(queryText) {
    const query = (queryText || draft).trim();
    if (!query || thinking) return;

    const history = messages
      .filter((m) => m.id !== 'welcome' && !m.error && (m.text || '').trim())
      .slice(-30)
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'model', text: m.text }));

    setMessages((m) => [...m, { id: `u${Date.now()}`, role: 'user', text: query }]);
    setDraft('');
    setThinking(true);
    triggerFlare();

    try {
      const res = await apiFetch('/query-agent', {
        query,
        history,
        gravity_filter: gravity,
        oxygen_conc: oxygen,
        pressure,
        airflow,
        fuel,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const a = normalizeAnswer(await res.json());
      setApiOnline(true);
      setMessages((m) => [...m, { id: `a${Date.now()}`, role: 'assistant', ...a }]);
    } catch {
      setApiOnline(false);
      setMessages((m) => [
        ...m,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          error: true,
          text: `⚠️ **Connection Failure:** Unable to reach FastAPI backend service on ${API_CANDIDATES.join(', ')}. Please verify that \`python main.py\` is running.`,
          citations: [],
          confidence: null,
          sources: [],
        },
      ]);
    } finally {
      setThinking(false);
    }
  }

  // Table rows filtering & sorting
  const toggleSort = (key) => {
    setSort((prev) => ({
      key,
      dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc',
    }));
  };

  const tableRows = useMemo(() => {
    let r = SEED_RUNS.filter(
      (x) => (showAllGravity || x.gravity === gravity) && (riskFilter === 'All' || x.risk === riskFilter)
    );
    const dir = sort.dir === 'asc' ? 1 : -1;
    r = [...r].sort((a, b) => {
      const av = a[sort.key],
        bv = b[sort.key];
      return (typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv))) * dir;
    });
    return r;
  }, [gravity, showAllGravity, riskFilter, sort]);

  function exportSummary() {
    const jsonReport = {
      platform: 'AETHON - NASA Microgravity Combustion & Fire Safety AI',
      exported_at: new Date().toISOString(),
      telemetry: { gravity, oxygen: `${oxygen}%`, pressure: `${pressure} kPa`, airflow: `${airflow} cm/s`, fuel },
      flammability_rankings: ranking,
      latest_analysis: messages.filter((m) => m.role === 'assistant' && m.id !== 'welcome').slice(-1)[0] || null,
    };
    const blob = new Blob([JSON.stringify(jsonReport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AETHON_Microgravity_Report_${gravity}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="relative min-h-screen text-slate-100 bg-[#07080b] selection:bg-orange-500/30">
      {/* Background Starfield & Hardware-Accelerated Flame Cursor Canvas */}
      <FlameCanvas gravity={gravity} flareSignal={flareSignal} />

      {/* Persistent Aerospace Mission Control Header */}
      <header className="sticky top-0 z-40 px-4 sm:px-6 py-3 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md">
        <div className="max-w-[1520px] mx-auto flex flex-wrap items-center justify-between gap-3">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 via-amber-500 to-cyan-500 p-[1.5px] shadow-lg shadow-orange-500/20">
              <div className="w-full h-full rounded-[10px] bg-slate-950 flex items-center justify-center">
                <Flame className="w-5 h-5 text-orange-400" aria-hidden="true" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-base tracking-wider bg-gradient-to-r from-white via-slate-200 to-cyan-300 bg-clip-text text-transparent">
                  AETHON
                </h1>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-orange-500/40 bg-orange-500/10 text-orange-300 uppercase">
                  NASA RAG
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Microgravity Combustion & Spacecraft Fire Safety Intelligence Platform
              </p>
            </div>
          </div>

          {/* Status Pills & Controls */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* FastAPI Status */}
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] font-medium backdrop-blur-sm ${
                apiOnline
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${apiOnline ? 'bg-emerald-400 dot-pulse' : 'bg-amber-400'}`}
                aria-hidden="true"
              />
              {apiOnline ? 'FastAPI: Connected' : 'FastAPI: Offline'}
            </span>

            {/* ChromaDB Status */}
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 text-[11px] font-medium backdrop-blur-sm">
              <Database className="w-3 h-3 text-cyan-400" aria-hidden="true" />
              <span>ChromaDB: 559 Papers</span>
            </span>

            {/* AI Provider Status */}
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-slate-700 bg-slate-900/60 text-slate-300 text-[11px] font-medium backdrop-blur-sm">
              <Sparkles className="w-3 h-3 text-amber-400" aria-hidden="true" />
              <span>AI: {aiProvider ? aiProvider.toUpperCase() : 'Active'}</span>
            </span>

            {/* Gravity Mode Selector */}
            <div className="flex p-0.5 rounded-xl border border-slate-700/80 bg-slate-900/80 backdrop-blur-sm ml-1" role="group" aria-label="Select gravity regime">
              {GRAVITY_MODES.map((g) => {
                const active = gravity === g.value;
                return (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => {
                      setGravity(g.value);
                      triggerFlare();
                    }}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      active
                        ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-slate-950 font-bold shadow-md shadow-orange-500/20'
                        : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
                    }`}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>

            {/* Export Report */}
            <button
              type="button"
              onClick={exportSummary}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-700 hover:border-slate-500 bg-slate-800/60 hover:bg-slate-700/60 text-slate-200 text-xs font-medium transition-colors cursor-pointer"
              title="Download telemetry and intelligence report"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden md:inline">Export Report</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace Grid */}
      <main className="relative z-20 max-w-[1520px] mx-auto p-4 sm:p-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* ========================================================= */}
          {/* Left Column: Experiment Controls & Risk Assessment         */}
          {/* ========================================================= */}
          <div className="lg:col-span-5 space-y-6 min-w-0">
            {/* Experiment Controls Panel */}
            <AerospacePanel
              title="Telemetry & Boundary Controls"
              icon={Wind}
              accent="orange"
              right={
                <span className="font-mono text-[11px] text-orange-400/90 font-medium px-2 py-0.5 rounded-md border border-orange-500/30 bg-orange-500/10">
                  {gravity}
                </span>
              }
            >
              <div className="p-5 space-y-5">
                <TelemetrySlider
                  id="oxygen-input"
                  label="Oxygen Concentration"
                  unit="%"
                  value={oxygen}
                  min={15}
                  max={35}
                  step={0.5}
                  digits={1}
                  accentColor="#f97316"
                  onChange={setOxygen}
                  onSlide={triggerFlare}
                />

                <TelemetrySlider
                  id="pressure-input"
                  label="Ambient Pressure"
                  unit="kPa"
                  value={pressure}
                  min={50}
                  max={150}
                  step={0.1}
                  digits={1}
                  accentColor="#06b6d4"
                  onChange={setPressure}
                  onSlide={triggerFlare}
                />

                <TelemetrySlider
                  id="airflow-input"
                  label="Forced Airflow Velocity"
                  unit="cm/s"
                  value={airflow}
                  min={0}
                  max={50}
                  step={1}
                  digits={0}
                  accentColor="#eab308"
                  onChange={setAirflow}
                  onSlide={triggerFlare}
                />

                <div>
                  <label htmlFor="fuel-select" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Specimen Fuel Material
                  </label>
                  <select
                    id="fuel-select"
                    value={fuel}
                    onChange={(e) => {
                      setFuel(e.target.value);
                      triggerFlare();
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-700 bg-slate-900/90 text-slate-100 text-xs font-mono focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition-colors"
                  >
                    {FUELS.map((f) => (
                      <option key={f} value={f} className="bg-slate-950 text-slate-100">
                        {f}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={runSimulation}
                  disabled={runningSim}
                  className="w-full py-3 px-4 rounded-xl font-semibold text-xs tracking-wider uppercase transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer shadow-lg bg-gradient-to-r from-orange-500 via-amber-500 to-orange-600 hover:from-orange-400 hover:to-amber-500 text-slate-950 shadow-orange-500/25 hover:shadow-orange-500/40 disabled:opacity-50 disabled:cursor-wait"
                >
                  {runningSim ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-slate-950" aria-hidden="true" />
                      Computing Boundary Kinetics…
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-slate-950" aria-hidden="true" />
                      Run Simulation & Rank Risk
                    </>
                  )}
                </button>

                {simError && (
                  <div className="p-3 rounded-xl border border-rose-500/40 bg-rose-500/10 text-rose-200 text-xs flex items-center justify-between gap-2" role="alert">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400 flex-none" aria-hidden="true" />
                      <span>{simError}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSimError(null)}
                      className="px-2 py-0.5 rounded text-[11px] bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            </AerospacePanel>

            {/* Material Flammability Risk Matrix */}
            <AerospacePanel
              title="Material Flammability Risk Matrix"
              icon={AlertTriangle}
              accent="orange"
              right={
                <span className="font-mono text-[10px] px-2 py-0.5 rounded-full border border-slate-700 bg-slate-900/80 text-slate-400">
                  {remoteRank ? 'Backend Grounded' : 'Empirical Estimate'}
                </span>
              }
            >
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {(['High', 'Medium', 'Low']).map((tier) => {
                    const info = TIERS[tier];
                    const items = byTier[tier] || [];
                    return (
                      <div
                        key={tier}
                        className="p-3 rounded-xl border bg-slate-950/40 flex flex-col justify-between"
                        style={{ borderColor: info.color + '40' }}
                      >
                        <div className="pb-2 border-b border-slate-800/80 flex items-center justify-between">
                          <span className="font-bold text-xs" style={{ color: info.color }}>
                            {info.title}
                          </span>
                          <span
                            className="font-mono text-[10px] px-1.5 py-0.2 rounded-full font-bold"
                            style={{ backgroundColor: info.bg, color: info.color }}
                          >
                            {items.length}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1 mb-2 leading-tight">
                          {info.hint}
                        </p>
                        <div className="space-y-1.5">
                          {items.length === 0 ? (
                            <span className="text-[11px] text-slate-500 italic">None in this regime</span>
                          ) : (
                            items.map((r) => {
                              const isSelected = r.material.toLowerCase().includes(selectedFuelId.toLowerCase());
                              return (
                                <div
                                  key={r.material}
                                  className={`p-2 rounded-lg border text-xs transition-colors ${
                                    isSelected
                                      ? 'border-cyan-400 bg-cyan-950/40 shadow-sm shadow-cyan-500/20'
                                      : 'border-slate-800/80 bg-slate-900/60'
                                  }`}
                                >
                                  <div className="flex justify-between items-center text-[11px] mb-1">
                                    <span className="font-medium text-slate-200 truncate">{r.material}</span>
                                    <span className="font-mono font-bold" style={{ color: info.color }}>
                                      {Math.round(r.score * 100)}
                                    </span>
                                  </div>
                                  <div className="w-full h-1.5 rounded-full bg-slate-800/80 overflow-hidden">
                                    <div
                                      className="h-full rounded-full transition-all duration-500"
                                      style={{
                                        width: `${r.score * 100}%`,
                                        backgroundColor: info.color,
                                      }}
                                    />
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {topRisk && (
                  <div className="p-3 rounded-xl border border-cyan-500/30 bg-cyan-950/20 text-xs flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Flame className="w-4 h-4 text-orange-400 flex-none" aria-hidden="true" />
                      <span className="text-slate-300">
                        Maximum Hazard in current regime:{' '}
                        <strong className="text-amber-300 font-semibold">{topRisk.material}</strong> (
                        <span className="font-mono text-cyan-300">{Math.round(topRisk.score * 100)}/100</span>)
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </AerospacePanel>
          </div>

          {/* ========================================================= */}
          {/* Right Column: AI Agent Chat Interface (Fixed & Scrollable) */}
          {/* ========================================================= */}
          <div className="lg:col-span-7 flex flex-col h-[780px] lg:h-[calc(100vh-135px)] min-h-[580px] max-h-[880px] min-w-0">
            <AerospacePanel
              title="AETHON Scientific Query Console"
              icon={Sparkles}
              accent="cyan"
              className="flex flex-col h-full min-h-0 overflow-hidden"
              right={
                <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-cyan-400 px-2.5 py-0.5 rounded-md border border-cyan-500/30 bg-cyan-950/30">
                  <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
                  RAG Anchored
                </span>
              }
            >
              {/* Message History List: flex-1, overflow-y-auto, min-h-0, internal scroll */}
              <div
                className="flex-1 overflow-y-auto min-h-0 p-4 sm:p-5 space-y-4 chat-inner"
                aria-live="polite"
              >
                {messages.map((m) => {
                  const isUser = m.role === 'user';
                  const isErr = m.error;
                  return (
                    <div
                      key={m.id}
                      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                    >
                      {/* Avatar */}
                      <div
                        className={`w-8 h-8 rounded-xl flex items-center justify-center flex-none font-bold text-xs ${
                          isUser
                            ? 'bg-gradient-to-br from-orange-500 to-amber-500 text-slate-950 shadow-md shadow-orange-500/20'
                            : 'border border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                        }`}
                      >
                        {isUser ? 'You' : <Flame className="w-4 h-4 text-orange-400" aria-hidden="true" />}
                      </div>

                      {/* Bubble */}
                      <div
                        className={`max-w-[88%] rounded-2xl p-4 text-[13.5px] leading-relaxed transition-all shadow-md ${
                          isUser
                            ? 'bg-gradient-to-r from-orange-500/15 to-amber-500/15 border border-orange-500/35 text-slate-100 rounded-tr-sm'
                            : isErr
                            ? 'bg-rose-500/10 border border-rose-500/40 text-rose-200 rounded-tl-sm'
                            : 'bg-slate-900/85 border border-slate-800 text-slate-200 rounded-tl-sm'
                        }`}
                      >
                        {isUser ? (
                          <p className="whitespace-pre-wrap">{m.text}</p>
                        ) : (
                          <div className="space-y-3">
                            <MarkdownRenderer
                              content={m.text}
                              sources={m.sources || []}
                              onOpenSource={setOpenSource}
                            />

                            {/* Grounded Citation & Source Chunks Accordion */}
                            {m.id !== 'welcome' && !m.error && (
                              <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {m.sources && m.sources.length > 0 ? (
                                    m.sources.map((src, i) => (
                                      <button
                                        key={i}
                                        type="button"
                                        onClick={() => setOpenSource(src)}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-slate-700 hover:border-cyan-500/60 bg-slate-950/70 text-slate-300 hover:text-cyan-300 text-[11px] font-mono transition-colors cursor-pointer"
                                        title="Click to view passage text"
                                      >
                                        <FileText className="w-3 h-3 text-cyan-400 flex-none" aria-hidden="true" />
                                        <span className="truncate max-w-[140px]">
                                          {src.filename || src.source || 'NASA Paper'}
                                        </span>
                                      </button>
                                    ))
                                  ) : (
                                    <span className="text-[11px] text-slate-500 italic">
                                      Domain lock applied
                                    </span>
                                  )}
                                </div>
                                {m.confidence != null && (
                                  <span className="font-mono text-[11px] text-emerald-400 font-semibold">
                                    {pct(m.confidence)}% Confidence
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Thinking / Streaming Indicator */}
                {thinking && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-cyan-300 text-xs font-mono w-fit animate-pulse">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" aria-hidden="true" />
                    <span>Cross-referencing NASA microgravity literature…</span>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Quick Starter Suggestions */}
              <div className="px-4 py-2 border-t border-slate-800/60 bg-slate-950/40 flex items-center gap-2 overflow-x-auto no-scrollbar flex-shrink-0">
                <span className="text-[11px] text-slate-500 font-mono flex items-center gap-1 flex-none">
                  <Sparkles className="w-3 h-3 text-amber-400" aria-hidden="true" /> Quick:
                </span>
                {SUGGESTED_QUERIES.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => sendQuery(q)}
                    disabled={thinking}
                    className="flex-none px-2.5 py-1 rounded-full border border-slate-800 hover:border-cyan-500/50 bg-slate-900/80 hover:bg-cyan-950/30 text-slate-300 hover:text-cyan-200 text-[11px] transition-colors cursor-pointer disabled:opacity-50 truncate max-w-[240px]"
                  >
                    {q}
                  </button>
                ))}
              </div>

              {/* Chat Input Prompt Bar: Pinned cleanly at bottom, flex-shrink-0 */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendQuery();
                }}
                className="p-3 sm:p-4 border-t border-slate-800/80 bg-slate-950/90 backdrop-blur-md flex items-center gap-2 flex-shrink-0"
              >
                <input
                  ref={chatInputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Ask about microgravity flame spread, extinction limits, or paper results…"
                  aria-label="Input query for NASA combustion AI"
                  disabled={thinking}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-slate-700/80 bg-slate-900/90 text-slate-100 placeholder:text-slate-500 text-xs sm:text-sm focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition-colors disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!draft.trim() || thinking}
                  className="px-4 py-2.5 rounded-xl font-bold text-xs tracking-wider uppercase transition-all duration-150 flex items-center gap-1.5 cursor-pointer bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-400 hover:to-cyan-500 text-slate-950 disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-cyan-500/20"
                >
                  <Send className="w-3.5 h-3.5 fill-slate-950" aria-hidden="true" />
                  <span className="hidden sm:inline">Send</span>
                </button>
              </form>
            </AerospacePanel>
          </div>
        </div>

        {/* ========================================================= */}
        {/* Full-Width Telemetry: Flame Behavior Index Data Table       */}
        {/* ========================================================= */}
        <AerospacePanel
          title="NASA Flight Experiment Flame Behavior Index"
          icon={Activity}
          accent="emerald"
          className="w-full"
          right={
            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={showAllGravity}
                  onChange={(e) => setShowAllGravity(e.target.checked)}
                  className="rounded border-slate-700 text-orange-500 focus:ring-0 cursor-pointer"
                />
                <span>All Gravity Modes</span>
              </label>
              <select
                value={riskFilter}
                onChange={(e) => setRiskFilter(e.target.value)}
                aria-label="Filter runs by hazard level"
                className="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-900 text-slate-200 text-xs font-mono"
              >
                {['All', 'High', 'Medium', 'Low'].map((r) => (
                  <option key={r} value={r}>
                    {r === 'All' ? 'All Tiers' : `${r} Hazard`}
                  </option>
                ))}
              </select>
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-950/60 border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[11px] font-mono">
                  <th className="p-3.5">
                    <button
                      type="button"
                      onClick={() => toggleSort('fuel')}
                      className="inline-flex items-center gap-1 hover:text-cyan-300 transition-colors cursor-pointer"
                    >
                      <span>Fuel Material</span>
                      {sort.key === 'fuel' && (sort.dir === 'asc' ? <ArrowUp className="w-3 h-3 text-cyan-400" /> : <ArrowDown className="w-3 h-3 text-cyan-400" />)}
                    </button>
                  </th>
                  <th className="p-3.5">
                    <button
                      type="button"
                      onClick={() => toggleSort('gravity')}
                      className="inline-flex items-center gap-1 hover:text-cyan-300 transition-colors cursor-pointer"
                    >
                      <span>Gravity</span>
                      {sort.key === 'gravity' && (sort.dir === 'asc' ? <ArrowUp className="w-3 h-3 text-cyan-400" /> : <ArrowDown className="w-3 h-3 text-cyan-400" />)}
                    </button>
                  </th>
                  <th className="p-3.5 text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort('o2')}
                      className="inline-flex items-center gap-1 hover:text-cyan-300 transition-colors cursor-pointer ml-auto"
                    >
                      <span>O₂ Concentration</span>
                      {sort.key === 'o2' && (sort.dir === 'asc' ? <ArrowUp className="w-3 h-3 text-cyan-400" /> : <ArrowDown className="w-3 h-3 text-cyan-400" />)}
                    </button>
                  </th>
                  <th className="p-3.5 text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort('airflow')}
                      className="inline-flex items-center gap-1 hover:text-cyan-300 transition-colors cursor-pointer ml-auto"
                    >
                      <span>Airflow Velocity</span>
                      {sort.key === 'airflow' && (sort.dir === 'asc' ? <ArrowUp className="w-3 h-3 text-cyan-400" /> : <ArrowDown className="w-3 h-3 text-cyan-400" />)}
                    </button>
                  </th>
                  <th className="p-3.5 text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort('spread')}
                      className="inline-flex items-center gap-1 hover:text-cyan-300 transition-colors cursor-pointer ml-auto"
                    >
                      <span>Spread Rate (mm/s)</span>
                      {sort.key === 'spread' && (sort.dir === 'asc' ? <ArrowUp className="w-3 h-3 text-cyan-400" /> : <ArrowDown className="w-3 h-3 text-cyan-400" />)}
                    </button>
                  </th>
                  <th className="p-3.5">
                    <button
                      type="button"
                      onClick={() => toggleSort('risk')}
                      className="inline-flex items-center gap-1 hover:text-cyan-300 transition-colors cursor-pointer"
                    >
                      <span>Hazard Tier</span>
                      {sort.key === 'risk' && (sort.dir === 'asc' ? <ArrowUp className="w-3 h-3 text-cyan-400" /> : <ArrowDown className="w-3 h-3 text-cyan-400" />)}
                    </button>
                  </th>
                  <th className="p-3.5 text-right">NTRS Record</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {tableRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-500 italic">
                      No experiment runs match the current filter selection.
                    </td>
                  </tr>
                ) : (
                  tableRows.map((r) => {
                    const isSelected = r.fuel === selectedFuelId;
                    const tierColor = TIERS[r.risk]?.color || '#10b981';
                    return (
                      <tr
                        key={r.id}
                        className={`transition-colors ${
                          isSelected ? 'bg-cyan-950/20' : 'hover:bg-slate-900/40'
                        }`}
                      >
                        <td className="p-3.5 font-medium text-slate-200">{r.fuel}</td>
                        <td className="p-3.5 font-mono text-slate-300">{r.gravity}</td>
                        <td className="p-3.5 font-mono text-right text-slate-300">{r.o2}%</td>
                        <td className="p-3.5 font-mono text-right text-slate-300">{r.airflow} cm/s</td>
                        <td className="p-3.5 font-mono text-right font-bold text-amber-300">
                          {r.spread.toFixed(1)}
                        </td>
                        <td className="p-3.5">
                          <span
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                            style={{
                              backgroundColor: TIERS[r.risk]?.bg || 'rgba(16,185,129,0.1)',
                              color: tierColor,
                            }}
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ backgroundColor: tierColor }}
                            />
                            {r.risk}
                          </span>
                        </td>
                        <td className="p-3.5 text-right">
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-200 font-medium transition-colors"
                          >
                            <span>NASA Archive</span>
                            <ExternalLink className="w-3 h-3" aria-hidden="true" />
                          </a>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="p-3.5 bg-slate-950/40 border-t border-slate-800/80 text-[11px] text-slate-500 font-mono flex items-center justify-between">
            <span>NASA Microgravity Physical Sciences Informatics (PSI) Database Dataset Reference</span>
            <span>559 Technical Documents Synchronized</span>
          </div>
        </AerospacePanel>
      </main>

      {/* Raw Passage Modal Viewer */}
      {openSource && (
        <SourceModal source={openSource} onClose={() => setOpenSource(null)} />
      )}
    </div>
  );
}

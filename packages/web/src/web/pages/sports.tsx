import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import {
  Trophy,
  Loader2,
  AlertTriangle,
  Goal,
  Activity,
  ShieldHalf,
  Globe,
  CalendarDays,
  RefreshCw,
  SlidersHorizontal,
  Clock,
  Star,
  Users,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  XCircle,
  History,
  X,
  DollarSign,
  BarChart2,
  BrainCircuit,
  Wallet,
  Target,
  AlertOctagon,
  PiggyBank,
  TrendingDown,
  Percent,
} from "lucide-react";
import { api } from "../lib/api";
import {
  loadTrackerRecords, saveTrackerRecord, resolveTrackerRecord, deleteTrackerRecord,
  loadBankroll, saveBankroll, initBankroll, calcKelly, calcQuarterKelly,
  calcTrackerStats, updateTrackerRecord,
  type TrackerRecord, type BankrollState, type TrackerStats,
} from "../lib/tracker-client";

// ─── XGBoost Ensemble ─────────────────────────────────────────────────────────

interface ShapValue { feature: string; shap: number }
interface ShapResult { predictedClass: number; values: ShapValue[] }

interface EnsembleResult {
  source: string;
  trainingSamples?: number;
  warning?: string;
  dixonColes?: { probHome: number; probDraw: number; probAway: number };
  xgboost?: { probHome: number; probDraw: number; probAway: number };
  calibrated?: { probHome: number; probDraw: number; probAway: number };
  ensemble?: { probHome: number; probDraw: number; probAway: number };
  confidence?: "high" | "medium" | "low";
  featureImportance?: Record<string, number>;
  shap?: ShapResult;
}

async function fetchEnsemble(p: any, history: any[]): Promise<EnsembleResult | null> {
  try {
    const target = {
      probHome: p.probHome,
      probDraw: p.probDraw,
      probAway: p.probAway,
      eloDiff: (p.eloHome ?? 1500) - (p.eloAway ?? 1500),
      xgDiff: (p.expHomeGoals ?? 1.5) - (p.expAwayGoals ?? 1.5),
      // Use actual recency-weighted dominanceScore if available, else fallback
      h2hDominance: p.h2h?.dominanceScore ?? (p.h2h?.dominance === "home" ? 0.6 : p.h2h?.dominance === "away" ? -0.6 : 0),
      homeRestDays: p.fatigue?.homeRestDays ?? 4,
      awayRestDays: p.fatigue?.awayRestDays ?? 4,
      homeMotivation: p.importanceHome?.factor ?? 1.0,
      awayMotivation: p.importanceAway?.factor ?? 1.0,
      homeFormPct: p.formHome ? (p.formHome.split("").filter((c: string) => c === "W").length / 5) : 0.5,
      awayFormPct: p.formAway ? (p.formAway.split("").filter((c: string) => c === "W").length / 5) : 0.5,
      logSample: Math.log(Math.max(history.length, 1)),
    };

    const samples = history.slice(-300).map((m: any) => {
      // Derive outcome from actual scores if not already set
      let outcome = m.outcome ?? null;
      if (outcome === null && m.hg != null && m.ag != null) {
        outcome = m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2;
      }
      return {
        probHome: m.probHome ?? 0.4,
        probDraw: m.probDraw ?? 0.3,
        probAway: m.probAway ?? 0.3,
        eloDiff: (m.eloHome ?? 1500) - (m.eloAway ?? 1500),
        xgDiff: (m.expHomeGoals ?? 1.5) - (m.expAwayGoals ?? 1.5),
        h2hDominance: m.h2hDominance ?? 0,
        homeRestDays: m.homeRestDays ?? 4,
        awayRestDays: m.awayRestDays ?? 4,
        homeMotivation: m.homeMotivation ?? 1,
        awayMotivation: m.awayMotivation ?? 1,
        homeFormPct: m.homeFormPct ?? 0.5,
        awayFormPct: m.awayFormPct ?? 0.5,
        logSample: Math.log(Math.max(history.length, 1)),
        outcome,
      };
    }).filter((s: any) => s.outcome !== null);

    const res = await fetch("/api/ml/football/ensemble", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history: samples, target }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ─── Injury Panel ─────────────────────────────────────────────────────────────

interface InjuredPlayer { name: string; reason: string; status: string }
interface InjuryData { eventId: number; home: InjuredPlayer[]; away: InjuredPlayer[]; sources: string[] }

function InjuryPanel({ homeTeam, awayTeam }: { homeTeam: string; awayTeam: string }) {
  const [eventId, setEventId] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSearching(true);
    const query = encodeURIComponent(`${homeTeam} ${awayTeam}`);
    fetch(`https://api.sofascore.com/api/v1/search/events?q=${query}`, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json", Referer: "https://www.sofascore.com/" },
      signal: AbortSignal.timeout(6000),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d?.results?.[0]?.entity?.id) setEventId(d.results[0].entity.id);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSearching(false); });
    return () => { cancelled = true; };
  }, [homeTeam, awayTeam]);

  const injuries = useQuery<InjuryData>({
    queryKey: ["injuries", eventId],
    queryFn: async () => {
      const r = await fetch(`/api/ml/injuries/${eventId}?source=sofascore`);
      if (!r.ok) throw new Error("injuries failed");
      return r.json();
    },
    enabled: eventId !== null,
    staleTime: 1000 * 60 * 10,
  });

  const data = injuries.data;
  const hasData = data && (data.home.length > 0 || data.away.length > 0);

  if (!hasData && !searching && !injuries.isLoading) return null;

  return (
    <div className="rounded-xl bg-[var(--mp-bg)] border border-[var(--mp-border-soft)] p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Activity className="w-3.5 h-3.5 text-rose-400" />
        <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--mp-muted)]">Lesionados / Suspensos</span>
        {injuries.isLoading || searching ? (
          <Loader2 className="w-3 h-3 animate-spin text-[var(--mp-muted)] ml-auto" />
        ) : data?.sources?.length ? (
          <span className="ml-auto text-[9px] text-[var(--mp-muted)]">{data.sources.join(", ")}</span>
        ) : null}
      </div>
      {hasData && (
        <div className="grid grid-cols-2 gap-3">
          {(["home", "away"] as const).map((side) => (
            <div key={side}>
              <div className="text-[9px] font-bold uppercase tracking-wider text-[var(--mp-muted)] mb-1">
                {side === "home" ? homeTeam : awayTeam}
              </div>
              {data![side].length === 0 ? (
                <div className="text-[10px] text-emerald-400">Plantel completo</div>
              ) : (
                <div className="space-y-0.5">
                  {data![side].map((p, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px]">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        p.status === "absent" ? "bg-rose-400" : "bg-amber-400"
                      }`} />
                      <span className="text-[var(--mp-text)]">{p.name}</span>
                      <span className="text-[var(--mp-muted)] truncate">({p.reason})</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SHAP Panel ──────────────────────────────────────────────────────────────

function ShapPanel({ shap, classLabels }: { shap?: ShapResult; classLabels: string[] }) {
  if (!shap?.values?.length) return null;
  const sorted = [...shap.values].sort((a, b) => Math.abs(b.shap) - Math.abs(a.shap)).slice(0, 8);
  const maxAbs = Math.max(...sorted.map(v => Math.abs(v.shap)), 0.001);
  const predicted = classLabels[shap.predictedClass] ?? "?";
  return (
    <div className="rounded-xl border border-[var(--mp-border-soft)] bg-[var(--mp-surface)] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-violet-400">SHAP — Explicação da previsão</span>
        </div>
        <span className="text-[9px] text-[var(--mp-muted)]">Classe prevista: <b className="text-[var(--mp-accent)]">{predicted}</b></span>
      </div>
      <div className="space-y-1.5">
        {sorted.map((v) => {
          const pct = Math.abs(v.shap) / maxAbs * 100;
          const positive = v.shap > 0;
          return (
            <div key={v.feature} className="flex items-center gap-2">
              <div className="w-28 text-[9px] text-[var(--mp-muted)] truncate text-right">{v.feature}</div>
              <div className="flex-1 h-4 bg-[var(--mp-bg)] rounded overflow-hidden relative">
                <div
                  className={`h-full rounded transition-all ${positive ? "bg-emerald-500/70" : "bg-rose-500/70"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className={`w-12 text-[9px] font-mono-n text-right ${positive ? "text-emerald-400" : "text-rose-400"}`}>
                {positive ? "+" : ""}{v.shap.toFixed(3)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[9px] text-[var(--mp-muted)]">Verde = favorece esta previsão · Vermelho = contraria</div>
    </div>
  );
}

// ─── Odds Edge Panel ─────────────────────────────────────────────────────────

function OddsEdgePanel({ ensemble, home, draw, away }: {
  ensemble?: { probHome: number; probDraw: number; probAway: number };
  home: string; draw: string; away: string;
}) {
  const modelProbs = ensemble;
  if (!modelProbs) return null;
  const hOdd = parseFloat(home), dOdd = parseFloat(draw), aOdd = parseFloat(away);
  if (isNaN(hOdd) || isNaN(dOdd) || isNaN(aOdd)) return null;
  if (hOdd < 1.01 || dOdd < 1.01 || aOdd < 1.01) return null;

  const impliedH = 1 / hOdd, impliedD = 1 / dOdd, impliedA = 1 / aOdd;
  const overround = impliedH + impliedD + impliedA;
  // De-juiced implied probs
  const trueH = impliedH / overround, trueD = impliedD / overround, trueA = impliedA / overround;

  const edgeH = modelProbs.probHome - trueH;
  const edgeD = modelProbs.probDraw - trueD;
  const edgeA = modelProbs.probAway - trueA;

  const edges = [
    { label: "Casa (1)", edge: edgeH, modelProb: modelProbs.probHome, impliedProb: trueH },
    { label: "Empate (X)", edge: edgeD, modelProb: modelProbs.probDraw, impliedProb: trueD },
    { label: "Fora (2)", edge: edgeA, modelProb: modelProbs.probAway, impliedProb: trueA },
  ];
  const bestEdge = edges.reduce((a, b) => Math.abs(a.edge) > Math.abs(b.edge) ? a : b);
  const hasEdge = bestEdge.edge > 0.04; // >4pp edge = meaningful signal

  return (
    <div className={`rounded-xl border p-3 space-y-2 ${hasEdge ? "border-amber-500/30 bg-amber-500/5" : "border-[var(--mp-border-soft)] bg-[var(--mp-surface)]"}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Detector de Edge</span>
        <span className="text-[9px] text-[var(--mp-muted)]">Overround: {((overround - 1) * 100).toFixed(1)}%</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {edges.map(({ label, edge, modelProb, impliedProb }) => {
          const isPositive = edge > 0;
          const significant = Math.abs(edge) > 0.04;
          return (
            <div key={label} className={`rounded-lg p-2 text-center border ${
              isPositive && significant ? "border-emerald-500/40 bg-emerald-500/10" :
              !isPositive && significant ? "border-rose-500/30 bg-rose-500/5" :
              "border-[var(--mp-border)] bg-[var(--mp-bg)]"
            }`}>
              <div className="text-[9px] text-[var(--mp-muted)] mb-1">{label}</div>
              <div className={`text-sm font-bold font-mono-n ${isPositive ? "text-emerald-400" : "text-rose-400"}`}>
                {isPositive ? "+" : ""}{(edge * 100).toFixed(1)}pp
              </div>
              <div className="text-[9px] text-[var(--mp-muted)] mt-0.5">
                Modelo: {(modelProb * 100).toFixed(0)}% · Bookie: {(impliedProb * 100).toFixed(0)}%
              </div>
            </div>
          );
        })}
      </div>
      {hasEdge ? (
        <div className="text-[9px] text-amber-300 bg-amber-500/10 rounded px-2 py-1">
          ⚡ O modelo vê edge positivo em <b>{bestEdge.label}</b> ({(bestEdge.edge * 100).toFixed(1)}pp acima da odd implícita).
          Não é conselho de aposta — apenas divergência entre modelo e mercado.
        </div>
      ) : (
        <div className="text-[9px] text-[var(--mp-muted)] px-1">Nenhum edge significativo (&gt;4pp) detectado nestas odds.</div>
      )}
    </div>
  );
}

// ─── Kelly Criterion Panel ────────────────────────────────────────────────────

interface KellyEntry {
  label: string;
  modelProb: number;
  odds: number;
  edge: number;
  kelly: number;
  quarterKelly: number;
  isValue: boolean;
}

function KellyPanel({
  ensemble, homeOdds, drawOdds, awayOdds, bankroll, onSaveKelly
}: {
  ensemble?: { probHome: number; probDraw: number; probAway: number };
  homeOdds: string; drawOdds: string; awayOdds: string;
  bankroll: number | null;
  onSaveKelly?: (entry: KellyEntry) => void;
}) {
  if (!ensemble) return null;
  const hOdd = parseFloat(homeOdds), dOdd = parseFloat(drawOdds), aOdd = parseFloat(awayOdds);
  if (isNaN(hOdd) || isNaN(dOdd) || isNaN(aOdd)) return null;
  if (hOdd < 1.01 || dOdd < 1.01 || aOdd < 1.01) return null;

  const impliedH = 1/hOdd, impliedD = 1/dOdd, impliedA = 1/aOdd;
  const overround = impliedH + impliedD + impliedA;
  const trueH = impliedH/overround, trueD = impliedD/overround, trueA = impliedA/overround;

  const entries: KellyEntry[] = [
    { label: "Casa (1)", modelProb: ensemble.probHome, odds: hOdd, edge: ensemble.probHome - trueH, kelly: calcKelly(ensemble.probHome, hOdd), quarterKelly: calcQuarterKelly(ensemble.probHome, hOdd), isValue: ensemble.probHome - trueH >= 0.05 },
    { label: "Empate (X)", modelProb: ensemble.probDraw, odds: dOdd, edge: ensemble.probDraw - trueD, kelly: calcKelly(ensemble.probDraw, dOdd), quarterKelly: calcQuarterKelly(ensemble.probDraw, dOdd), isValue: ensemble.probDraw - trueD >= 0.05 },
    { label: "Fora (2)", modelProb: ensemble.probAway, odds: aOdd, edge: ensemble.probAway - trueA, kelly: calcKelly(ensemble.probAway, aOdd), quarterKelly: calcQuarterKelly(ensemble.probAway, aOdd), isValue: ensemble.probAway - trueA >= 0.05 },
  ];
  const bestValueBet = entries.filter(e => e.isValue && e.kelly > 0).sort((a, b) => b.edge - a.edge)[0] ?? null;

  return (
    <div className="rounded-xl border border-[var(--mp-border-soft)] bg-[var(--mp-surface)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Wallet size={13} className="text-[var(--mp-cyan)]" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--mp-cyan)]">Kelly Criterion — Gestão de Bankroll</span>
      </div>

      {/* No value bet alert */}
      {!bestValueBet && (
        <div className="flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2">
          <AlertOctagon size={13} className="text-rose-400 shrink-0" />
          <span className="text-[11px] text-rose-300 font-medium">Sem edge suficiente (&gt;5pp) — recomendação: <b>NÃO APOSTAR</b></span>
        </div>
      )}

      {/* Kelly grid */}
      <div className="grid grid-cols-3 gap-2">
        {entries.map(e => {
          const stakeEur = bankroll ? e.quarterKelly * bankroll : null;
          const noEdge = e.edge < 0.05 || e.kelly === 0;
          return (
            <div key={e.label} className={`rounded-lg border p-2.5 space-y-1.5 ${
              e.isValue && e.kelly > 0
                ? "border-emerald-500/40 bg-emerald-500/8"
                : "border-[var(--mp-border)] bg-[var(--mp-bg)] opacity-60"
            }`}>
              <div className="text-[9px] text-[var(--mp-muted)] font-semibold uppercase">{e.label}</div>
              <div className="text-xs font-mono-n font-bold text-[var(--mp-text)]">
                {noEdge ? "—" : `${(e.quarterKelly * 100).toFixed(1)}%`}
              </div>
              <div className="text-[9px] text-[var(--mp-muted)]">
                {stakeEur && !noEdge ? `≈ €${(stakeEur).toFixed(0)} de €${bankroll!.toFixed(0)}` : "Quarter Kelly"}
              </div>
              <div className={`text-[9px] font-mono-n ${e.edge > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                Edge: {e.edge > 0 ? "+" : ""}{(e.edge * 100).toFixed(1)}pp
              </div>
              {e.isValue && e.kelly > 0 && onSaveKelly && (
                <button onClick={() => onSaveKelly(e)}
                  className="w-full text-[9px] py-0.5 rounded border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/15 transition">
                  + Guardar aposta
                </button>
              )}
            </div>
          );
        })}
      </div>

      {bestValueBet && (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/25 px-3 py-2 text-[11px] space-y-1">
          <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
            <Target size={11} /> VALUE BET DETECTADA
          </div>
          <div className="text-[var(--mp-muted)]">
            <b className="text-[var(--mp-text)]">{bestValueBet.label}</b> · Modelo {(bestValueBet.modelProb*100).toFixed(1)}% vs Bookie {(100/bestValueBet.odds).toFixed(1)}% · Edge <b className="text-emerald-400">+{(bestValueBet.edge*100).toFixed(1)}pp</b>
          </div>
          <div className="text-[var(--mp-muted)]">
            Kelly completo: {(bestValueBet.kelly*100).toFixed(1)}% · <b>Quarter Kelly recomendado: {(bestValueBet.quarterKelly*100).toFixed(1)}%</b>
            {bankroll ? ` ≈ €${(bestValueBet.quarterKelly * bankroll).toFixed(0)}` : ""}
          </div>
        </div>
      )}

      <div className="text-[9px] text-[var(--mp-muted)] border-t border-[var(--mp-border)] pt-2">
        Quarter Kelly = Kelly × 0.25 · Reduz variância · Não é conselho financeiro
      </div>
    </div>
  );
}

// ─── Bankroll Setup Widget ────────────────────────────────────────────────────
function BankrollWidget({ bankroll, onChange }: { bankroll: BankrollState | null; onChange: (b: BankrollState) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");

  const setup = () => {
    const n = parseFloat(val.replace(",", "."));
    if (!isNaN(n) && n > 0) {
      const br = initBankroll(n);
      onChange(br);
      setEditing(false);
    }
  };

  const pnl = bankroll ? bankroll.current - bankroll.initial : 0;
  const roi = bankroll && bankroll.initial > 0 ? (pnl / bankroll.initial) * 100 : 0;

  if (!bankroll && !editing) {
    return (
      <button onClick={() => setEditing(true)}
        className="flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-lg border border-[var(--mp-border)] text-[var(--mp-muted)] hover:border-[var(--mp-cyan)] hover:text-[var(--mp-cyan)] transition">
        <PiggyBank size={11} /> Definir bankroll
      </button>
    );
  }

  if (editing) return (
    <div className="flex items-center gap-2">
      <input value={val} onChange={e => setVal(e.target.value)} placeholder="ex: 500" className="mp-input w-24 text-sm" />
      <button onClick={setup} className="text-[10px] px-2 py-1 rounded border border-[var(--mp-bull)] text-[var(--mp-bull)]">OK</button>
      <button onClick={() => setEditing(false)} className="text-[10px] text-[var(--mp-muted)]"><X size={10}/></button>
    </div>
  );

  return (
    <div className="flex items-center gap-3 text-[11px]">
      <PiggyBank size={12} className="text-[var(--mp-cyan)]" />
      <span className="text-[var(--mp-muted)]">Bankroll:</span>
      <span className="font-mono-n font-bold text-[var(--mp-text)]">€{bankroll!.current.toFixed(0)}</span>
      <span className={`font-mono-n ${pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
        {pnl >= 0 ? "+" : ""}€{pnl.toFixed(0)} ({roi >= 0 ? "+" : ""}{roi.toFixed(1)}% ROI)
      </span>
      <button onClick={() => setEditing(true)} className="text-[9px] text-[var(--mp-muted)] underline">editar</button>
    </div>
  );
}

// ─── Ensemble Badge ───────────────────────────────────────────────────────────

function EnsembleBadge({ ensemble, calibrated, xgb, confidence, shap }: {
  ensemble?: { probHome: number; probDraw: number; probAway: number };
  calibrated?: { probHome: number; probDraw: number; probAway: number };
  xgb?: { probHome: number; probDraw: number; probAway: number };
  confidence?: string;
  shap?: ShapResult;
}) {
  const [showShap, setShowShap] = useState(false);
  if (!ensemble) return null;
  const confColor = confidence === "high" ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
    : confidence === "medium" ? "text-amber-400 border-amber-500/30 bg-amber-500/10"
    : "text-slate-400 border-slate-500/30 bg-slate-500/10";

  return (
    <div className="rounded-xl border border-[var(--mp-border-soft)] bg-[color-mix(in_oklab,var(--mp-cyan)_5%,transparent)] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5 text-[var(--mp-cyan)]" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--mp-cyan)]">XGBoost + Calibração Isotónica</span>
        </div>
        <div className="flex items-center gap-2">
          {shap?.values?.length ? (
            <button onClick={() => setShowShap(v => !v)}
              className="text-[9px] text-violet-400 border border-violet-500/30 px-1.5 py-0.5 rounded hover:bg-violet-500/10 transition-colors">
              {showShap ? "Ocultar SHAP" : "SHAP"}
            </button>
          ) : null}
          {confidence && (
            <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded border ${confColor}`}>
              {confidence === "high" ? "Alta confiança" : confidence === "medium" ? "Média" : "Baixa"}
            </span>
          )}
        </div>
      </div>
      {/* Ensemble (main) */}
      <div>
        <div className="text-[9px] text-[var(--mp-muted)] mb-1 uppercase tracking-wider">Ensemble final (DC 65% + XGB calibrado 35%)</div>
        <div className="flex h-8 rounded-lg overflow-hidden text-[10px] font-bold">
          <div className="flex items-center justify-center bg-green-500/80 text-white" style={{ width: `${ensemble.probHome * 100}%` }}>
            {(ensemble.probHome * 100).toFixed(0)}%
          </div>
          <div className="flex items-center justify-center bg-slate-400/80 text-white" style={{ width: `${ensemble.probDraw * 100}%` }}>
            {(ensemble.probDraw * 100).toFixed(0)}%
          </div>
          <div className="flex items-center justify-center bg-red-400/80 text-white" style={{ width: `${ensemble.probAway * 100}%` }}>
            {(ensemble.probAway * 100).toFixed(0)}%
          </div>
        </div>
      </div>
      {/* Model comparison row */}
      {(xgb || calibrated) && (
        <div className="grid grid-cols-2 gap-2">
          {xgb && (
            <div className="rounded-lg bg-[var(--mp-bg)] p-2">
              <div className="text-[9px] text-[var(--mp-muted)] mb-1">XGBoost puro</div>
              <div className="text-[10px] font-mono-n">
                {(xgb.probHome*100).toFixed(0)}% / {(xgb.probDraw*100).toFixed(0)}% / {(xgb.probAway*100).toFixed(0)}%
              </div>
            </div>
          )}
          {calibrated && (
            <div className="rounded-lg bg-[var(--mp-bg)] p-2">
              <div className="text-[9px] text-[var(--mp-muted)] mb-1">XGB + Isotónica</div>
              <div className="text-[10px] font-mono-n">
                {(calibrated.probHome*100).toFixed(0)}% / {(calibrated.probDraw*100).toFixed(0)}% / {(calibrated.probAway*100).toFixed(0)}%
              </div>
            </div>
          )}
        </div>
      )}
      {/* SHAP toggle */}
      {showShap && shap && <ShapPanel shap={shap} classLabels={["Vitória Casa", "Empate", "Vitória Fora"]} />}
    </div>
  );
}

// ---- Shared helpers ----

function formatDatePt(iso: string): string {
  const [y, m, dd] = iso.split("-");
  const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${dd} ${months[parseInt(m, 10) - 1]} ${y}`;
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 text-sm px-4 py-2 rounded-xl border transition-all font-medium ${
        active
          ? "border-[var(--mp-cyan)] text-[var(--mp-cyan)] bg-[var(--mp-cyan-light)]"
          : "border-[var(--mp-border)] text-[var(--mp-muted)] hover:text-[var(--mp-text)] hover:border-[var(--mp-muted)]"
      }`}
    >
      {children}
    </button>
  );
}

function SubPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
        active
          ? "bg-[var(--mp-cyan-light)] text-[var(--mp-cyan)] border border-[var(--mp-cyan)]/40"
          : "text-[var(--mp-muted)] border border-[var(--mp-border)] hover:text-[var(--mp-text)]"
      }`}
    >
      {children}
    </button>
  );
}

function LeagueChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all border ${
        active
          ? "bg-[var(--mp-cyan)] text-white border-[var(--mp-cyan)]"
          : "text-[var(--mp-muted)] border-[var(--mp-border)] hover:border-[var(--mp-cyan)] hover:text-[var(--mp-cyan)]"
      }`}
    >
      {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-[var(--mp-muted)] mb-1.5 block font-semibold">{label}</span>
      {children}
    </label>
  );
}

function TeamHead({ name, elo, side }: { name: string; elo: number; side: "home" | "away" }) {
  return (
    <div className={side === "away" ? "text-right" : ""}>
      <div className="font-display font-bold text-sm md:text-base text-[var(--mp-text)]">{name}</div>
      <div className="font-mono-n text-xs text-[var(--mp-muted)]">Elo {elo}{side === "home" ? " (casa)" : ""}</div>
    </div>
  );
}

function Stat({ label, value, sub, accent, good }: { label: string; value: string; sub?: string; accent?: boolean; good?: boolean }) {
  const highlight = accent || good;
  return (
    <div className="rounded-xl bg-[var(--mp-bg)] border border-[var(--mp-border-soft)] p-3">
      <div className="text-[10px] uppercase tracking-wider text-[var(--mp-muted)] mb-1 font-semibold">{label}</div>
      <div className={`font-mono-n text-lg font-bold ${highlight ? "text-[var(--mp-cyan)]" : "text-[var(--mp-text)]"}`}>{value}</div>
      {sub && <div className="text-[10px] text-[var(--mp-muted)] font-mono-n">{sub}</div>}
    </div>
  );
}

function BacktestPanel({ bt, loading }: { bt: any; loading: boolean }) {
  if (loading) {
    return (
      <div className="mp-card p-4 flex items-center gap-2 text-[var(--mp-muted)] text-xs">
        <Loader2 className="animate-spin" size={14} /> rodando backtest walk-forward…
      </div>
    );
  }
  if (!bt || !bt.n) return null;
  const beatsBrier = bt.brier < bt.baselineBrier;
  const beatsLL = bt.logLoss < bt.baselineLogLoss;
  const skill = beatsBrier && beatsLL;
  const brierLift = (((bt.baselineBrier - bt.brier) / bt.baselineBrier) * 100).toFixed(1);
  return (
    <div className="rounded-xl bg-[var(--mp-bg)] border border-[var(--mp-border-soft)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldHalf size={15} className="text-[var(--mp-cyan)]" />
        <h2 className="font-display font-semibold text-sm">Precisão medida</h2>
        <span
          className={`ml-auto text-[10px] font-mono-n font-bold px-2 py-0.5 rounded-full ${
            skill
              ? "bg-green-100 text-green-700"
              : "bg-amber-100 text-amber-700"
          }`}
        >
          {skill ? `+${brierLift}% vs base` : "MARGINAL"}
        </span>
      </div>
      <p className="text-[11px] text-[var(--mp-muted)] leading-relaxed">
        Backtest walk-forward em {bt.n} jogos. Brier: {bt.brier?.toFixed(3)} vs {bt.baselineBrier?.toFixed(3)} baseline.
        Log-loss: {bt.logLoss?.toFixed(3)} vs {bt.baselineLogLoss?.toFixed(3)}.{" "}
        {skill ? "O modelo bate a base-rate em ambas as métricas." : "O ganho sobre a base é pequeno — atenção ao ruído."}
      </p>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Brier" value={bt.brier?.toFixed(3)} good={beatsBrier} />
        <Stat label="Log-Loss" value={bt.logLoss?.toFixed(3)} good={beatsLL} />
        <Stat label="Acertos 1X2" value={`${((bt.accuracy ?? 0) * 100).toFixed(0)}%`} />
      </div>
    </div>
  );
}

// ---- Shared advanced components ----

// Last-5 form badge: "WWDLW" → colored pill sequence
function FormBadge({ form, label }: { form: string; label: string }) {
  if (!form || form === "-") return null;
  const colors: Record<string, string> = {
    W: "bg-green-500 text-white",
    D: "bg-slate-400 text-white",
    L: "bg-red-400 text-white",
  };
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-[var(--mp-muted)] font-semibold uppercase tracking-wide w-14 shrink-0">{label}</span>
      <div className="flex gap-1">
        {form.split("").map((c, i) => (
          <span key={i} className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${colors[c] ?? "bg-[var(--mp-bg)] text-[var(--mp-muted)]"}`}>{c}</span>
        ))}
      </div>
    </div>
  );
}

// Over/Under table for 0.5–4.5 lines
function OUTable({ ouLines }: { ouLines: { line: number; over: number; under: number }[] }) {
  if (!ouLines?.length) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--mp-muted)] mb-2 font-semibold">Over/Under</div>
      <div className="rounded-xl overflow-hidden border border-[var(--mp-border-soft)]">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[var(--mp-bg)] text-[var(--mp-muted)]">
              <th className="px-3 py-1.5 text-left font-semibold">Linha</th>
              <th className="px-3 py-1.5 text-right font-semibold">Over %</th>
              <th className="px-3 py-1.5 text-right font-semibold">Under %</th>
            </tr>
          </thead>
          <tbody>
            {ouLines.map((row) => (
              <tr key={row.line} className="border-t border-[var(--mp-border-soft)]">
                <td className="px-3 py-1.5 font-mono-n font-bold text-[var(--mp-text)]">{row.line}</td>
                <td className={`px-3 py-1.5 text-right font-mono-n font-bold ${row.over > 0.55 ? "text-[var(--mp-cyan)]" : "text-[var(--mp-muted)]"}`}>
                  {(row.over * 100).toFixed(1)}%
                </td>
                <td className={`px-3 py-1.5 text-right font-mono-n font-bold ${row.under > 0.55 ? "text-[var(--mp-cyan)]" : "text-[var(--mp-muted)]"}`}>
                  {(row.under * 100).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// EV panel: shows edge for each outcome and value badge
function EVPanel({ p, homeOdds, drawOdds, awayOdds, ev }: {
  p: any;
  homeOdds: string; drawOdds: string; awayOdds: string;
  ev?: { home: number | null; draw: number | null; away: number | null } | null;
}) {
  const outcomes = [
    { label: "Casa (1)", prob: p?.probHome, edge: ev?.home, odds: parseFloat(homeOdds) },
    { label: "Empate (X)", prob: p?.probDraw, edge: ev?.draw, odds: parseFloat(drawOdds) },
    { label: "Fora (2)", prob: p?.probAway, edge: ev?.away, odds: parseFloat(awayOdds) },
  ];
  const hasAny = outcomes.some((o) => !isNaN(o.odds) && o.odds > 1);
  if (!hasAny || !p) return null;
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--mp-muted)] font-semibold">Edge vs Casas de Apostas</div>
      {outcomes.map((o) => {
        const validOdds = !isNaN(o.odds) && o.odds > 1;
        const edge = validOdds && o.prob != null ? o.prob - 1 / o.odds : null;
        const isValue = edge != null && edge > 0.03;
        return (
          <div key={o.label} className={`flex items-center justify-between rounded-xl px-3 py-2 border text-xs ${
            isValue ? "bg-green-50 border-green-300" : "bg-[var(--mp-bg)] border-[var(--mp-border-soft)]"
          }`}>
            <span className="font-semibold text-[var(--mp-text)]">{o.label}</span>
            {validOdds ? (
              <div className="flex items-center gap-3">
                <span className="text-[var(--mp-muted)] font-mono-n">{o.prob != null ? `${(o.prob * 100).toFixed(1)}% modelo` : ""}</span>
                <span className="font-mono-n text-[var(--mp-muted)]">@{o.odds.toFixed(2)}</span>
                {edge != null && (
                  <span className={`font-mono-n font-bold ${edge > 0 ? "text-green-600" : "text-red-500"}`}>
                    {edge > 0 ? "+" : ""}{(edge * 100).toFixed(1)}%
                  </span>
                )}
                {isValue && (
                  <span className="text-[10px] font-bold bg-green-500 text-white rounded-full px-2 py-0.5">VALUE</span>
                )}
              </div>
            ) : (
              <span className="text-[var(--mp-muted)] text-[11px]">—</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Injury/suspension sliders for one team
function InjuryRow({
  label, attackMult, defenseMult, onAttack, onDefense
}: {
  label: string;
  attackMult: number; defenseMult: number;
  onAttack: (v: number) => void; onDefense: (v: number) => void;
}) {
  const pctLabel = (v: number) => v === 1 ? "Normal" : v > 1 ? `+${((v - 1) * 100).toFixed(0)}%` : `${((v - 1) * 100).toFixed(0)}%`;
  return (
    <div className="space-y-2 p-3 rounded-xl border border-[var(--mp-border-soft)] bg-[var(--mp-bg)]">
      <div className="text-[10px] uppercase tracking-wide font-bold text-[var(--mp-muted)]">{label}</div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--mp-muted)] w-14">Ataque</span>
          <input type="range" min={0.6} max={1.1} step={0.05} value={attackMult}
            onChange={(e) => onAttack(parseFloat(e.target.value))}
            className="flex-1 accent-[var(--mp-cyan)] h-1.5" />
          <span className={`text-[11px] font-mono-n font-bold w-14 text-right ${attackMult < 1 ? "text-red-500" : attackMult > 1 ? "text-green-600" : "text-[var(--mp-muted)]"}`}>
            {pctLabel(attackMult)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--mp-muted)] w-14">Defesa</span>
          <input type="range" min={0.6} max={1.1} step={0.05} value={defenseMult}
            onChange={(e) => onDefense(parseFloat(e.target.value))}
            className="flex-1 accent-[var(--mp-cyan)] h-1.5" />
          <span className={`text-[11px] font-mono-n font-bold w-14 text-right ${defenseMult < 1 ? "text-red-500" : defenseMult > 1 ? "text-green-600" : "text-[var(--mp-muted)]"}`}>
            {pctLabel(defenseMult)}
          </span>
        </div>
      </div>
    </div>
  );
}

// Motivation presets
const MOTIVATION_PRESETS = [
  { key: "normal",   label: "Normal",      factor: 1.0 },
  { key: "final",    label: "Final/Decisivo", factor: 0.82 },
  { key: "titulo",   label: "Título em jogo", factor: 0.90 },
  { key: "descida",  label: "Descida/Relegação", factor: 0.87 },
  { key: "amigavel", label: "Amigável",    factor: 1.12 },
  { key: "copa",     label: "Copa (2ª fase)", factor: 0.93 },
];

function MotivationSelect({ value, onChange }: { value: string; onChange: (key: string, factor: number) => void }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide font-bold text-[var(--mp-muted)] mb-1.5">Motivação / Contexto</div>
      <select
        value={value}
        onChange={(e) => {
          const preset = MOTIVATION_PRESETS.find((p) => p.key === e.target.value);
          if (preset) onChange(preset.key, preset.factor);
        }}
        className="mp-select w-full"
      >
        {MOTIVATION_PRESETS.map((p) => (
          <option key={p.key} value={p.key}>{p.label} (×{p.factor})</option>
        ))}
      </select>
    </div>
  );
}

// Asian Handicap panel (client-side compute from expected goals)
function HandicapPanel({ p }: { p: any }) {
  const [line, setLine] = useState(0);
  if (!p) return null;
  const lh = p.expHomeGoals;
  const la = p.expAwayGoals;
  const rho = p.rho ?? 0;
  // Compute handicap distribution client-side using Poisson
  function poissonPmf(k: number, lambda: number) {
    let f = 1;
    for (let i = 2; i <= k; i++) f *= i;
    return (Math.exp(-lambda) * lambda ** k) / f;
  }
  function tau(i: number, j: number) {
    if (i === 0 && j === 0) return 1 - lh * la * rho;
    if (i === 0 && j === 1) return 1 + lh * rho;
    if (i === 1 && j === 0) return 1 + la * rho;
    if (i === 1 && j === 1) return 1 - rho;
    return 1;
  }
  const MAX = 12;
  let homeCovers = 0, awayCovers = 0, push = 0, total = 0;
  for (let i = 0; i <= MAX; i++) {
    for (let j = 0; j <= MAX; j++) {
      const prob = poissonPmf(i, lh) * poissonPmf(j, la) * tau(i, j);
      total += prob;
      const margin = (i - j) - line;
      if (margin > 0) homeCovers += prob;
      else if (margin < 0) awayCovers += prob;
      else push += prob;
    }
  }
  const hc = total > 0 ? homeCovers / total : 0;
  const ac = total > 0 ? awayCovers / total : 0;
  const pu = total > 0 ? push / total : 0;

  return (
    <div className="space-y-3">
      <div className="text-[10px] uppercase tracking-wider text-[var(--mp-muted)] font-semibold">Handicap Asiático</div>
      <div className="flex items-center gap-3">
        <span className="text-[11px] text-[var(--mp-muted)] shrink-0">Linha:</span>
        <input type="range" min={-3} max={3} step={0.5} value={line}
          onChange={(e) => setLine(parseFloat(e.target.value))}
          className="flex-1 accent-[var(--mp-cyan)] h-1.5" />
        <span className="font-mono-n font-bold text-sm text-[var(--mp-text)] w-10 text-right">
          {line > 0 ? `+${line}` : line}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-[var(--mp-bg)] border border-[var(--mp-border-soft)] p-3 text-center">
          <div className="text-[10px] text-[var(--mp-muted)] font-semibold uppercase mb-1">Casa cobre</div>
          <div className={`font-mono-n font-bold text-lg ${hc > 0.5 ? "text-[var(--mp-cyan)]" : "text-[var(--mp-text)]"}`}>
            {(hc * 100).toFixed(1)}%
          </div>
        </div>
        {pu > 0.001 && (
          <div className="rounded-xl bg-[var(--mp-bg)] border border-[var(--mp-border-soft)] p-3 text-center">
            <div className="text-[10px] text-[var(--mp-muted)] font-semibold uppercase mb-1">Push</div>
            <div className="font-mono-n font-bold text-lg text-[var(--mp-muted)]">{(pu * 100).toFixed(1)}%</div>
          </div>
        )}
        <div className="rounded-xl bg-[var(--mp-bg)] border border-[var(--mp-border-soft)] p-3 text-center">
          <div className="text-[10px] text-[var(--mp-muted)] font-semibold uppercase mb-1">Fora cobre</div>
          <div className={`font-mono-n font-bold text-lg ${ac > 0.5 ? "text-[var(--mp-cyan)]" : "text-[var(--mp-text)]"}`}>
            {(ac * 100).toFixed(1)}%
          </div>
        </div>
      </div>
      <div className="text-[9px] text-[var(--mp-muted)]">Positivo = casa dá gols. Linha {line > 0 ? `+${line}` : line}: casa precisa vencer por mais de {Math.abs(line)} gol(s) para cobrir.</div>
    </div>
  );
}

// ---- Main export ----

export function SportsView() {
  const [tab, setTab] = useState<"football" | "euro" | "intl" | "nba">("football");
  return (
    <div>
      {/* Disclaimer */}
      <div className="mp-card p-3 mb-5 flex items-start gap-3" style={{ borderColor: "var(--mp-amber)", borderLeftWidth: 3 }}>
        <AlertTriangle size={16} className="text-[var(--mp-amber)] shrink-0 mt-0.5" />
        <p className="text-xs text-[var(--mp-muted)] leading-relaxed">
          <span className="text-[var(--mp-amber)] font-semibold">100% dados reais.</span> Zero odds de casas de apostas — previsões via{" "}
          <span className="font-semibold text-[var(--mp-text)]">Dixon-Coles</span> completo (recência, vantagem de casa calibrada, ρ, descanso).
          Cada aba mostra a <span className="font-semibold text-[var(--mp-text)]">precisão medida em backtest</span>. Probabilidade independente, não garantia.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 mb-6 overflow-x-auto no-scrollbar pb-1">
        <Pill active={tab === "football"} onClick={() => setTab("football")}>
          <Goal size={14} /> Ligas Domésticas
        </Pill>
        <Pill active={tab === "euro"} onClick={() => setTab("euro")}>
          <Star size={14} /> Internacional
        </Pill>
        <Pill active={tab === "intl"} onClick={() => setTab("intl")}>
          <Globe size={14} /> Seleções
        </Pill>
        <Pill active={tab === "nba"} onClick={() => setTab("nba")}>
          <Activity size={14} /> NBA
        </Pill>
      </div>

      {tab === "football" ? <Football /> : tab === "euro" ? <EuroFixtures /> : tab === "intl" ? <Intl /> : <Nba />}

      {/* Tracker panel below all tabs */}
      <div className="mt-6">
        <SportsTrackerPanel />
      </div>
    </div>
  );
}

// ---- Domestic Leagues ----

const FOOTBALL_LEAGUE_LIST = [
  { code: "E0",  name: "Premier League" },
  { code: "SP1", name: "La Liga" },
  { code: "D1",  name: "Bundesliga" },
  { code: "I1",  name: "Serie A" },
  { code: "F1",  name: "Ligue 1" },
  { code: "P1",  name: "Primeira Liga" },
];

function Football() {
  const [sub, setSub] = useState<"fixtures" | "sim">("fixtures");
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <SubPill active={sub === "fixtures"} onClick={() => setSub("fixtures")}>
          <CalendarDays size={13} /> Jogos do dia
        </SubPill>
        <SubPill active={sub === "sim"} onClick={() => setSub("sim")}>
          <SlidersHorizontal size={13} /> Simular jogo
        </SubPill>
      </div>
      {sub === "fixtures" ? <FootballFixtures /> : <FootballSim />}
    </div>
  );
}

function FootballFixtures() {
  const [league, setLeague] = useState("E0");
  const fixtures = useQuery({
    queryKey: ["fb-fixtures", league, new Date().toISOString().slice(0, 10)],
    queryFn: async () =>
      (await api.sports.football.fixtures.$get({ query: { league, days: "10" } })).json(),
    refetchInterval: 60_000,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const data = fixtures.data as any;
  const games: any[] = data?.games ?? [];
  const offseason = !!data?.offseason;
  const leagueName = FOOTBALL_LEAGUE_LIST.find((l) => l.code === league)?.name ?? league;

  const byDate = new Map<string, any[]>();
  for (const g of games) {
    if (!byDate.has(g.date)) byDate.set(g.date, []);
    byDate.get(g.date)!.push(g);
  }
  const dates = [...byDate.keys()].sort();

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="mp-card p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 mr-auto">
          <CalendarDays size={16} className="text-[var(--mp-cyan)]" />
          <h2 className="font-display font-semibold text-[var(--mp-text)]">Próximos jogos</h2>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {FOOTBALL_LEAGUE_LIST.map((l) => (
            <LeagueChip key={l.code} active={league === l.code} onClick={() => setLeague(l.code)} label={l.name} />
          ))}
        </div>
        <button
          onClick={() => fixtures.refetch()}
          className="flex items-center gap-1.5 text-[11px] text-[var(--mp-muted)] hover:text-[var(--mp-cyan)] transition-colors"
        >
          <RefreshCw size={13} className={fixtures.isFetching ? "animate-spin" : ""} />
          {fixtures.isFetching ? "a atualizar…" : "auto 60s"}
        </button>
      </div>

      {offseason && (
        <div className="mp-card p-3 flex items-start gap-2" style={{ borderLeftColor: "var(--mp-amber)", borderLeftWidth: 3 }}>
          <AlertTriangle size={14} className="text-[var(--mp-amber)] shrink-0 mt-0.5" />
          <p className="text-[11px] text-[var(--mp-muted)] leading-relaxed">
            {leagueName} está em <span className="font-semibold text-[var(--mp-amber)]">pausa de verão</span>. Próxima temporada 2026/27 começa em agosto. A mostrar a <span className="font-semibold text-[var(--mp-text)]">última ronda</span> como referência — os modelos continuam activos para previsões manuais.
          </p>
        </div>
      )}

      {fixtures.isLoading ? (
        <div className="mp-card p-10 flex items-center justify-center text-[var(--mp-muted)] text-sm">
          <Loader2 className="animate-spin mr-2" size={16} /> a carregar jogos…
        </div>
      ) : games.length === 0 ? (
        <div className="mp-card p-10 text-center text-[var(--mp-muted)] text-sm">
          Nenhum jogo encontrado para {leagueName}.
        </div>
      ) : (
        <div className="space-y-5">
          {dates.map((d) => (
            <div key={d} className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[var(--mp-muted)] px-1 font-semibold">
                <Clock size={12} /> {formatDatePt(d)}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {byDate.get(d)!.map((g, i) => (
                  <FixtureCard key={d + i} g={g} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FixtureCard({ g }: { g: any }) {
  const p = g.prediction;
  const fav =
    p && (p.probHome >= p.probDraw && p.probHome >= p.probAway
      ? "home"
      : p.probAway >= p.probDraw && p.probAway >= p.probHome
        ? "away"
        : "draw");
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="mp-card p-4 space-y-3 hover:shadow-md transition-shadow"
    >
      <div className="flex items-center justify-between text-[10px] text-[var(--mp-muted)] font-mono-n">
        <span>{g.round ?? ""}</span>
        <div className="flex items-center gap-2">
          {p?.isFriendly && (
            <span className="flex items-center gap-1 text-[var(--mp-amber)] bg-[color-mix(in_oklab,var(--mp-amber)_12%,transparent)] px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider border border-[color-mix(in_oklab,var(--mp-amber)_30%,transparent)]">
              ⚠ Amigável
            </span>
          )}
          {p?.confidence != null && (
            <ConfidenceBadge conf={p.confidence} />
          )}
          <span>{g.time ?? ""}</span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className={`text-sm font-semibold truncate flex-1 ${fav === "home" ? "text-[var(--mp-text)]" : "text-[var(--mp-muted)]"}`}>
          {g.home}
        </span>
        <span className="text-[10px] text-[var(--mp-muted)] font-mono-n shrink-0 bg-[var(--mp-bg)] rounded px-2 py-0.5">vs</span>
        <span className={`text-sm font-semibold truncate flex-1 text-right ${fav === "away" ? "text-[var(--mp-text)]" : "text-[var(--mp-muted)]"}`}>
          {g.away}
        </span>
      </div>
      {p?.isFriendly && (
        <div className="text-[10px] text-[var(--mp-amber)] bg-[color-mix(in_oklab,var(--mp-amber)_8%,transparent)] border border-[color-mix(in_oklab,var(--mp-amber)_20%,transparent)] rounded px-2 py-1 leading-tight">
          Jogo amigável — confiança reduzida (−30%). Resultados menos fiáveis que jogos competitivos.
        </div>
      )}
      {p ? (
        <>
          {/* 1X2 bar */}
          <div className="flex h-6 rounded-lg overflow-hidden text-[10px] font-mono-n font-bold">
            <div className="flex items-center justify-center bg-green-500 text-white" style={{ width: `${p.probHome * 100}%` }}>
              {(p.probHome * 100).toFixed(0)}
            </div>
            <div className="flex items-center justify-center bg-slate-400 text-white" style={{ width: `${p.probDraw * 100}%` }}>
              {(p.probDraw * 100).toFixed(0)}
            </div>
            <div className="flex items-center justify-center bg-red-400 text-white" style={{ width: `${p.probAway * 100}%` }}>
              {(p.probAway * 100).toFixed(0)}
            </div>
          </div>
          <div className="flex justify-between text-[9px] text-[var(--mp-muted)] uppercase tracking-wider font-semibold">
            <span>1 ({(p.probHome * 100).toFixed(0)}%)</span>
            <span>X ({(p.probDraw * 100).toFixed(0)}%)</span>
            <span>2 ({(p.probAway * 100).toFixed(0)}%)</span>
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono-n text-[var(--mp-muted)] pt-2 border-t border-[var(--mp-border-soft)]">
            <span className="font-semibold">xG {p.expHomeGoals.toFixed(1)}–{p.expAwayGoals.toFixed(1)}</span>
            <span className={p.over25 > 0.5 ? "text-[var(--mp-cyan)] font-semibold" : ""}>O2.5 {(p.over25 * 100).toFixed(0)}%</span>
            <span className={p.bttsYes > 0.5 ? "text-[var(--mp-cyan)] font-semibold" : ""}>BTTS {(p.bttsYes * 100).toFixed(0)}%</span>
            <span className="text-[var(--mp-accent)] font-bold">{p.topScores?.[0]?.score}</span>
          </div>
        </>
      ) : (
        <div className="text-[10px] text-[var(--mp-muted)] italic py-1">previsão indisponível</div>
      )}
    </motion.div>
  );
}

// Confidence badge component for sports
function ConfidenceBadge({ conf }: { conf: number }) {
  const color = conf >= 0.55 ? "var(--mp-bull)" : conf >= 0.35 ? "var(--mp-amber)" : "var(--mp-bear)";
  const label = conf >= 0.55 ? "Alta" : conf >= 0.35 ? "Média" : "Baixa";
  return (
    <span
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold font-mono-n uppercase border"
      style={{ color, background: `color-mix(in oklab, ${color} 12%, transparent)`, borderColor: `color-mix(in oklab, ${color} 35%, transparent)` }}
    >
      {(conf * 100).toFixed(0)}% conf · {label}
    </span>
  );
}

// Shared full prediction result display used by all sim panels
function PredictionResult({ p, ev, ensemble }: { p: any; ev?: any; ensemble?: EnsembleResult | null }) {
  const [resultTab, setResultTab] = useState<"1x2" | "ou" | "hc">("1x2");
  const [homeOdds, setHomeOdds] = useState("");
  const [drawOdds, setDrawOdds] = useState("");
  const [awayOdds, setAwayOdds] = useState("");
  const [bankroll, setBankroll] = useState<BankrollState | null>(() => loadBankroll());

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <TeamHead name={p.home} elo={p.eloHome} side="home" />
        <div className="text-center">
          <span className="font-mono-n text-xs text-[var(--mp-muted)] bg-[var(--mp-bg)] rounded-lg px-3 py-1">vs</span>
          {p.neutral && <div className="text-[10px] text-[var(--mp-muted)] mt-1">neutro</div>}
        </div>
        <TeamHead name={p.away} elo={p.eloAway} side="away" />
      </div>

      {/* Form badges */}
      {(p.formHome || p.formAway) && (
        <div className="space-y-1.5 p-3 rounded-xl bg-[var(--mp-bg)] border border-[var(--mp-border-soft)]">
          <div className="text-[10px] uppercase tracking-wider text-[var(--mp-muted)] font-semibold mb-2">Forma últimos 5 jogos</div>
          <FormBadge form={p.formHome} label="Casa" />
          <FormBadge form={p.formAway} label="Fora" />
        </div>
      )}

      {/* XGBoost Ensemble */}
      {ensemble && ensemble.source === "xgboost-ensemble" && (
        <EnsembleBadge
          ensemble={ensemble.ensemble}
          calibrated={ensemble.calibrated}
          xgb={ensemble.xgboost}
          confidence={ensemble.confidence}
          shap={ensemble.shap}
        />
      )}
      {ensemble?.warning && (
        <div className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          ⚠ {ensemble.warning}
        </div>
      )}

      {/* Real Injury Data */}
      <InjuryPanel homeTeam={p.home} awayTeam={p.away} />

      {/* Tab switcher */}
      <div className="flex gap-2">
        {(["1x2", "ou", "hc"] as const).map((t) => (
          <button key={t} onClick={() => setResultTab(t)}
            className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all ${
              resultTab === t
                ? "bg-[var(--mp-cyan)] text-white border-[var(--mp-cyan)]"
                : "border-[var(--mp-border)] text-[var(--mp-muted)] hover:border-[var(--mp-cyan)]"
            }`}>
            {t === "1x2" ? "1X2 + BTTS" : t === "ou" ? "Over/Under" : "Handicap"}
          </button>
        ))}
      </div>

      {resultTab === "1x2" && (
        <div className="space-y-4">
          {/* 1X2 bar */}
          <div>
            <div className="flex h-10 rounded-xl overflow-hidden text-[11px] font-mono-n font-bold shadow-inner">
              <div className="flex items-center justify-center bg-green-500 text-white" style={{ width: `${p.probHome * 100}%` }}>
                {(p.probHome * 100).toFixed(0)}%
              </div>
              <div className="flex items-center justify-center bg-slate-400 text-white" style={{ width: `${p.probDraw * 100}%` }}>
                {(p.probDraw * 100).toFixed(0)}%
              </div>
              <div className="flex items-center justify-center bg-red-400 text-white" style={{ width: `${p.probAway * 100}%` }}>
                {(p.probAway * 100).toFixed(0)}%
              </div>
            </div>
            <div className="flex justify-between text-[10px] text-[var(--mp-muted)] mt-1.5 uppercase tracking-wider font-semibold">
              <span>Vitória casa</span>
              <span>Empate</span>
              <span>Vitória fora</span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="xG esperado casa" value={p.expHomeGoals.toFixed(2)} />
            <Stat label="xG esperado fora" value={p.expAwayGoals.toFixed(2)} />
            <Stat label="Over 2.5" value={`${(p.over25 * 100).toFixed(0)}%`} accent={p.over25 > 0.5} />
            <Stat label="BTTS" value={`${(p.bttsYes * 100).toFixed(0)}%`} accent={p.bttsYes > 0.5} />
          </div>

          {/* Importância do jogo */}
          {(p.importanceHome || p.importanceAway) && (
            <div className="grid grid-cols-2 gap-2">
              {p.importanceHome && p.importanceHome.level !== "normal" && (
                <div className={`text-xs rounded-lg px-3 py-2 border ${
                  p.importanceHome.level === "title" ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400" :
                  p.importanceHome.level === "relegation" ? "bg-rose-500/10 border-rose-500/30 text-rose-400" :
                  p.importanceHome.level === "ucl" ? "bg-blue-500/10 border-blue-500/30 text-blue-400" :
                  p.importanceHome.level === "dead_rubber" ? "bg-[var(--mp-surface)] border-[var(--mp-border)] text-[var(--mp-muted)]" :
                  "bg-[var(--mp-surface)] border-[var(--mp-border)] text-[var(--mp-muted)]"
                }`}>
                  <div className="font-semibold">{p.home}: {p.importanceHome.label}</div>
                  {p.importanceHome.description && <div className="opacity-80 mt-0.5">{p.importanceHome.description}</div>}
                </div>
              )}
              {p.importanceAway && p.importanceAway.level !== "normal" && (
                <div className={`text-xs rounded-lg px-3 py-2 border ${
                  p.importanceAway.level === "title" ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400" :
                  p.importanceAway.level === "relegation" ? "bg-rose-500/10 border-rose-500/30 text-rose-400" :
                  p.importanceAway.level === "ucl" ? "bg-blue-500/10 border-blue-500/30 text-blue-400" :
                  "bg-[var(--mp-surface)] border-[var(--mp-border)] text-[var(--mp-muted)]"
                }`}>
                  <div className="font-semibold">{p.away}: {p.importanceAway.label}</div>
                  {p.importanceAway.description && <div className="opacity-80 mt-0.5">{p.importanceAway.description}</div>}
                </div>
              )}
            </div>
          )}

          {/* Fadiga */}
          {p.fatigue && (p.fatigue.homeFatigued || p.fatigue.awayFatigued) && (
            <div className="flex flex-wrap gap-2">
              {p.fatigue.homeFatigued && (
                <div className="text-xs bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-lg px-3 py-1.5">
                  ⚡ {p.home} — fadiga ({p.fatigue.homeRestDays}d descanso)
                </div>
              )}
              {p.fatigue.awayFatigued && (
                <div className="text-xs bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-lg px-3 py-1.5">
                  ⚡ {p.away} — fadiga ({p.fatigue.awayRestDays}d descanso)
                </div>
              )}
            </div>
          )}

          {/* H2H */}
          {p.h2h && p.h2h.total > 0 && (
            <div className="rounded-lg bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] p-3">
              <div className="text-[10px] uppercase tracking-wider text-[var(--mp-muted)] mb-2 font-semibold">H2H — {p.h2h.total} confrontos · dominância ponderada por recência</div>
              <div className="flex items-center gap-3 mb-2">
                <div className="text-center flex-1">
                  <div className="font-mono-n font-bold text-lg">{p.h2h.homeWins}</div>
                  <div className="text-[10px] text-[var(--mp-muted)] truncate max-w-[80px]">{p.home}</div>
                </div>
                <div className="text-center">
                  <div className="font-mono-n font-bold text-lg text-[var(--mp-muted)]">{p.h2h.draws}</div>
                  <div className="text-[10px] text-[var(--mp-muted)]">Emp</div>
                </div>
                <div className="text-center flex-1">
                  <div className="font-mono-n font-bold text-lg">{p.h2h.awayWins}</div>
                  <div className="text-[10px] text-[var(--mp-muted)] truncate max-w-[80px]">{p.away}</div>
                </div>
              </div>
              <div className="text-[10px] text-[var(--mp-muted)]">
                Média golos: {p.h2h.avgGoalsHome}–{p.h2h.avgGoalsAway} ·{" "}
                {p.h2h.dominance !== "balanced" ? (
                  <span className="text-[var(--mp-accent)]">
                    {p.h2h.dominance === "home" ? p.home : p.away} domina (score: {p.h2h.dominanceScore > 0 ? "+" : ""}{(p.h2h.dominanceScore).toFixed(2)})
                  </span>
                ) : `equilibrado (score: ${p.h2h.dominanceScore?.toFixed(2) ?? "0.00"})`}
              </div>
              {p.h2h.last5?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className="text-[9px] text-[var(--mp-muted)] uppercase tracking-wider mr-1">Últimos:</span>
                  {p.h2h.last5.map((m: any, i: number) => (
                    <span key={i} className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                      m.result === "H" ? "bg-emerald-500/20 text-emerald-400" :
                      m.result === "D" ? "bg-[var(--mp-surface)] text-[var(--mp-muted)]" :
                      "bg-rose-500/20 text-rose-400"
                    }`}>
                      {m.hg}–{m.ag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--mp-muted)] mb-2 font-semibold">Placares mais prováveis</div>
            <div className="flex flex-wrap gap-2">
              {p.topScores?.map((s: any) => (
                <div key={s.score} className="flex items-center gap-2 rounded-lg bg-[var(--mp-bg)] border border-[var(--mp-border-soft)] px-3 py-1.5">
                  <span className="font-mono-n font-bold text-[var(--mp-accent)]">{s.score}</span>
                  <span className="font-mono-n text-xs text-[var(--mp-muted)]">{(s.prob * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Odds + EV */}
          <div className="space-y-2 pt-2 border-t border-[var(--mp-border-soft)]">
            <div className="text-[10px] uppercase tracking-wide font-bold text-[var(--mp-muted)]">Odds da bookie (opcional)</div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <div className="text-[10px] text-[var(--mp-muted)] mb-1">Casa (1)</div>
                <input value={homeOdds} onChange={(e) => setHomeOdds(e.target.value)} placeholder="ex: 2.10" className="mp-input w-full text-sm" />
              </div>
              <div>
                <div className="text-[10px] text-[var(--mp-muted)] mb-1">Empate (X)</div>
                <input value={drawOdds} onChange={(e) => setDrawOdds(e.target.value)} placeholder="ex: 3.40" className="mp-input w-full text-sm" />
              </div>
              <div>
                <div className="text-[10px] text-[var(--mp-muted)] mb-1">Fora (2)</div>
                <input value={awayOdds} onChange={(e) => setAwayOdds(e.target.value)} placeholder="ex: 3.60" className="mp-input w-full text-sm" />
              </div>
            </div>
            <EVPanel p={p} homeOdds={homeOdds} drawOdds={drawOdds} awayOdds={awayOdds} ev={ev} />
            {/* Edge detector — uses ensemble probs if available, else DC probs */}
            <OddsEdgePanel
              ensemble={ensemble?.ensemble ?? { probHome: p.probHome, probDraw: p.probDraw, probAway: p.probAway }}
              home={homeOdds} draw={drawOdds} away={awayOdds}
            />
            {/* Kelly Criterion bankroll management */}
            <KellyPanel
              ensemble={ensemble?.ensemble ?? (ensemble?.calibrated) ?? { probHome: p.probHome, probDraw: p.probDraw, probAway: p.probAway }}
              homeOdds={homeOdds} drawOdds={drawOdds} awayOdds={awayOdds}
              bankroll={bankroll?.current ?? null}
              onSaveKelly={(entry) => {
                const id = `football_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
                saveTrackerRecord({
                  id,
                  kind: "football",
                  match: `${p.home} vs ${p.away}`,
                  createdAt: new Date().toISOString(),
                  league: p.league ?? "",
                  predictedOutcome: entry.label === "Casa (1)" ? "home" : entry.label === "Fora (2)" ? "away" : "draw",
                  modelProb: entry.modelProb,
                  odds: entry.odds,
                  edge: entry.edge,
                  kellyFraction: entry.kelly,
                  quarterKelly: entry.quarterKelly,
                });
              }}
            />
          </div>
        </div>
      )}

      {resultTab === "ou" && <OUTable ouLines={p.ouLines} />}
      {resultTab === "hc" && <HandicapPanel p={p} />}

      {/* Confidence + save row */}
      <div className="flex items-center justify-between pt-2 border-t border-[var(--mp-border)]">
        <div className="flex items-center gap-2">
          {p.confidence != null && <ConfidenceBadge conf={p.confidence} />}
          {p.isFriendly && (
            <span className="text-[9px] text-[var(--mp-amber)] bg-[color-mix(in_oklab,var(--mp-amber)_10%,transparent)] border border-[color-mix(in_oklab,var(--mp-amber)_25%,transparent)] px-1.5 py-0.5 rounded font-semibold uppercase">⚠ Amigável</span>
          )}
        </div>
        <SaveSportPickButton p={p} league={p.league ?? p.home + " vs " + p.away} kind="football"
          ensemble={ensemble?.ensemble}
          homeOdds={homeOdds} drawOdds={drawOdds} awayOdds={awayOdds} />
      </div>
    </div>
  );
}

function FootballSim() {
  const [league, setLeague] = useState("E0");
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  // Advanced opts
  const [homeAttackMult, setHomeAttackMult] = useState(1);
  const [homeDefMult, setHomeDefMult] = useState(1);
  const [awayAttackMult, setAwayAttackMult] = useState(1);
  const [awayDefMult, setAwayDefMult] = useState(1);
  const [motivationKey, setMotivationKey] = useState("normal");
  const [motivationFactor, setMotivationFactor] = useState(1);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const leagues = useQuery({
    queryKey: ["fb-leagues"],
    queryFn: async () => (await api.sports.football.leagues.$get()).json(),
  });
  const teams = useQuery({
    queryKey: ["fb-teams", league],
    queryFn: async () => (await api.sports.football.teams.$get({ query: { league } })).json(),
  });

  const teamList: string[] = (teams.data as any)?.teams ?? [];
  useEffect(() => {
    if (teamList.length >= 2) {
      setHome(teamList[0]);
      setAway(teamList[1]);
    }
  }, [teams.data]);

  const pred = useQuery({
    queryKey: ["fb-predict", league, home, away, homeAttackMult, homeDefMult, awayAttackMult, awayDefMult, motivationFactor],
    queryFn: async () => {
      const params: Record<string, string> = {
        league, home, away,
        homeAttackMult: String(homeAttackMult),
        homeDefMult: String(homeDefMult),
        awayAttackMult: String(awayAttackMult),
        awayDefMult: String(awayDefMult),
        motivationFactor: String(motivationFactor),
      };
      const qs = new URLSearchParams(params).toString();
      const res = await fetch(`/api/sports/football/predict?${qs}`);
      return res.json();
    },
    enabled: !!home && !!away && home !== away,
  });

  const p = (pred.data as any)?.prediction;
  const ev = (pred.data as any)?.prediction?.ev;
  const err = (pred.data as any)?.error;

  const bt = useQuery({
    queryKey: ["fb-backtest", league],
    queryFn: async () => (await api.sports.football.backtest.$get({ query: { league } })).json(),
  });
  const btData = (bt.data as any)?.backtest;

  // XGBoost ensemble — fetched after Dixon-Coles result arrives
  const [ensemble, setEnsemble] = useState<EnsembleResult | null>(null);
  const [ensembleLoading, setEnsembleLoading] = useState(false);
  useEffect(() => {
    if (!p) { setEnsemble(null); return; }
    let cancelled = false;
    setEnsembleLoading(true);
    // Use historyWithProbs from the prediction — these have real DC model probs
    // per match + outcome derived from actual scores (hg/ag). This is the real
    // training dataset for XGBoost. Fall back to btData.matches if unavailable.
    const historyMatches = (p as any).historyWithProbs ?? (btData?.matches ?? []);
    fetchEnsemble(p, historyMatches).then((res) => {
      if (!cancelled) { setEnsemble(res); setEnsembleLoading(false); }
    });
    return () => { cancelled = true; };
  }, [p?.home, p?.away, league]);

  const hasAdjustments = homeAttackMult !== 1 || homeDefMult !== 1 || awayAttackMult !== 1 || awayDefMult !== 1 || motivationFactor !== 1;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Controls */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mp-card p-5 space-y-4"
      >
        <div className="flex items-center gap-2">
          <Trophy size={16} className="text-[var(--mp-cyan)]" />
          <h2 className="font-display font-semibold text-[var(--mp-text)]">Configurar jogo</h2>
        </div>
        <Field label="Liga">
          <select value={league} onChange={(e) => setLeague(e.target.value)} className="mp-select">
            {((leagues.data as any)?.leagues ?? []).map((l: any) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
        </Field>

        {teams.isLoading ? (
          <div className="flex items-center gap-2 text-[var(--mp-muted)] text-sm">
            <Loader2 className="animate-spin" size={14} /> a carregar times…
          </div>
        ) : (
          <>
            <Field label="Casa">
              <select value={home} onChange={(e) => setHome(e.target.value)} className="mp-select">
                {teamList.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Fora">
              <select value={away} onChange={(e) => setAway(e.target.value)} className="mp-select">
                {teamList.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
          </>
        )}

        {/* Advanced toggle */}
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className={`flex items-center gap-2 text-xs font-semibold w-full rounded-lg px-3 py-2 border transition-all ${
            showAdvanced || hasAdjustments
              ? "border-[var(--mp-cyan)] text-[var(--mp-cyan)] bg-[var(--mp-cyan-light)]"
              : "border-[var(--mp-border)] text-[var(--mp-muted)] hover:border-[var(--mp-cyan)]"
          }`}
        >
          <SlidersHorizontal size={13} />
          Lesões / Contexto
          {hasAdjustments && <span className="ml-auto bg-[var(--mp-cyan)] text-white rounded-full w-2 h-2" />}
          <ChevronDown size={13} className={`ml-auto transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
        </button>

        {showAdvanced && (
          <div className="space-y-3 pt-1">
            <InjuryRow
              label={`Casa${home ? ` — ${home}` : ""}`}
              attackMult={homeAttackMult} defenseMult={homeDefMult}
              onAttack={setHomeAttackMult} onDefense={setHomeDefMult}
            />
            <InjuryRow
              label={`Fora${away ? ` — ${away}` : ""}`}
              attackMult={awayAttackMult} defenseMult={awayDefMult}
              onAttack={setAwayAttackMult} onDefense={setAwayDefMult}
            />
            <MotivationSelect
              value={motivationKey}
              onChange={(key, factor) => { setMotivationKey(key); setMotivationFactor(factor); }}
            />
            {hasAdjustments && (
              <button
                onClick={() => { setHomeAttackMult(1); setHomeDefMult(1); setAwayAttackMult(1); setAwayDefMult(1); setMotivationKey("normal"); setMotivationFactor(1); }}
                className="text-[11px] text-[var(--mp-muted)] hover:text-[var(--mp-text)] underline"
              >
                Repor tudo para padrão
              </button>
            )}
          </div>
        )}

        <div className="text-[11px] text-[var(--mp-muted)] pt-2 border-t border-[var(--mp-border-soft)] space-y-1">
          <div>Amostra: {(teams.data as any)?.sample ?? 0} jogos · 4 temporadas (ponderado por recência)</div>
          {p && (
            <div className="font-mono-n">
              Casa ×{p.homeAdv} · ρ {p.rho}{p.halfLife ? ` · meia-vida ${p.halfLife}d` : ""}
            </div>
          )}
        </div>
        <BacktestPanel bt={btData} loading={bt.isLoading} />
      </motion.div>

      {/* Result */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.08 }}
        className="mp-card p-5 lg:col-span-2"
      >
        {pred.isLoading ? (
          <div className="h-[300px] flex items-center justify-center text-[var(--mp-muted)]">
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : err ? (
          <div className="h-[300px] flex items-center justify-center text-[var(--mp-bear)] text-sm px-6 text-center">{err}</div>
        ) : p ? (
          <PredictionResult p={p} ev={ev} ensemble={ensemble} />
        ) : (
          <div className="h-[300px] flex items-center justify-center text-[var(--mp-muted)] text-sm">
            Escolha dois times para prever.
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ---- European Competitions + International Fixtures ----

const EURO_TABS = [
  { key: "wcup",      label: "Copa do Mundo",    icon: "🏆" },
  { key: "ucl",       label: "Champions League", icon: "⭐" },
  { key: "uel",       label: "Liga Europa",       icon: "🟠" },
  { key: "uecl",      label: "Conferência",       icon: "🟣" },
  { key: "nations",   label: "Nations League",    icon: "🌍" },
  { key: "friendlies",label: "Amigáveis",         icon: "🤝" },
];

// These competition keys have national teams → use international model
const NATIONAL_TEAM_KEYS = new Set(["wcup", "friendlies", "nations"]);

function EuroFixtures() {
  const [key, setKey] = useState<string | "sim">("ucl");

  const todayKey = new Date().toISOString().slice(0, 10);
  const fixtures = useQuery({
    queryKey: ["euro-fixtures", key, todayKey],
    queryFn: async () => {
      const res = await fetch(`/api/sports/euro/fixtures?key=${key}&days=30`);
      return res.json();
    },
    enabled: key !== "sim",
    staleTime: 5 * 60 * 1000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
  });

  const data = fixtures.data as any;
  const games: any[] = data?.games ?? [];
  const offseason = !!data?.offseason;
  const competitionName = data?.competition ?? EURO_TABS.find((t) => t.key === key)?.label ?? key;

  const byDate = new Map<string, any[]>();
  for (const g of games) {
    if (!byDate.has(g.date)) byDate.set(g.date, []);
    byDate.get(g.date)!.push(g);
  }
  const dates = [...byDate.keys()].sort();

  if (key === "sim") {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {EURO_TABS.map((t) => (
            <button key={t.key} onClick={() => setKey(t.key)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border text-[var(--mp-muted)] border-[var(--mp-border)] hover:border-[var(--mp-cyan)] hover:text-[var(--mp-cyan)] transition-all">
              <span>{t.icon}</span> {t.label}
            </button>
          ))}
          <button onClick={() => setKey("sim")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border bg-[var(--mp-cyan)] text-white border-[var(--mp-cyan)]">
            <SlidersHorizontal size={12} /> Simular Clubes
          </button>
        </div>
        <EuroSim />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Competition selector */}
      <div className="mp-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Star size={16} className="text-[var(--mp-cyan)]" />
          <h2 className="font-display font-semibold text-[var(--mp-text)]">Competições Internacionais</h2>
          <button
            onClick={() => fixtures.refetch()}
            className="ml-auto flex items-center gap-1.5 text-[11px] text-[var(--mp-muted)] hover:text-[var(--mp-cyan)] transition-colors"
          >
            <RefreshCw size={12} className={fixtures.isFetching ? "animate-spin" : ""} />
            {fixtures.isFetching ? "a atualizar…" : "auto 2min"}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {EURO_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setKey(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                key === t.key
                  ? "bg-[var(--mp-cyan)] text-white border-[var(--mp-cyan)]"
                  : "text-[var(--mp-muted)] border-[var(--mp-border)] hover:border-[var(--mp-cyan)] hover:text-[var(--mp-cyan)]"
              }`}
            >
              <span>{t.icon}</span> {t.label}
            </button>
          ))}
          <button
            onClick={() => setKey("sim")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all text-[var(--mp-accent)] border-[var(--mp-accent)] hover:bg-[var(--mp-accent)] hover:text-white"
          >
            <SlidersHorizontal size={12} /> Simular Clubes
          </button>
        </div>
      </div>

      {/* World Cup promo banner */}
      {key === "wcup" && !offseason && games.length > 0 && (
        <div className="mp-card p-4 flex items-start gap-3" style={{ background: "linear-gradient(135deg, #fef3c7 0%, #e0f2fe 100%)", borderColor: "var(--mp-amber)" }}>
          <span className="text-2xl">🏆</span>
          <div>
            <div className="font-display font-bold text-[var(--mp-text)] text-sm">Copa do Mundo 2026</div>
            <div className="text-[11px] text-[var(--mp-muted)] mt-0.5">EUA · Canadá · México — via ESPN · dados em tempo real</div>
          </div>
        </div>
      )}

      {/* Friendlies notice */}
      {key === "friendlies" && (
        <div className="mp-card p-3 flex items-start gap-2" style={{ borderLeftColor: "var(--mp-amber)", borderLeftWidth: 3 }}>
          <Users size={14} className="text-[var(--mp-amber)] shrink-0 mt-0.5" />
          <p className="text-[11px] text-[var(--mp-muted)] leading-relaxed">
            Amigáveis têm rotação elevada e resultados menos previsíveis.
          </p>
        </div>
      )}

      {/* Off-season notice */}
      {offseason && (
        <div className="mp-card p-3 flex items-start gap-2" style={{ borderLeftColor: "var(--mp-amber)", borderLeftWidth: 3 }}>
          <AlertTriangle size={14} className="text-[var(--mp-amber)] shrink-0 mt-0.5" />
          <p className="text-[11px] text-[var(--mp-muted)] leading-relaxed">
            <span className="font-semibold text-[var(--mp-text)]">{competitionName}</span> — época ainda não começou ou sem jogos agendados. A mostrar os últimos resultados.
          </p>
        </div>
      )}

      {fixtures.isLoading ? (
        <div className="mp-card p-10 flex items-center justify-center text-[var(--mp-muted)] text-sm">
          <Loader2 className="animate-spin mr-2" size={16} /> a carregar jogos…
        </div>
      ) : games.length === 0 ? (
        <div className="mp-card p-10 text-center text-[var(--mp-muted)] text-sm space-y-2">
          <div className="text-2xl">📅</div>
          <div>Nenhum jogo encontrado para <strong>{competitionName}</strong>.</div>
          <div className="text-xs">A nova época começa em agosto/setembro.</div>
        </div>
      ) : (
        <div className="space-y-5">
          {dates.map((d) => (
            <div key={d} className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[var(--mp-muted)] px-1 font-semibold">
                <Clock size={12} /> {formatDatePt(d)}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {byDate.get(d)!.map((g, i) => (
                  <EuroFixtureCard key={d + i} g={g} competitionName={competitionName} isNational={NATIONAL_TEAM_KEYS.has(key)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EuroFixtureCard({ g, competitionName, isNational = false }: { g: any; competitionName: string; isNational?: boolean }) {
  const [showPred, setShowPred] = useState(false);

  // National teams → international model; clubs → cross-league model
  const predEndpoint = isNational
    ? `/api/sports/international/predict?home=${encodeURIComponent(g.home)}&away=${encodeURIComponent(g.away)}&neutral=false`
    : `/api/sports/euro/predict?home=${encodeURIComponent(g.home)}&away=${encodeURIComponent(g.away)}`;

  const pred = useQuery({
    queryKey: [isNational ? "intl-predict" : "euro-predict", g.home, g.away],
    queryFn: async () => {
      const res = await fetch(predEndpoint);
      return res.json();
    },
    enabled: !g.played, // always fetch for upcoming matches
    staleTime: 5 * 60 * 1000,
  });

  const p = (pred.data as any)?.prediction;
  const err = (pred.data as any)?.error;
  const fav = p ? (
    p.probHome >= p.probDraw && p.probHome >= p.probAway ? "home"
    : p.probAway >= p.probDraw && p.probAway >= p.probHome ? "away"
    : "draw"
  ) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="mp-card p-4 space-y-3 hover:shadow-md transition-shadow"
    >
      {/* Header: round + time */}
      <div className="flex items-center justify-between text-[10px] text-[var(--mp-muted)]">
        <span className="font-semibold uppercase tracking-wide">{g.round ?? competitionName}</span>
        {g.time && <span className="font-mono-n">{g.time} UTC</span>}
      </div>

      {/* Teams row */}
      <div className="flex items-center justify-between gap-3">
        <div className={`flex items-center gap-2 flex-1 min-w-0 ${fav === "home" ? "opacity-100" : "opacity-75"}`}>
          {g.homeLogo && (
            <img src={g.homeLogo} alt="" className="w-7 h-7 object-contain shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          )}
          <div className="min-w-0">
            <div className="text-sm font-bold truncate text-[var(--mp-text)]">{g.home}</div>
            {p && <div className="text-[10px] text-[var(--mp-muted)]">xG {p.expHomeGoals?.toFixed(2)} · Elo {p.eloHome}</div>}
          </div>
        </div>

        {g.played && g.score ? (
          <span className="text-sm font-bold text-[var(--mp-text)] font-mono-n shrink-0 bg-[var(--mp-bg)] rounded-lg px-3 py-1.5 border border-[var(--mp-border)]">
            {g.score}
          </span>
        ) : (
          <span className="text-[10px] text-[var(--mp-muted)] font-mono-n shrink-0 bg-[var(--mp-bg)] rounded px-2 py-0.5 border border-[var(--mp-border)]">vs</span>
        )}

        <div className={`flex items-center gap-2 flex-1 min-w-0 justify-end ${fav === "away" ? "opacity-100" : "opacity-75"}`}>
          <div className="min-w-0 text-right">
            <div className="text-sm font-bold truncate text-[var(--mp-text)]">{g.away}</div>
            {p && <div className="text-[10px] text-[var(--mp-muted)]">xG {p.expAwayGoals?.toFixed(2)} · Elo {p.eloAway}</div>}
          </div>
          {g.awayLogo && (
            <img src={g.awayLogo} alt="" className="w-7 h-7 object-contain shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          )}
        </div>
      </div>

      {/* Prediction — always shown for upcoming matches */}
      {!g.played && (
        <div className="space-y-2 pt-1 border-t border-[var(--mp-border)]">
          {pred.isLoading && (
            <div className="flex items-center gap-2 text-[var(--mp-muted)] text-[11px] py-1">
              <Loader2 className="animate-spin shrink-0" size={12} /> a calcular Dixon-Coles…
            </div>
          )}
          {err && (
            <div className="text-[11px] text-amber-600 bg-amber-50 rounded-lg p-2 border border-amber-200">
              ⚠ {err}
            </div>
          )}
          {p && (
            <div className="space-y-2">
              {/* 1X2 bar */}
              <div>
                <div className="text-[10px] text-[var(--mp-muted)] mb-1 flex justify-between font-medium">
                  <span className={fav === "home" ? "font-bold text-[var(--mp-bull)]" : ""}>1 {(p.probHome * 100).toFixed(0)}%</span>
                  <span className={fav === "draw" ? "font-bold text-slate-600" : ""}>X {(p.probDraw * 100).toFixed(0)}%</span>
                  <span className={fav === "away" ? "font-bold text-[var(--mp-bear)]" : ""}>2 {(p.probAway * 100).toFixed(0)}%</span>
                </div>
                <div className="h-6 rounded-lg overflow-hidden flex text-[10px] font-bold text-white">
                  <div className={`flex items-center justify-center ${fav === "home" ? "bg-[var(--mp-bull)]" : "bg-green-400"}`}
                    style={{ width: `${p.probHome * 100}%` }}>
                    {p.probHome > 0.15 ? `${(p.probHome * 100).toFixed(0)}%` : ""}
                  </div>
                  <div className="flex items-center justify-center bg-slate-400"
                    style={{ width: `${p.probDraw * 100}%` }}>
                    {p.probDraw > 0.15 ? `${(p.probDraw * 100).toFixed(0)}%` : ""}
                  </div>
                  <div className={`flex items-center justify-center ${fav === "away" ? "bg-[var(--mp-bear)]" : "bg-red-400"}`}
                    style={{ width: `${p.probAway * 100}%` }}>
                    {p.probAway > 0.15 ? `${(p.probAway * 100).toFixed(0)}%` : ""}
                  </div>
                </div>
              </div>

              {/* Quick stats */}
              <div className="grid grid-cols-4 gap-1.5">
                <Stat label="Fav." value={fav === "home" ? g.home.split(" ").slice(-1)[0]! : fav === "away" ? g.away.split(" ").slice(-1)[0]! : "Empate"} accent />
                <Stat label="Over 2.5" value={`${(p.over25 * 100).toFixed(0)}%`} accent={p.over25 > 0.5} />
                <Stat label="BTTS" value={`${(p.bttsYes * 100).toFixed(0)}%`} accent={p.bttsYes > 0.5} />
                <Stat label="xG total" value={(p.expHomeGoals + p.expAwayGoals).toFixed(1)} />
              </div>

              {/* Toggle more details */}
              <button
                onClick={() => setShowPred((v) => !v)}
                className="w-full flex items-center justify-center gap-1 text-[10px] text-[var(--mp-cyan)] hover:text-[var(--mp-accent)] transition-colors py-0.5"
              >
                {showPred ? "▲ Menos detalhes" : "▼ Placares + xG detalhado"}
              </button>

              {showPred && (
                <div className="space-y-2 pt-1">
                  {/* xG individual */}
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label={`xG ${g.home.split(" ").slice(-1)[0]}`} value={p.expHomeGoals.toFixed(2)} />
                    <Stat label={`xG ${g.away.split(" ").slice(-1)[0]}`} value={p.expAwayGoals.toFixed(2)} />
                  </div>

                  {/* Top scores */}
                  {p.topScores?.length > 0 && (
                    <div>
                      <div className="text-[10px] text-[var(--mp-muted)] mb-1.5 font-semibold uppercase tracking-wide">Placares mais prováveis</div>
                      <div className="flex flex-wrap gap-1.5">
                        {p.topScores.slice(0, 6).map((s: any, i: number) => (
                          <span key={s.score}
                            className="px-2 py-0.5 rounded-md text-[11px] font-mono-n font-semibold border"
                            style={{
                              background: i === 0 ? "var(--mp-cyan-light)" : "var(--mp-bg)",
                              borderColor: i === 0 ? "var(--mp-cyan)" : "var(--mp-border)",
                              color: i === 0 ? "var(--mp-cyan)" : "var(--mp-muted)",
                            }}>
                            {s.score} <span className="opacity-70">({(s.prob * 100).toFixed(1)}%)</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* H2H inline for fixtures */}
                  {p.h2h && p.h2h.total > 0 && (
                    <div className="text-[10px] text-[var(--mp-muted)] flex items-center gap-3 bg-[var(--mp-bg)] rounded-lg px-3 py-1.5 border border-[var(--mp-border-soft)]">
                      <span className="font-semibold">H2H:</span>
                      <span className="text-emerald-400 font-bold">{p.h2h.homeWins}</span>
                      <span className="text-[var(--mp-muted)]">–</span>
                      <span className="font-bold">{p.h2h.draws}</span>
                      <span className="text-[var(--mp-muted)]">–</span>
                      <span className="text-rose-400 font-bold">{p.h2h.awayWins}</span>
                      {p.h2h.dominance !== "balanced" && (
                        <span className="text-[var(--mp-accent)]">· {p.h2h.dominance === "home" ? g.home.split(" ").slice(-1)[0] : g.away.split(" ").slice(-1)[0]} domina</span>
                      )}
                    </div>
                  )}

                  <div className="text-[9px] text-[var(--mp-muted)] pt-0.5">
                    {isNational
                      ? `Seleções Dixon-Coles · ${p.sample?.toLocaleString()} jogos · ρ=${p.rho} · ${p.gamesHome ?? "?"} hist. ${g.home} · ${p.gamesAway ?? "?"} hist. ${g.away}`
                      : `Cross-liga · ${p.sample?.toLocaleString()} jogos · ${p.leagueHome ? `${g.home}: ${p.leagueHome}` : ""}${p.leagueHome && p.leagueAway ? " / " : ""}${p.leagueAway ? `${g.away}: ${p.leagueAway}` : ""}`
                    }
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Venue / scheduled footer */}
          <div className="flex items-center justify-between pt-0.5">
            <div className="text-[10px] text-[var(--mp-cyan)] font-semibold flex items-center gap-1">
              <CalendarDays size={10} /> Agendado
            </div>
            {g.venue && <div className="text-[10px] text-[var(--mp-muted)] truncate max-w-[140px]">{g.venue}</div>}
          </div>
        </div>
      )}

      {/* Footer for played */}
      {g.played && (
        <div className="text-[10px] text-[var(--mp-muted)] flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--mp-muted)] inline-block" /> Resultado final
        </div>
      )}
    </motion.div>
  );
}

// ---- Euro Manual Simulator (for any club pair) ----
function EuroSim() {
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const [homeAttackMult, setHomeAttackMult] = useState(1);
  const [homeDefMult, setHomeDefMult] = useState(1);
  const [awayAttackMult, setAwayAttackMult] = useState(1);
  const [awayDefMult, setAwayDefMult] = useState(1);
  const [motivationKey, setMotivationKey] = useState("normal");
  const [motivationFactor, setMotivationFactor] = useState(1);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitted, setSubmitted] = useState<{ home: string; away: string; params: Record<string, string> } | null>(null);

  const teams = useQuery({
    queryKey: ["euro-teams"],
    queryFn: async () => {
      const res = await fetch("/api/sports/euro/teams");
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  const bt = useQuery({
    queryKey: ["euro-backtest"],
    queryFn: async () => {
      const res = await fetch("/api/sports/euro/backtest");
      return res.json();
    },
    staleTime: 30 * 60 * 1000,
  });

  const pred = useQuery({
    queryKey: ["euro-predict-manual", submitted],
    queryFn: async () => {
      if (!submitted) return null;
      const qs = new URLSearchParams(submitted.params).toString();
      const res = await fetch(`/api/sports/euro/predict?${qs}`);
      return res.json();
    },
    enabled: !!submitted,
  });

  const allTeams: string[] = (teams.data as any)?.teams ?? [];
  const p = (pred.data as any)?.prediction;
  const ev = (pred.data as any)?.prediction?.ev;
  const err = (pred.data as any)?.error;
  const btData = (bt.data as any)?.backtest;
  const hasAdjustments = homeAttackMult !== 1 || homeDefMult !== 1 || awayAttackMult !== 1 || awayDefMult !== 1 || motivationFactor !== 1;

  function handleSubmit() {
    if (!home || !away) return;
    setSubmitted({
      home, away,
      params: {
        home, away,
        homeAttackMult: String(homeAttackMult),
        homeDefMult: String(homeDefMult),
        awayAttackMult: String(awayAttackMult),
        awayDefMult: String(awayDefMult),
        motivationFactor: String(motivationFactor),
      }
    });
  }

  return (
    <div className="space-y-4">
      {btData && <BacktestPanel bt={btData} loading={false} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="mp-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={15} className="text-[var(--mp-cyan)]" />
            <h3 className="font-display font-semibold text-[var(--mp-text)]">Simular jogo europeu</h3>
          </div>
          <p className="text-[11px] text-[var(--mp-muted)]">
            {allTeams.length > 0 ? allTeams.length : "~"} clubes no modelo multi-liga.
          </p>

          <div className="space-y-3">
            <div>
              <label className="block text-[11px] text-[var(--mp-muted)] mb-1 font-semibold">Casa</label>
              <input list="euro-teams-home" value={home} onChange={(e) => setHome(e.target.value)} placeholder="ex: Arsenal" className="mp-input w-full" />
              <datalist id="euro-teams-home">{allTeams.map((t) => <option key={t} value={t} />)}</datalist>
            </div>
            <div>
              <label className="block text-[11px] text-[var(--mp-muted)] mb-1 font-semibold">Fora</label>
              <input list="euro-teams-away" value={away} onChange={(e) => setAway(e.target.value)} placeholder="ex: Bayern Munich" className="mp-input w-full" />
              <datalist id="euro-teams-away">{allTeams.map((t) => <option key={t} value={t} />)}</datalist>
            </div>
          </div>

          <button onClick={() => setShowAdvanced((v) => !v)}
            className={`flex items-center gap-2 text-xs font-semibold w-full rounded-lg px-3 py-2 border transition-all ${
              showAdvanced || hasAdjustments
                ? "border-[var(--mp-cyan)] text-[var(--mp-cyan)] bg-[var(--mp-cyan-light)]"
                : "border-[var(--mp-border)] text-[var(--mp-muted)] hover:border-[var(--mp-cyan)]"
            }`}>
            <SlidersHorizontal size={13} /> Lesões / Contexto
            {hasAdjustments && <span className="ml-1 bg-[var(--mp-cyan)] text-white rounded-full w-2 h-2" />}
            <ChevronDown size={13} className={`ml-auto transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
          </button>

          {showAdvanced && (
            <div className="space-y-3">
              <InjuryRow label={`Casa${home ? ` — ${home}` : ""}`} attackMult={homeAttackMult} defenseMult={homeDefMult} onAttack={setHomeAttackMult} onDefense={setHomeDefMult} />
              <InjuryRow label={`Fora${away ? ` — ${away}` : ""}`} attackMult={awayAttackMult} defenseMult={awayDefMult} onAttack={setAwayAttackMult} onDefense={setAwayDefMult} />
              <MotivationSelect value={motivationKey} onChange={(key, factor) => { setMotivationKey(key); setMotivationFactor(factor); }} />
              {hasAdjustments && (
                <button onClick={() => { setHomeAttackMult(1); setHomeDefMult(1); setAwayAttackMult(1); setAwayDefMult(1); setMotivationKey("normal"); setMotivationFactor(1); }}
                  className="text-[11px] text-[var(--mp-muted)] hover:text-[var(--mp-text)] underline">
                  Repor padrão
                </button>
              )}
            </div>
          )}

          <button onClick={handleSubmit} disabled={!home || !away || pred.isFetching} className="mp-btn w-full flex items-center justify-center gap-2">
            {pred.isFetching ? <><Loader2 className="animate-spin" size={14} /> a calcular…</> : <><TrendingUp size={14} /> Calcular previsão</>}
          </button>

          {err && <div className="text-[11px] text-amber-700 bg-amber-50 rounded-lg p-3 border border-amber-200">⚠ {err}</div>}
        </div>

        <div className="mp-card p-5 lg:col-span-2">
          {pred.isLoading ? (
            <div className="h-[300px] flex items-center justify-center text-[var(--mp-muted)]"><Loader2 className="animate-spin" size={20} /></div>
          ) : p ? (
            <div className="space-y-3">
              {p.leagueHome && <div className="text-[11px] text-[var(--mp-muted)]">{p.home}: {p.leagueHome} · {p.away}: {p.leagueAway}</div>}
              <PredictionResult p={p} ev={ev} />
              <div className="text-[9px] text-[var(--mp-muted)] pt-2 border-t border-[var(--mp-border)]">
                Dixon-Coles multi-liga · {p.sample?.toLocaleString()} jogos · ρ={p.rho}
              </div>
            </div>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-[var(--mp-muted)] text-sm">Escolha dois clubes e calcule.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- International (Seleções) ----

function Intl() {
  const [sub, setSub] = useState<"sim" | "fixtures">("fixtures");
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <SubPill active={sub === "fixtures"} onClick={() => setSub("fixtures")}>
          <CalendarDays size={13} /> Amigáveis
        </SubPill>
        <SubPill active={sub === "sim"} onClick={() => setSub("sim")}>
          <SlidersHorizontal size={13} /> Simular seleções
        </SubPill>
      </div>
      {sub === "fixtures" ? <IntlFixturesPanel /> : <IntlSim />}
    </div>
  );
}

function IntlFixturesPanel() {
  const todayKey2 = new Date().toISOString().slice(0, 10);
  const fixtures = useQuery({
    queryKey: ["euro-fixtures", "friendlies", todayKey2],
    queryFn: async () => {
      const res = await fetch(`/api/sports/euro/fixtures?key=friendlies&days=30`);
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
  });

  const data = fixtures.data as any;
  const games: any[] = data?.games ?? [];
  const offseason = !!data?.offseason;

  const byDate = new Map<string, any[]>();
  for (const g of games) {
    if (!byDate.has(g.date)) byDate.set(g.date, []);
    byDate.get(g.date)!.push(g);
  }
  const dates = [...byDate.keys()].sort();

  return (
    <div className="space-y-4">
      <div className="mp-card p-4 flex items-center gap-3">
        <Globe size={16} className="text-[var(--mp-cyan)]" />
        <h2 className="font-display font-semibold text-[var(--mp-text)]">Amigáveis de Seleções</h2>
        <button onClick={() => fixtures.refetch()} className="ml-auto text-[11px] text-[var(--mp-muted)] hover:text-[var(--mp-cyan)] flex items-center gap-1">
          <RefreshCw size={12} className={fixtures.isFetching ? "animate-spin" : ""} />
        </button>
      </div>

      {offseason && (
        <div className="mp-card p-3 flex items-start gap-2" style={{ borderLeftColor: "var(--mp-amber)", borderLeftWidth: 3 }}>
          <AlertTriangle size={14} className="text-[var(--mp-amber)] shrink-0 mt-0.5" />
          <p className="text-[11px] text-[var(--mp-muted)]">Sem amigáveis agendados. A mostrar os mais recentes.</p>
        </div>
      )}

      {fixtures.isLoading ? (
        <div className="mp-card p-10 flex items-center justify-center text-[var(--mp-muted)] text-sm">
          <Loader2 className="animate-spin mr-2" size={16} /> a carregar…
        </div>
      ) : games.length === 0 ? (
        <div className="mp-card p-10 text-center text-[var(--mp-muted)] text-sm">Nenhum amigável encontrado.</div>
      ) : (
        <div className="space-y-5">
          {dates.map((d) => (
            <div key={d} className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[var(--mp-muted)] px-1 font-semibold">
                <Clock size={12} /> {formatDatePt(d)}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {byDate.get(d)!.map((g, i) => (
                  <EuroFixtureCard key={d + i} g={g} competitionName="Amigável" isNational={true} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IntlSim() {
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const [neutral, setNeutral] = useState(true);
  const [homeAttackMult, setHomeAttackMult] = useState(1);
  const [homeDefMult, setHomeDefMult] = useState(1);
  const [awayAttackMult, setAwayAttackMult] = useState(1);
  const [awayDefMult, setAwayDefMult] = useState(1);
  const [motivationKey, setMotivationKey] = useState("normal");
  const [motivationFactor, setMotivationFactor] = useState(1);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const teams = useQuery({
    queryKey: ["intl-teams"],
    queryFn: async () => (await api.sports.international.teams.$get()).json(),
  });
  const teamList: string[] = (teams.data as any)?.teams ?? [];
  const sample = (teams.data as any)?.sample ?? 0;

  useEffect(() => {
    if (teamList.length && !home) {
      const pick = (n: string) => (teamList.includes(n) ? n : "");
      setHome(pick("Brazil") || teamList[0]);
      setAway(pick("Argentina") || teamList[1] || "");
    }
  }, [teams.data]);

  const pred = useQuery({
    queryKey: ["intl-predict", home, away, neutral, homeAttackMult, homeDefMult, awayAttackMult, awayDefMult, motivationFactor],
    queryFn: async () => {
      const params: Record<string, string> = {
        home, away, neutral: String(neutral),
        homeAttackMult: String(homeAttackMult),
        homeDefMult: String(homeDefMult),
        awayAttackMult: String(awayAttackMult),
        awayDefMult: String(awayDefMult),
        motivationFactor: String(motivationFactor),
      };
      const qs = new URLSearchParams(params).toString();
      const res = await fetch(`/api/sports/international/predict?${qs}`);
      return res.json();
    },
    enabled: !!home && !!away && home !== away,
  });
  const p = (pred.data as any)?.prediction;
  const ev = (pred.data as any)?.prediction?.ev;
  const err = (pred.data as any)?.error;
  const thinSample = p && (p.gamesHome < 8 || p.gamesAway < 8);
  const hasAdjustments = homeAttackMult !== 1 || homeDefMult !== 1 || awayAttackMult !== 1 || awayDefMult !== 1 || motivationFactor !== 1;

  const bt = useQuery({
    queryKey: ["intl-backtest"],
    queryFn: async () => (await api.sports.international.backtest.$get()).json(),
  });
  const btData = (bt.data as any)?.backtest;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="mp-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-[var(--mp-cyan)]" />
          <h2 className="font-display font-semibold text-[var(--mp-text)]">Seleções</h2>
        </div>

        <div className="text-[11px] text-[var(--mp-amber)] leading-relaxed rounded-xl bg-[var(--mp-amber-light)] p-2.5 border border-amber-200">
          Eliminatórias, Liga das Nações e amistosos desde 2021.
        </div>

        {teams.isLoading ? (
          <div className="flex items-center gap-2 text-[var(--mp-muted)] text-sm"><Loader2 className="animate-spin" size={14} /> a carregar…</div>
        ) : (
          <>
            <Field label="Seleção A (mando)">
              <input list="intl-teams" value={home} onChange={(e) => setHome(e.target.value)} className="mp-select" placeholder="digite para buscar…" />
            </Field>
            <Field label="Seleção B (visitante)">
              <input list="intl-teams" value={away} onChange={(e) => setAway(e.target.value)} className="mp-select" placeholder="digite para buscar…" />
            </Field>
            <datalist id="intl-teams">{teamList.map((t) => <option key={t} value={t} />)}</datalist>
            <label className="flex items-center gap-2.5 cursor-pointer pt-1">
              <input type="checkbox" checked={neutral} onChange={(e) => setNeutral(e.target.checked)} className="accent-[var(--mp-cyan)] w-4 h-4" />
              <span className="text-sm text-[var(--mp-text)]">Campo neutro <span className="text-[var(--mp-muted)] text-xs">(Copa do Mundo)</span></span>
            </label>
          </>
        )}

        <button onClick={() => setShowAdvanced((v) => !v)}
          className={`flex items-center gap-2 text-xs font-semibold w-full rounded-lg px-3 py-2 border transition-all ${
            showAdvanced || hasAdjustments
              ? "border-[var(--mp-cyan)] text-[var(--mp-cyan)] bg-[var(--mp-cyan-light)]"
              : "border-[var(--mp-border)] text-[var(--mp-muted)] hover:border-[var(--mp-cyan)]"
          }`}>
          <SlidersHorizontal size={13} /> Lesões / Contexto
          {hasAdjustments && <span className="ml-1 bg-[var(--mp-cyan)] text-white rounded-full w-2 h-2" />}
          <ChevronDown size={13} className={`ml-auto transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
        </button>

        {showAdvanced && (
          <div className="space-y-3">
            <InjuryRow label={`A${home ? ` — ${home}` : ""}`} attackMult={homeAttackMult} defenseMult={homeDefMult} onAttack={setHomeAttackMult} onDefense={setHomeDefMult} />
            <InjuryRow label={`B${away ? ` — ${away}` : ""}`} attackMult={awayAttackMult} defenseMult={awayDefMult} onAttack={setAwayAttackMult} onDefense={setAwayDefMult} />
            <MotivationSelect value={motivationKey} onChange={(key, factor) => { setMotivationKey(key); setMotivationFactor(factor); }} />
            {hasAdjustments && (
              <button onClick={() => { setHomeAttackMult(1); setHomeDefMult(1); setAwayAttackMult(1); setAwayDefMult(1); setMotivationKey("normal"); setMotivationFactor(1); }}
                className="text-[11px] text-[var(--mp-muted)] hover:text-[var(--mp-text)] underline">
                Repor padrão
              </button>
            )}
          </div>
        )}

        <div className="text-[11px] text-[var(--mp-muted)] pt-2 border-t border-[var(--mp-border-soft)]">
          {sample} jogos{p ? ` · ρ ${p.rho} · ${p.gamesHome}/${p.gamesAway} jogos cada` : ""}
        </div>
        <BacktestPanel bt={btData} loading={bt.isLoading} />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.08 }} className="mp-card p-5 lg:col-span-2">
        {pred.isLoading ? (
          <div className="h-[300px] flex items-center justify-center text-[var(--mp-muted)]"><Loader2 className="animate-spin" size={20} /></div>
        ) : err ? (
          <div className="h-[300px] flex items-center justify-center text-[var(--mp-bear)] text-sm px-6 text-center">{err}</div>
        ) : p ? (
          <div className="space-y-4">
            {thinSample && (
              <div className="text-[11px] text-[var(--mp-amber)] rounded-xl bg-[var(--mp-amber-light)] p-2.5 border border-amber-200">
                Amostra pequena: {p.home} {p.gamesHome} jogos, {p.away} {p.gamesAway} jogos. Confiança menor.
              </div>
            )}
            <PredictionResult p={p} ev={ev} />
          </div>
        ) : (
          <div className="h-[300px] flex items-center justify-center text-[var(--mp-muted)] text-sm">Escolha duas seleções para prever.</div>
        )}
      </motion.div>
    </div>
  );
}

// ---- NBA ----

function Nba() {
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const teams = useQuery({
    queryKey: ["nba-teams"],
    queryFn: async () => (await api.sports.nba.teams.$get()).json(),
  });
  const teamList: string[] = (teams.data as any)?.teams ?? [];
  const sample = (teams.data as any)?.sample ?? 0;
  useEffect(() => {
    if (teamList.length >= 2) {
      setHome(teamList[0]);
      setAway(teamList[1]);
    }
  }, [teams.data]);

  const pred = useQuery({
    queryKey: ["nba-predict", home, away],
    queryFn: async () => (await api.sports.nba.predict.$get({ query: { home, away } })).json(),
    enabled: !!home && !!away && home !== away,
  });
  const p = (pred.data as any)?.prediction;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="mp-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-[var(--mp-cyan)]" />
          <h2 className="font-display font-semibold text-[var(--mp-text)]">Configurar jogo</h2>
        </div>
        {sample < 50 && (
          <div className="text-[11px] text-[var(--mp-amber)] leading-relaxed rounded-xl bg-[var(--mp-amber-light)] p-2.5 border border-amber-200">
            Amostra baixa ({sample} jogos nos dados gratuitos). Elo da NBA é grosseiro — demo apenas.
          </div>
        )}
        <Field label="Casa">
          <select value={home} onChange={(e) => setHome(e.target.value)} className="mp-select">
            {teamList.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Fora">
          <select value={away} onChange={(e) => setAway(e.target.value)} className="mp-select">
            {teamList.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
      </div>
      <div className="mp-card p-5 lg:col-span-2">
        {teams.isLoading || pred.isLoading ? (
          <div className="h-[200px] flex items-center justify-center text-[var(--mp-muted)]">
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : p ? (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <TeamHead name={p.home} elo={p.eloHome} side="home" />
              <span className="font-mono-n text-xs text-[var(--mp-muted)] bg-[var(--mp-bg)] rounded-lg px-3 py-1">vs</span>
              <TeamHead name={p.away} elo={p.eloAway} side="away" />
            </div>
            <div className="flex h-10 rounded-xl overflow-hidden text-[11px] font-mono-n font-bold shadow-inner">
              <div className="flex items-center justify-center bg-green-500 text-white" style={{ width: `${p.probHome * 100}%` }}>
                {(p.probHome * 100).toFixed(0)}%
              </div>
              <div className="flex items-center justify-center bg-red-400 text-white" style={{ width: `${p.probAway * 100}%` }}>
                {(p.probAway * 100).toFixed(0)}%
              </div>
            </div>
            <div className="flex justify-between text-[10px] text-[var(--mp-muted)] uppercase tracking-wider font-semibold">
              <span>{p.home} vence</span>
              <span>{p.away} vence</span>
            </div>
          </div>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-[var(--mp-muted)] text-sm">Escolha dois times.</div>
        )}
      </div>
    </div>
  );
}

// ─── Save Sport Pick Button ──────────────────────────────────────────────────
function SaveSportPickButton({ p, league, kind, ensemble, homeOdds, drawOdds, awayOdds }: {
  p: any; league: string; kind: "football" | "international";
  ensemble?: { probHome: number; probDraw: number; probAway: number } | null;
  homeOdds?: string; drawOdds?: string; awayOdds?: string;
}) {
  const [saved, setSaved] = useState(false);
  const probs = ensemble ?? p;
  const fav = probs.probHome >= probs.probDraw && probs.probHome >= probs.probAway ? "home"
    : probs.probAway >= probs.probDraw && probs.probAway >= probs.probHome ? "away"
    : "draw";

  const hOdd = parseFloat(homeOdds ?? ""), dOdd = parseFloat(drawOdds ?? ""), aOdd = parseFloat(awayOdds ?? "");
  const favOdd = fav === "home" ? hOdd : fav === "away" ? aOdd : dOdd;
  const favProb = fav === "home" ? probs.probHome : fav === "away" ? probs.probAway : probs.probDraw;
  const impliedH = isNaN(hOdd)||hOdd<1.01 ? null : 1/hOdd, impliedD = isNaN(dOdd)||dOdd<1.01 ? null : 1/dOdd, impliedA = isNaN(aOdd)||aOdd<1.01 ? null : 1/aOdd;
  const overround = (impliedH??0) + (impliedD??0) + (impliedA??0);
  const trueProb = overround > 0 ? (fav === "home" ? (impliedH??0)/overround : fav === "away" ? (impliedA??0)/overround : (impliedD??0)/overround) : null;
  const edge = trueProb != null ? favProb - trueProb : null;
  const kelly = !isNaN(favOdd) && favOdd > 1 ? calcKelly(favProb, favOdd) : null;
  const qk = kelly != null ? kelly * 0.25 : null;

  const save = () => {
    const id = `${kind}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    saveTrackerRecord({
      id,
      kind,
      match: `${p.home} vs ${p.away}`,
      createdAt: new Date().toISOString(),
      league,
      predictedOutcome: fav,
      modelProb: favProb,
      odds: !isNaN(favOdd) && favOdd > 1 ? favOdd : undefined,
      edge: edge ?? undefined,
      kellyFraction: kelly ?? undefined,
      quarterKelly: qk ?? undefined,
    } as any);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };
  return (
    <button onClick={save} disabled={saved}
      className={`flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-lg border transition ${
        saved
          ? "border-[var(--mp-bull)] text-[var(--mp-bull)] bg-[color-mix(in_oklab,var(--mp-bull)_10%,transparent)]"
          : "border-[var(--mp-border)] text-[var(--mp-muted)] hover:border-[var(--mp-cyan)] hover:text-[var(--mp-cyan)]"
      }`}>
      {saved ? <BookmarkCheck size={11}/> : <Bookmark size={11}/>}
      {saved ? "Guardado!" : "Guardar Pick"}
    </button>
  );
}

// ─── Sports Tracker Panel ─────────────────────────────────────────────────────
export function SportsTrackerPanel() {
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<TrackerRecord[]>([]);
  const [resolving, setResolving] = useState<string | null>(null);
  const [stakeInput, setStakeInput] = useState<Record<string, string>>({});
  const [bankroll, setBankroll] = useState<BankrollState | null>(null);
  const [activeTab, setActiveTab] = useState<"pending" | "resolved" | "stats">("pending");

  useEffect(() => {
    setBankroll(loadBankroll());
  }, []);

  useEffect(() => {
    const all = loadTrackerRecords().filter((r) => r.kind === "football" || r.kind === "international");
    setRecords(all);
  }, [open]);

  const refresh = () => {
    const all = loadTrackerRecords().filter((r) => r.kind === "football" || r.kind === "international");
    setRecords(all);
    setBankroll(loadBankroll());
  };

  const resolve = (id: string, outcome: string) => {
    resolveTrackerRecord(id, outcome);
    setResolving(null);
    refresh();
  };

  const del = (id: string) => {
    deleteTrackerRecord(id);
    refresh();
  };

  const setStake = (id: string) => {
    const n = parseFloat(stakeInput[id]?.replace(",", ".") ?? "");
    if (!isNaN(n) && n > 0) {
      updateTrackerRecord(id, { stakeAmount: n });
      refresh();
    }
  };

  const pending = records.filter(r => r.resolvedAt == null);
  const resolved = records.filter(r => r.resolvedAt != null);
  const stats = calcTrackerStats(records);
  const pnl = bankroll ? bankroll.current - bankroll.initial : 0;

  const outcomeLabel = (o?: string) => o === "home" ? "Casa (1)" : o === "away" ? "Fora (2)" : "Empate (X)";

  return (
    <div className="mp-card p-5">
      <button className="w-full flex items-center justify-between" onClick={() => setOpen(v => !v)}>
        <div className="flex items-center gap-2">
          <BarChart2 size={16} className="text-[var(--mp-cyan)]" />
          <span className="font-display font-semibold">Tracker & ROI</span>
          {records.length > 0 && (
            <span className="text-[10px] font-mono-n bg-[var(--mp-cyan)]/15 text-[var(--mp-cyan)] px-2 py-0.5 rounded-full">{records.length}</span>
          )}
          {stats.totalPnl !== 0 && (
            <span className={`text-[10px] font-mono-n font-bold px-2 py-0.5 rounded-full ${stats.totalPnl > 0 ? "text-emerald-400 bg-emerald-500/10" : "text-rose-400 bg-rose-500/10"}`}>
              {stats.totalPnl > 0 ? "+" : ""}€{stats.totalPnl.toFixed(0)} P&L
            </span>
          )}
        </div>
        {open ? <ChevronUp size={14} className="text-[var(--mp-muted)]" /> : <ChevronDown size={14} className="text-[var(--mp-muted)]" />}
      </button>

      <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
          className="mt-4 space-y-3 overflow-hidden">

          {/* Bankroll row */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <BankrollWidget bankroll={bankroll} onChange={br => { setBankroll(br); }} />
            {bankroll && pnl !== 0 && (
              <span className={`text-[10px] font-mono-n ${pnl > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {pnl > 0 ? "+" : ""}€{pnl.toFixed(2)} vs início
              </span>
            )}
          </div>

          {/* Tabs */}
          <div className="flex gap-1">
            {(["pending", "resolved", "stats"] as const).map(t => (
              <button key={t} onClick={() => setActiveTab(t)}
                className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition ${activeTab === t ? "bg-[var(--mp-cyan)]/15 text-[var(--mp-cyan)] border border-[var(--mp-cyan)]/30" : "text-[var(--mp-muted)] border border-transparent hover:border-[var(--mp-border)]"}`}>
                {t === "pending" ? `Pendente (${pending.length})` : t === "resolved" ? `Resolvidos (${resolved.length})` : "Estatísticas"}
              </button>
            ))}
          </div>

          {records.length === 0 && (
            <p className="text-[var(--mp-muted)] text-sm text-center py-6">Nenhum pick guardado. Usa "Guardar Pick" ou "+ Guardar aposta" nos simuladores.</p>
          )}

          {/* PENDING */}
          {activeTab === "pending" && pending.length > 0 && (
            <div className="space-y-2">
              {pending.map((r) => (
                <div key={r.id} className={`rounded-xl border p-3 space-y-2 ${(r.edge ?? 0) >= 0.05 ? "border-amber-500/30 bg-amber-500/5" : "border-[var(--mp-border)] bg-[var(--mp-bg)]"}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm truncate">{(r as any).label ?? r.match}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-[var(--mp-muted)]">{new Date(r.createdAt).toLocaleDateString("pt-BR")}</span>
                      <button onClick={() => del(r.id)} className="text-[var(--mp-muted)] hover:text-rose-400"><X size={10}/></button>
                    </div>
                  </div>
                  <div className="flex items-center flex-wrap gap-2 text-[11px]">
                    <span className="font-semibold text-[var(--mp-text)]">{outcomeLabel(r.predictedOutcome)}</span>
                    {r.odds && <span className="font-mono-n text-[var(--mp-muted)]">@{r.odds.toFixed(2)}</span>}
                    {r.edge != null && <span className={`font-mono-n font-bold ${r.edge > 0 ? "text-emerald-400" : "text-rose-400"}`}>Edge {r.edge > 0 ? "+" : ""}{(r.edge * 100).toFixed(1)}pp</span>}
                    {(r.edge ?? 0) >= 0.05 && <span className="text-[9px] font-bold bg-amber-500 text-black rounded-full px-1.5">VALUE</span>}
                    {r.quarterKelly != null && <span className="text-[var(--mp-muted)]">Kelly: {(r.quarterKelly*100).toFixed(1)}%</span>}
                  </div>
                  {/* Stake input */}
                  {r.stakeAmount == null ? (
                    <div className="flex items-center gap-2">
                      <input value={stakeInput[r.id] ?? ""} onChange={e => setStakeInput(p => ({ ...p, [r.id]: e.target.value }))}
                        placeholder={bankroll && r.quarterKelly ? `€${(r.quarterKelly * bankroll.current).toFixed(0)} sugerido` : "€ apostado"}
                        className="mp-input text-xs w-36" />
                      <button onClick={() => setStake(r.id)} className="text-[10px] px-2 py-1 rounded border border-[var(--mp-border)] text-[var(--mp-muted)] hover:text-[var(--mp-cyan)]">Registar</button>
                    </div>
                  ) : (
                    <div className="text-[11px] text-[var(--mp-muted)]">Aposta: <b className="text-[var(--mp-text)]">€{r.stakeAmount.toFixed(2)}</b></div>
                  )}
                  {/* Resolve buttons */}
                  {resolving === r.id ? (
                    <div className="flex gap-1.5">
                      <button onClick={() => resolve(r.id, "home")} className="flex-1 py-1 rounded text-[10px] bg-[color-mix(in_oklab,var(--mp-bull)_15%,transparent)] text-[var(--mp-bull)] border border-[color-mix(in_oklab,var(--mp-bull)_40%,transparent)]">Casa (1)</button>
                      <button onClick={() => resolve(r.id, "draw")} className="flex-1 py-1 rounded text-[10px] bg-[color-mix(in_oklab,var(--mp-muted)_15%,transparent)] text-[var(--mp-muted)] border border-[var(--mp-border)]">Empate (X)</button>
                      <button onClick={() => resolve(r.id, "away")} className="flex-1 py-1 rounded text-[10px] bg-[color-mix(in_oklab,var(--mp-bear)_15%,transparent)] text-[var(--mp-bear)] border border-[color-mix(in_oklab,var(--mp-bear)_40%,transparent)]">Fora (2)</button>
                      <button onClick={() => setResolving(null)} className="px-1.5 py-1 rounded text-[10px] border border-[var(--mp-border)] text-[var(--mp-muted)]"><X size={10}/></button>
                    </div>
                  ) : (
                    <button onClick={() => setResolving(r.id)} className="text-[10px] underline text-[var(--mp-cyan)]">Inserir resultado</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* RESOLVED */}
          {activeTab === "resolved" && resolved.length > 0 && (
            <div className="space-y-2">
              {resolved.slice().reverse().map((r) => (
                <div key={r.id} className={`rounded-xl border p-3 flex items-center justify-between gap-2 ${r.correct ? "border-emerald-500/25 bg-emerald-500/5" : "border-rose-500/20 bg-rose-500/5"}`}>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="font-bold text-sm truncate">{(r as any).label ?? r.match}</div>
                    <div className="text-[10px] text-[var(--mp-muted)] flex flex-wrap gap-2">
                      <span>{outcomeLabel(r.predictedOutcome)} → {outcomeLabel(r.actualOutcome)}</span>
                      {r.stakeAmount != null && r.pnl != null && (
                        <span className={`font-mono-n font-bold ${r.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {r.pnl >= 0 ? "+" : ""}€{r.pnl.toFixed(2)}
                        </span>
                      )}
                      {r.odds && <span className="font-mono-n">@{r.odds.toFixed(2)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {r.correct ? <CheckCircle2 size={16} className="text-emerald-400" /> : <XCircle size={16} className="text-rose-400" />}
                    <button onClick={() => del(r.id)} className="text-[var(--mp-muted)] hover:text-rose-400"><X size={10}/></button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* STATS */}
          {activeTab === "stats" && (
            <div className="space-y-3">
              {records.length === 0 ? (
                <p className="text-[var(--mp-muted)] text-sm text-center py-4">Sem dados para estatísticas.</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: "Total picks", value: stats.total },
                      { label: "Resolvidos", value: stats.resolved },
                      { label: "Precisão", value: stats.resolved > 0 ? `${(stats.accuracy * 100).toFixed(1)}%` : "—" },
                      { label: "Acertos", value: `${stats.correct}/${stats.resolved}` },
                      { label: "Total apostado", value: stats.totalStaked > 0 ? `€${stats.totalStaked.toFixed(0)}` : "—" },
                      { label: "P&L total", value: stats.totalStaked > 0 ? `${stats.totalPnl >= 0 ? "+" : ""}€${stats.totalPnl.toFixed(2)}` : "—", color: stats.totalPnl > 0 ? "text-emerald-400" : stats.totalPnl < 0 ? "text-rose-400" : undefined },
                      { label: "ROI", value: stats.totalStaked > 0 ? `${stats.roi >= 0 ? "+" : ""}${(stats.roi * 100).toFixed(1)}%` : "—", color: stats.roi > 0 ? "text-emerald-400" : stats.roi < 0 ? "text-rose-400" : undefined },
                      { label: "Value bets (≥5pp)", value: `${stats.valueBetCount} (${stats.valueBetCount > 0 ? `${stats.valueBetCorrect}/${stats.valueBetCount} certos` : "—"})` },
                      { label: "Melhor ganho", value: stats.bestWin > 0 ? `+€${stats.bestWin.toFixed(2)}` : "—", color: "text-emerald-400" },
                      { label: "Pior perda", value: stats.worstLoss < 0 ? `€${stats.worstLoss.toFixed(2)}` : "—", color: "text-rose-400" },
                    ].map(s => (
                      <div key={s.label} className="rounded-lg bg-[var(--mp-bg)] border border-[var(--mp-border)] px-3 py-2">
                        <div className="text-[9px] text-[var(--mp-muted)] uppercase tracking-wide">{s.label}</div>
                        <div className={`text-sm font-bold font-mono-n ${s.color ?? "text-[var(--mp-text)]"}`}>{String(s.value)}</div>
                      </div>
                    ))}
                  </div>
                  {stats.resolved > 0 && (
                    <div className="text-[9px] text-[var(--mp-muted)] text-center">
                      Histórico verificável · Base rate esperada ~45% (1X2) · Apenas picks resolvidos contam
                    </div>
                  )}
                </>
              )}
            </div>
          )}

        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}

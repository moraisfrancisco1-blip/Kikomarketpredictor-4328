import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  Search,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  AlertTriangle,
  Dice5,
  RefreshCw,
  Loader2,
  LineChart,
  Brain,
  Download,
  Share,
  X,
  ChevronDown,
  ChevronUp,
  Bookmark,
  BookmarkCheck,
  BarChart2,
  History,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import { LineChart as LineIcon, Trophy as TrophyIcon } from "lucide-react";
import { api } from "../lib/api";
import { PriceChart, EquityChart } from "../components/price-chart";
import { SportsView } from "./sports";
import { loadTrackerRecords, saveTrackerRecord, resolveTrackerRecord } from "../lib/tracker-client";

const PRESETS = ["AAPL", "MSFT", "TSLA", "AMZN", "BTC/USD", "ETH/USD", "EUR/USD"];

type View = "markets" | "sports" | "lottery";

export default function Index() {
  const [view, setView] = useState<View>("markets");
  return (
    <div className="min-h-screen w-full px-4 py-6 md:px-8 md:py-8 max-w-[1400px] mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-center gap-2 mb-6 flex-wrap"
      >
        <h1 className="font-display text-xl md:text-2xl font-extrabold tracking-tight flex items-center gap-2 mr-1 md:mr-3">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--mp-cyan)]/15 text-[var(--mp-cyan)]">
            <Activity size={18} />
          </span>
          Predictor
        </h1>
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          <NavTab active={view === "markets"} onClick={() => setView("markets")} icon={<LineIcon size={14} />} label="Mercados" />
          <NavTab active={view === "sports"} onClick={() => setView("sports")} icon={<TrophyIcon size={14} />} label="Esportes" />
          <NavTab active={view === "lottery"} onClick={() => setView("lottery")} icon={<Dice5 size={14} />} label="Loteria" />
        </div>
        <div className="ml-auto">
          <InstallButton />
        </div>
      </motion.div>

      {view === "markets" && <MarketsView />}
      {view === "sports" && <SportsView />}
      {view === "lottery" && <LotteryStandalone />}

      <footer className="text-center text-xs text-[var(--mp-muted)] mt-8">
        Protótipo educativo. Não é aconselhamento financeiro nem de apostas. Dados: Twelve Data, football-data.co.uk, TheSportsDB, martj42/international_results.
      </footer>
    </div>
  );
}

function NavTab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg border transition ${
        active ? "border-[var(--mp-cyan)] text-[var(--mp-cyan)] bg-[var(--mp-cyan)]/10" : "border-[var(--mp-border)] text-[var(--mp-muted)] hover:text-white"
      }`}
    >
      {icon} {label}
    </button>
  );
}

// "Adicionar à tela inicial" — uses the native install prompt on Android/desktop,
// shows iOS-specific instructions on iPhone/iPad (which has no programmatic prompt).
function InstallButton() {
  const [deferred, setDeferred] = useState<any>(null);
  const [installed, setInstalled] = useState(false);
  const [showIos, setShowIos] = useState(false);

  const isIos = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone);

  useEffect(() => {
    const onPrompt = (e: any) => {
      e.preventDefault();
      setDeferred(e);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (standalone || installed) return null;

  const click = async () => {
    if (isIos) {
      setShowIos(true);
      return;
    }
    if (deferred) {
      deferred.prompt();
      const res = await deferred.userChoice;
      if (res?.outcome === "accepted") setInstalled(true);
      setDeferred(null);
    } else {
      setShowIos(true); // generic fallback instructions
    }
  };

  return (
    <>
      <button
        onClick={click}
        className="flex items-center gap-1.5 text-xs md:text-sm px-3 py-2 rounded-lg border border-[var(--mp-cyan)]/50 text-[var(--mp-cyan)] bg-[var(--mp-cyan)]/10 hover:bg-[var(--mp-cyan)]/20 transition whitespace-nowrap"
      >
        <Download size={14} /> <span className="hidden sm:inline">Instalar app</span>
        <span className="sm:hidden">App</span>
      </button>

      {showIos && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4"
          onClick={() => setShowIos(false)}
        >
          <div
            className="mp-card p-5 max-w-sm w-full space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <Download size={18} className="text-[var(--mp-cyan)]" />
              <h3 className="font-display font-semibold">Adicionar à tela inicial</h3>
              <button onClick={() => setShowIos(false)} className="ml-auto text-[var(--mp-muted)] hover:text-white">
                <X size={18} />
              </button>
            </div>
            {isIos ? (
              <ol className="text-sm text-[var(--mp-muted)] space-y-2 leading-relaxed list-decimal pl-5">
                <li>
                  Toque no botão <Share size={13} className="inline -mt-0.5 text-[var(--mp-cyan)]" /> <span className="text-white">Compartilhar</span> na barra do Safari.
                </li>
                <li>
                  Escolha <span className="text-white">"Adicionar à Tela de Início"</span>.
                </li>
                <li>
                  Toque em <span className="text-white">"Adicionar"</span>. Pronto — vira um atalho no seu celular.
                </li>
              </ol>
            ) : (
              <ol className="text-sm text-[var(--mp-muted)] space-y-2 leading-relaxed list-decimal pl-5">
                <li>Abra o menu <span className="text-white">⋮</span> do navegador.</li>
                <li>
                  Escolha <span className="text-white">"Instalar app"</span> ou <span className="text-white">"Adicionar à tela inicial"</span>.
                </li>
                <li>Confirme. O atalho aparece no seu celular.</li>
              </ol>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function MarketsView() {
  const [symbol, setSymbol] = useState("AAPL");
  const [input, setInput] = useState("AAPL");

  const config = useQuery({
    queryKey: ["config"],
    queryFn: async () => (await api.config.$get()).json(),
  });

  const market = useQuery({
    queryKey: ["market", symbol],
    queryFn: async () => {
      const res = await api.markets.$get({ query: { symbol } });
      return res.json();
    },
  });

  const prediction = useQuery({
    queryKey: ["predict", symbol],
    queryFn: async () => {
      const res = await api.predict.$get({ query: { symbol } });
      return res.json();
    },
  });

  const backtest = useQuery({
    queryKey: ["backtest", symbol],
    queryFn: async () => {
      const res = await api.backtest.$get({ query: { symbol } });
      return res.json();
    },
  });

  const sentiment = useQuery({
    queryKey: ["sentiment", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/markets/sentiment?symbol=${encodeURIComponent(symbol)}`);
      return res.json();
    },
    staleTime: 30 * 60 * 1000,
    retry: false,
  });

  const earnings = useQuery({
    queryKey: ["earnings", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/markets/earnings?symbol=${encodeURIComponent(symbol)}`);
      return res.json();
    },
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  });

  const submit = (s: string) => {
    const v = s.trim().toUpperCase();
    if (v) setSymbol(v);
  };

  // Note: symbols with "/" (e.g. BTC/USD) are URL-encoded by the Hono client.

  const candles = (market.data as any)?.candles ?? [];
  const pred = (prediction.data as any)?.prediction;
  const bt = (backtest.data as any)?.result;
  const marketErr = (market.data as any)?.error;
  const sentimentData = (sentiment.data as any)?.sentiment;
  const earningsData = (earnings.data as any)?.earnings;

  return (
    <div>
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6"
      >
        <div>
          <p className="text-sm text-[var(--mp-muted)]">
            Terminal de previsão quantitativa · dados reais de mercado ·{" "}
            {config.data && (
              <>
                <span className={(config.data as any).hasRealKey ? "text-[var(--mp-bull)]" : "text-[var(--mp-amber)]"}>
                  {(config.data as any).hasRealKey ? "chave ativa" : "chave demo (símbolos limitados)"}
                </span>
                {(config.data as any).hasFallback && (
                  <span className="text-[var(--mp-muted)]"> · fallback Alpha Vantage ativo</span>
                )}
              </>
            )}
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="flex items-center gap-2"
        >
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--mp-muted)]" />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Símbolo ex. AAPL"
              className="font-mono-n w-44 rounded-lg bg-[var(--mp-surface)] border border-[var(--mp-border)] pl-9 pr-3 py-2 text-sm outline-none focus:border-[var(--mp-cyan)]"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-[var(--mp-cyan)] text-black font-semibold px-4 py-2 text-sm hover:brightness-110 transition"
          >
            Analisar
          </button>
        </form>
      </motion.header>

      {/* Presets */}
      <div className="flex flex-wrap gap-2 mb-5">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => {
              setInput(p);
              submit(p);
            }}
            className={`font-mono-n text-xs px-3 py-1.5 rounded-md border transition ${
              symbol === p
                ? "border-[var(--mp-cyan)] text-[var(--mp-cyan)] bg-[var(--mp-cyan)]/10"
                : "border-[var(--mp-border)] text-[var(--mp-muted)] hover:text-white"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Honesty banner */}
      <div className="mp-card p-3 mb-6 flex items-start gap-3 border-[var(--mp-amber)]/30">
        <AlertTriangle size={18} className="text-[var(--mp-amber)] shrink-0 mt-0.5" />
        <p className="text-xs text-[var(--mp-muted)] leading-relaxed">
          <span className="text-[var(--mp-amber)] font-semibold">Pé no chão.</span>{" "}
          Movimentos de mercado de curto prazo são, em sua maioria, ruído — nenhum modelo "vence o mercado" de forma
          confiável. Trate as previsões como sinais probabilísticos de baixa confiança, validados pelo backtest. O módulo
          de loteria existe para <span className="text-white">provar que não há vantagem possível</span>, não para ganhar.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Chart + market */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05 }}
          className="mp-card p-5 lg:col-span-2"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <LineChart size={16} className="text-[var(--mp-cyan)]" />
              <h2 className="font-display font-semibold">{symbol} · diário</h2>
            </div>
            <button
              onClick={() => {
                market.refetch();
                prediction.refetch();
                backtest.refetch();
              }}
              className="text-[var(--mp-muted)] hover:text-white transition"
            >
              <RefreshCw size={15} className={market.isFetching ? "animate-spin" : ""} />
            </button>
          </div>

          {market.isLoading ? (
            <div className="h-[280px] flex items-center justify-center text-[var(--mp-muted)]">
              <Loader2 className="animate-spin mr-2" size={18} /> carregando dados de mercado…
            </div>
          ) : marketErr ? (
            <div className="h-[280px] flex flex-col items-center justify-center text-[var(--mp-bear)] gap-2 text-sm">
              <AlertTriangle size={20} />
              {marketErr}
              {!(config.data as any)?.hasRealKey && (
                <span className="text-[var(--mp-muted)] text-xs">
                  A chave demo suporta símbolos limitados. Adicione uma chave Twelve Data para acesso completo.
                </span>
              )}
            </div>
          ) : (
            <>
              <PriceChart candles={candles} />
              {candles.length > 1 && (
                <div className="flex items-center gap-6 mt-3 font-mono-n text-sm">
                  <span className="text-[var(--mp-muted)]">
                    último{" "}
                    <span className="text-white">{candles[candles.length - 1].close.toFixed(2)}</span>
                  </span>
                  <span className="text-[var(--mp-muted)]">
                    faixa{" "}
                    <span className="text-white">
                      {Math.min(...candles.slice(-180).map((c: any) => c.low)).toFixed(2)} –{" "}
                      {Math.max(...candles.slice(-180).map((c: any) => c.high)).toFixed(2)}
                    </span>
                  </span>
                  <span className="text-[var(--mp-muted)]">{candles.length} candles</span>
                </div>
              )}
            </>
          )}
        </motion.section>

        {/* Prediction */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mp-card p-5"
        >
          <div className="flex items-center gap-2 mb-4">
            <Brain size={16} className="text-[var(--mp-cyan)]" />
            <h2 className="font-display font-semibold">Previsão</h2>
          </div>

          {prediction.isLoading ? (
            <div className="h-[240px] flex items-center justify-center text-[var(--mp-muted)]">
              <Loader2 className="animate-spin" size={18} />
            </div>
          ) : pred ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <DirBadge dir={pred.direction} />
                <div>
                  <div>
                    <div className="font-mono-n text-2xl font-bold">
                      {(pred.probabilityUp * 100).toFixed(1)}%
                    </div>
                    {pred.probabilityUpCalibrated && (
                      <div className="font-mono-n text-xs text-[var(--mp-muted)]">
                        calibrada: {(pred.probabilityUpCalibrated * 100).toFixed(1)}%
                        <span className="ml-1 opacity-60">(Platt)</span>
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-[var(--mp-muted)]">probabilidade de alta (próximo dia)</div>
                </div>
              </div>

              {/* Regime badge */}
              {pred.regime && (
                <RegimeBadge regime={pred.regime.regime} strength={pred.regime.strength} />
              )}
              {pred.regime?.description && (
                <p className="text-[11px] text-[var(--mp-muted)] leading-relaxed">{pred.regime.description}</p>
              )}

              {/* Volume signal */}
              {pred.volumeSignal && (
                <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${
                  pred.volumeSignal.signal === "high"
                    ? pred.volumeSignal.confirmsMove
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                      : "bg-amber-500/10 border-amber-500/30 text-amber-400"
                    : pred.volumeSignal.signal === "low"
                    ? "bg-[var(--mp-surface)] border-[var(--mp-border)] text-[var(--mp-muted)]"
                    : "bg-[var(--mp-surface)] border-[var(--mp-border)] text-[var(--mp-muted)]"
                }`}>
                  <BarChart2 size={12} />
                  <span>
                    Volume {pred.volumeSignal.signal === "high" ? "↑ elevado" : pred.volumeSignal.signal === "low" ? "↓ fraco" : "normal"} ({pred.volumeSignal.ratio}×)
                    {pred.volumeSignal.confirmsMove ? " — confirma movimento" : pred.volumeSignal.signal === "high" ? " — sem confirmação direcional" : ""}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Stat label="Retorno esp." value={`${pred.expectedReturnPct >= 0 ? "+" : ""}${pred.expectedReturnPct.toFixed(2)}%`} good={pred.expectedReturnPct >= 0} />
                <ConfidencePanel
                  confidence={pred.confidence}
                  explained={pred.confidenceExplained}
                  pct={`${(pred.confidence * 100).toFixed(0)}%`}
                />
              </div>

              <div>
                <div className="text-xs text-[var(--mp-muted)] mb-2 uppercase tracking-wider">Sinais</div>
                <div className="space-y-1.5">
                  {pred.signals.map((s: any) => (
                    <div key={s.name} className="flex items-center justify-between text-sm">
                      <span className="text-[var(--mp-muted)]">{s.name}</span>
                      <span className="flex items-center gap-2 font-mono-n">
                        {s.value}
                        <Vote v={s.vote} />
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Asset correlations */}
              {pred.correlations && pred.correlations.length > 0 && (
                <div className="pt-2 border-t border-[var(--mp-border)]">
                  <div className="text-xs text-[var(--mp-muted)] mb-2 uppercase tracking-wider">Correlações conhecidas</div>
                  <div className="space-y-1">
                    {pred.correlations.map((c: any) => (
                      <div key={c.related} className="flex items-center justify-between text-xs">
                        <span className="text-[var(--mp-muted)]">{c.related}</span>
                        <span className={`font-mono-n ${c.typical > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {c.typical > 0 ? "+" : ""}{c.typical} &nbsp;
                          <span className="text-[var(--mp-muted)] font-normal">{c.note}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-[11px] text-[var(--mp-muted)] leading-relaxed pt-1 border-t border-[var(--mp-border)]">
                Probabilidade calibrada via Platt scaling. Confirme sempre com o backtest abaixo.
              </p>
              {/* Save to tracker */}
              <SaveMarketPickButton pred={pred} symbol={symbol} />
            </div>
          ) : (
            <div className="h-[240px] flex items-center justify-center text-[var(--mp-muted)] text-sm text-center px-4">
              Nenhuma previsão disponível para este símbolo.
            </div>
          )}
        </motion.section>

        {/* Sentiment + Earnings row */}
        {(sentimentData || earningsData) && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.08 }}
            className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-4"
          >
            {/* Sentiment */}
            {sentimentData && (
              <div className="mp-card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp size={14} className="text-[var(--mp-cyan)]" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--mp-muted)]">Sentimento de mercado</span>
                  <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${
                    sentimentData.label === "bullish" ? "bg-emerald-500/15 text-emerald-400" :
                    sentimentData.label === "bearish" ? "bg-rose-500/15 text-rose-400" :
                    "bg-[var(--mp-surface)] text-[var(--mp-muted)]"
                  }`}>
                    {sentimentData.label === "bullish" ? "Altista" : sentimentData.label === "bearish" ? "Baixista" : "Neutro"}
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1 h-2 rounded-full bg-[var(--mp-surface)] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${sentimentData.score > 0 ? "bg-emerald-500" : "bg-rose-500"}`}
                      style={{ width: `${Math.abs(sentimentData.score) * 100}%`, marginLeft: sentimentData.score < 0 ? "auto" : 0 }}
                    />
                  </div>
                  <span className="text-xs font-mono-n text-[var(--mp-muted)]">{sentimentData.score > 0 ? "+" : ""}{(sentimentData.score * 100).toFixed(0)}</span>
                </div>
                {sentimentData.topHeadlines?.length > 0 && (
                  <div className="space-y-1">
                    {sentimentData.topHeadlines.slice(0, 2).map((h: string, i: number) => (
                      <p key={i} className="text-[10px] text-[var(--mp-muted)] leading-relaxed truncate">{h}</p>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-[var(--mp-muted)] mt-2 opacity-60">via {sentimentData.source} · {sentimentData.articleCount} artigos</p>
              </div>
            )}

            {/* Earnings */}
            {earningsData && (
              <div className={`mp-card p-4 ${earningsData.hasUpcomingEarnings ? "border-amber-500/40" : ""}`}>
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle size={14} className={earningsData.hasUpcomingEarnings ? "text-amber-400" : "text-[var(--mp-muted)]"} />
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--mp-muted)]">Resultados / Earnings</span>
                </div>
                {earningsData.hasUpcomingEarnings ? (
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-amber-400">⚠️ Resultados em {earningsData.daysToEarnings} dia(s)</p>
                    <p className="text-xs text-[var(--mp-muted)]">{earningsData.earningsDate}</p>
                    <p className="text-[11px] text-amber-400/80 leading-relaxed mt-2">{earningsData.warning}</p>
                  </div>
                ) : (
                  <p className="text-sm text-[var(--mp-muted)]">Sem resultados iminentes</p>
                )}
              </div>
            )}
          </motion.div>
        )}

        {/* Backtest */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="mp-card p-5 lg:col-span-2"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-[var(--mp-cyan)]" />
              <h2 className="font-display font-semibold">Backtest · {bt?.strategy ?? "Cruzamento de MMS"}</h2>
            </div>
            <div className="flex items-center gap-4 text-[11px] font-mono-n">
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-[var(--mp-cyan)]" /> estratégia</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-[#64748b]" style={{ borderTop: "1px dashed" }} /> comprar &amp; segurar</span>
            </div>
          </div>

          {backtest.isLoading ? (
            <div className="h-[220px] flex items-center justify-center text-[var(--mp-muted)]">
              <Loader2 className="animate-spin" size={18} />
            </div>
          ) : bt ? (
            <>
              <EquityChart curve={bt.equityCurve} />
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
                <Stat label="Retorno estratégia" value={`${bt.stats.totalReturnPct >= 0 ? "+" : ""}${bt.stats.totalReturnPct.toFixed(1)}%`} good={bt.stats.totalReturnPct >= 0} />
                <Stat label="Comprar & segurar" value={`${bt.stats.buyHoldReturnPct >= 0 ? "+" : ""}${bt.stats.buyHoldReturnPct.toFixed(1)}%`} good={bt.stats.buyHoldReturnPct >= 0} />
                <Stat label="Sharpe" value={bt.stats.sharpe.toFixed(2)} good={bt.stats.sharpe > 1} />
                <Stat label="Drawdown máx." value={`-${bt.stats.maxDrawdownPct.toFixed(1)}%`} bad />
                <Stat label="Taxa de acerto" value={`${bt.stats.winRate.toFixed(0)}%`} />
                <Stat label="Operações" value={`${bt.stats.trades}`} />
              </div>
            </>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-[var(--mp-muted)] text-sm">
              Nenhum backtest disponível.
            </div>
          )}
        </motion.section>

        {/* Tracker panel */}
        <MarketTrackerPanelSection />

      </div>
    </div>
  );
}

// ─── Market Tracker Panel Section ────────────────────────────────────────────
function MarketTrackerPanelSection() {
  const [open, setOpen] = useState(false);
  const count = loadTrackerRecords().filter((r: any) => r.kind === "market").length;
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="mp-card p-5 lg:col-span-2"
    >
      <button
        className="w-full flex items-center justify-between"
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-center gap-2">
          <History size={16} className="text-[var(--mp-cyan)]" />
          <h2 className="font-display font-semibold">Histórico de Picks</h2>
          {count > 0 && (
            <span className="text-[10px] font-mono-n bg-[var(--mp-cyan)]/15 text-[var(--mp-cyan)] px-2 py-0.5 rounded-full">{count}</span>
          )}
        </div>
        {open ? <ChevronUp size={14} className="text-[var(--mp-muted)]" /> : <ChevronDown size={14} className="text-[var(--mp-muted)]" />}
      </button>
      {open && (
        <div className="mt-4">
          <MarketTrackerPanel />
        </div>
      )}
    </motion.section>
  );
}

// ─── EuroMillions ─────────────────────────────────────────────────────────────

type LotTab = "gerador" | "frequencias" | "probabilidades" | "simulador" | "analisar";

function LotteryStandalone() {
  const [tab, setTab] = useState<LotTab>("gerador");
  const tabs: { id: LotTab; label: string }[] = [
    { id: "gerador", label: "Gerador" },
    { id: "frequencias", label: "Frequências" },
    { id: "probabilidades", label: "Probabilidades" },
    { id: "simulador", label: "Simulador" },
    { id: "analisar", label: "Analisar Bilhete" },
  ];

  return (
    <div className="w-full max-w-5xl">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mp-card p-5 mb-4 border-[var(--mp-amber)]/40"
      >
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--mp-amber)]/15 flex items-center justify-center">
            <Dice5 size={16} className="text-[var(--mp-amber)]" />
          </div>
          <div>
            <h2 className="font-display font-semibold text-base">EuroMillões — Análise Matemática</h2>
            <p className="text-[11px] text-[var(--mp-muted)]">Baseado em {(1952).toLocaleString("pt-PT")} sorteios reais (2004–2026) · combinatória exacta · probabilidades reais</p>
          </div>
        </div>
        <div className="rounded-lg bg-[var(--mp-amber)]/8 border border-[var(--mp-amber)]/20 px-3 py-2 text-[11px] text-[var(--mp-amber)] leading-relaxed">
          ⚠ Sorteios são uniformemente aleatórios e independentes. Análise estatística não aumenta probabilidades de ganhar. Esta ferramenta apresenta matemática real — não previsões.
        </div>
      </motion.div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 flex-wrap">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
              tab === t.id
                ? "border-[var(--mp-amber)] text-[var(--mp-amber)] bg-[var(--mp-amber)]/10"
                : "border-[var(--mp-border)] text-[var(--mp-muted)] hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "gerador" && <LotGerador />}
      {tab === "frequencias" && <LotFrequencias />}
      {tab === "probabilidades" && <LotProbabilidades />}
      {tab === "simulador" && <LotSimulador />}
      {tab === "analisar" && <LotAnalisar />}
    </div>
  );
}

// ─── Gerador ──────────────────────────────────────────────────────────────────
function LotGerador() {
  const [strategy, setStrategy] = useState<string>("random");
  const [count, setCount] = useState(5);

  const gen = useQuery({
    queryKey: ["gen", strategy, count],
    queryFn: async () =>
      (await api.lottery.euromillions.generate.$get({ query: { n: String(count), strategy } })).json(),
  });

  const strategies = [
    { id: "random", label: "Aleatório puro", desc: "Completamente aleatório" },
    { id: "hot", label: "Quentes", desc: "Favorece nºs mais sorteados historicamente" },
    { id: "cold", label: "Frios", desc: "Favorece nºs menos sorteados historicamente" },
    { id: "balanced", label: "Equilibrado", desc: "Soma 88–165, mix par/ímpar 2-3" },
    { id: "smart", label: "Smart", desc: "Quentes recentes + pares frequentes + soma ideal" },
  ];

  const tix = (gen.data as any)?.tickets ?? [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mp-card p-5 border-[var(--mp-amber)]/20">
        <h3 className="text-xs font-semibold text-[var(--mp-muted)] uppercase tracking-wider mb-3">Estratégia</h3>
        <div className="space-y-2 mb-4">
          {strategies.map(s => (
            <button
              key={s.id}
              onClick={() => setStrategy(s.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
                strategy === s.id
                  ? "border-[var(--mp-amber)] bg-[var(--mp-amber)]/8"
                  : "border-[var(--mp-border)] hover:border-[var(--mp-amber)]/40"
              }`}
            >
              <div className="text-xs font-semibold">{s.label}</div>
              <div className="text-[10px] text-[var(--mp-muted)] mt-0.5">{s.desc}</div>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--mp-muted)]">Bilhetes:</span>
          {[3,5,10].map(n => (
            <button
              key={n}
              onClick={() => setCount(n)}
              className={`font-mono-n text-xs px-2.5 py-1 rounded border ${
                count === n ? "border-[var(--mp-amber)] text-[var(--mp-amber)]" : "border-[var(--mp-border)] text-[var(--mp-muted)]"
              }`}
            >
              {n}
            </button>
          ))}
          <button
            onClick={() => gen.refetch()}
            className="ml-auto flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded bg-[var(--mp-amber)] text-black hover:brightness-110"
          >
            <RefreshCw size={12} className={gen.isFetching ? "animate-spin" : ""} />
            Gerar
          </button>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mp-card p-5 border-[var(--mp-amber)]/20">
        <h3 className="text-xs font-semibold text-[var(--mp-muted)] uppercase tracking-wider mb-3">
          Bilhetes Gerados
          {strategy !== "random" && <span className="ml-2 text-[var(--mp-amber)]">· estratégia: {strategies.find(s=>s.id===strategy)?.label}</span>}
        </h3>
        {gen.isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin text-[var(--mp-amber)]" size={20} /></div>
        ) : (
          <div className="space-y-3">
            {tix.map((t: any, i: number) => (
              <div key={i} className="rounded-lg bg-[var(--mp-bg)]/50 p-3">
                <div className="text-[10px] text-[var(--mp-muted)] mb-2">Bilhete {i+1}</div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {t.main.map((n: number) => <Ball key={`m${n}`} n={n} />)}
                  <span className="text-[var(--mp-muted)] mx-1.5">⭐</span>
                  {t.stars.map((n: number) => <Ball key={`s${n}`} n={n} star />)}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 pt-3 border-t border-[var(--mp-border)] text-[10px] text-[var(--mp-muted)]">
          Probabilidade de jackpot por bilhete: <span className="font-mono-n text-white">1 em 139.838.160</span>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Frequências ──────────────────────────────────────────────────────────────
function LotFrequencias() {
  const freq = useQuery({
    queryKey: ["lotFreq"],
    queryFn: async () => (await api.lottery.euromillions.frequency.$get()).json(),
  });

  const data = (freq.data as any)?.analysis;

  if (freq.isLoading || !data) return (
    <div className="flex justify-center py-12"><Loader2 className="animate-spin text-[var(--mp-amber)]" size={24} /></div>
  );

  const mainNums: any[] = data.mainNumbers;
  const stars: any[] = data.stars;
  const maxMain = Math.max(...mainNums.map((n: any) => n.count));
  const maxStar = Math.max(...stars.map((s: any) => s.count));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Hot/Cold */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mp-card p-4 border-[var(--mp-amber)]/20">
          <h3 className="text-xs font-semibold text-[var(--mp-muted)] uppercase tracking-wider mb-3">🔥 Quentes (últ. 52 sorteios)</h3>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {data.hotNumbers.map((n: number) => <Ball key={n} n={n} hot />)}
          </div>
          <h3 className="text-xs font-semibold text-[var(--mp-muted)] uppercase tracking-wider mb-3">🧊 Frios (últ. 20 sorteios)</h3>
          <div className="flex flex-wrap gap-1.5">
            {data.coldNumbers.map((n: number) => <Ball key={n} n={n} cold />)}
          </div>
        </motion.div>

        {/* Pairs */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mp-card p-4 border-[var(--mp-amber)]/20">
          <h3 className="text-xs font-semibold text-[var(--mp-muted)] uppercase tracking-wider mb-3">Pares Mais Frequentes</h3>
          <div className="space-y-1.5">
            {data.topPairs.slice(0,8).map((p: any, i: number) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex gap-1">
                  <Ball n={p.pair[0]} mini />
                  <Ball n={p.pair[1]} mini />
                </div>
                <div className="flex-1 h-1.5 rounded-full bg-[var(--mp-border)]">
                  <div className="h-full rounded-full bg-[var(--mp-cyan)]/60" style={{ width: `${p.count/28*100}%` }} />
                </div>
                <span className="font-mono-n text-[10px] text-[var(--mp-muted)] w-6 text-right">{p.count}x</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Stats */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mp-card p-4 border-[var(--mp-amber)]/20">
          <h3 className="text-xs font-semibold text-[var(--mp-muted)] uppercase tracking-wider mb-3">Padrões Históricos</h3>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between"><span className="text-[var(--mp-muted)]">Soma ideal</span><span className="font-mono-n">88–165</span></div>
            <div className="flex justify-between"><span className="text-[var(--mp-muted)]">Soma média</span><span className="font-mono-n">127,5</span></div>
            <div className="flex justify-between"><span className="text-[var(--mp-muted)]">Distribuição ímpares</span><span className="font-mono-n">2 ou 3 → 65%</span></div>
            <div className="flex justify-between"><span className="text-[var(--mp-muted)]">Sem consecutivos</span><span className="font-mono-n">65,3%</span></div>
            <div className="flex justify-between"><span className="text-[var(--mp-muted)]">1 par consecutivo</span><span className="font-mono-n">30,3%</span></div>
            <div className="border-t border-[var(--mp-border)] pt-2 mt-2">
              <div className="text-[10px] text-[var(--mp-muted)] mb-1">Mix par/ímpar observado:</div>
              {Object.entries(data.oddEvenDist).map(([k, v]: any) => (
                <div key={k} className="flex justify-between text-[10px]">
                  <span className="text-[var(--mp-muted)]">{k}</span>
                  <span className="font-mono-n">{(v/1952*100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Frequency bars - Main numbers */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mp-card p-4 border-[var(--mp-amber)]/20">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-[var(--mp-muted)] uppercase tracking-wider">Frequência — Números Principais (1–50)</h3>
          <span className="text-[10px] text-[var(--mp-muted)]">esperado: ~195 · {data.totalDraws} sorteios</span>
        </div>
        <div className="flex items-end gap-px h-16 overflow-hidden">
          {Array.from({length:50},(_,i)=>i+1).map(n => {
            const entry = mainNums.find((x: any) => x.number === n);
            const count = entry?.count ?? 195;
            const h = (count / maxMain) * 100;
            const isHot = data.hotNumbers.includes(n);
            const isCold = data.coldNumbers.includes(n);
            return (
              <div key={n} className="flex-1 relative group" title={`${n}: ${count} sorteios`}>
                <div
                  className={`w-full rounded-sm transition-all ${isHot ? "bg-[var(--mp-amber)]" : isCold ? "bg-[var(--mp-bear)]/60" : "bg-[var(--mp-cyan)]/40"}`}
                  style={{ height: `${h}%` }}
                />
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-[var(--mp-card)] border border-[var(--mp-border)] rounded px-1 py-0.5 text-[9px] font-mono-n hidden group-hover:block whitespace-nowrap z-10">
                  {n}: {count}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-[9px] text-[var(--mp-muted)] mt-1">
          <span>1</span><span>10</span><span>20</span><span>30</span><span>40</span><span>50</span>
        </div>
        <div className="flex gap-4 mt-2 text-[10px]">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[var(--mp-amber)] inline-block" />Quente (últ. 52)</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[var(--mp-bear)]/60 inline-block" />Frio (últ. 20)</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[var(--mp-cyan)]/40 inline-block" />Normal</span>
        </div>
      </motion.div>

      {/* Stars frequency */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mp-card p-4 border-[var(--mp-amber)]/20">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-[var(--mp-muted)] uppercase tracking-wider">Frequência — Estrelas (1–12)</h3>
          <span className="text-[10px] text-[var(--mp-muted)]">esperado: ~325</span>
        </div>
        <div className="grid grid-cols-12 gap-2">
          {stars.sort((a: any, b: any) => a.number - b.number).map((s: any) => (
            <div key={s.number} className="text-center">
              <div className="h-12 flex items-end mb-1">
                <div
                  className="w-full rounded-sm bg-[var(--mp-amber)]/60"
                  style={{ height: `${(s.count/maxStar)*100}%` }}
                />
              </div>
              <Ball n={s.number} star mini />
              <div className="font-mono-n text-[9px] text-[var(--mp-muted)] mt-0.5">{s.count}</div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

// ─── Probabilidades ───────────────────────────────────────────────────────────
function LotProbabilidades() {
  const ev = useQuery({
    queryKey: ["ev"],
    queryFn: async () => (await api.lottery.euromillions.ev.$get()).json(),
  });

  const evd = (ev.data as any)?.ev;

  if (!evd) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-[var(--mp-amber)]" size={24} /></div>;

  return (
    <div className="space-y-4">
      {/* Key stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Combinações totais", value: "139.838.160", color: "white" },
          { label: "Retorno por €2,50", value: `€${evd.expectedReturn.toFixed(3)}`, color: "var(--mp-bear)" },
          { label: "Perda esperada", value: `€${evd.expectedLoss.toFixed(3)}`, color: "var(--mp-bear)" },
          { label: "RTP (return-to-player)", value: `${(evd.returnRatio*100).toFixed(1)}%`, color: "var(--mp-bear)" },
        ].map((s, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i*0.05 }}
            className="mp-card p-3 border-[var(--mp-amber)]/20 text-center"
          >
            <div className="text-[10px] text-[var(--mp-muted)] mb-1">{s.label}</div>
            <div className="font-mono-n text-sm font-bold" style={{ color: s.color }}>{s.value}</div>
          </motion.div>
        ))}
      </div>

      {/* Jackpot reality check */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mp-card p-5 border-[var(--mp-bear)]/30">
        <h3 className="text-xs font-semibold uppercase tracking-wider mb-3">Perspectiva Real do Jackpot</h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
          <div className="rounded-lg bg-[var(--mp-bg)]/60 p-3">
            <div className="text-[var(--mp-muted)] mb-1">Prob. jackpot por bilhete</div>
            <div className="font-mono-n text-lg font-bold text-[var(--mp-bear)]">0.000000715%</div>
            <div className="text-[10px] text-[var(--mp-muted)] mt-1">= 1 em 139.838.160</div>
          </div>
          <div className="rounded-lg bg-[var(--mp-bg)]/60 p-3">
            <div className="text-[var(--mp-muted)] mb-1">Para 50% de chance de jackpot</div>
            <div className="font-mono-n text-lg font-bold text-white">96.948.600</div>
            <div className="text-[10px] text-[var(--mp-muted)] mt-1">bilhetes = €242M gastos</div>
          </div>
          <div className="rounded-lg bg-[var(--mp-bg)]/60 p-3">
            <div className="text-[var(--mp-muted)] mb-1">Jackpot ganho em média</div>
            <div className="font-mono-n text-lg font-bold text-[var(--mp-amber)]">cada 5,2 sorteios</div>
            <div className="text-[10px] text-[var(--mp-muted)] mt-1">= ~1 vez por mês (histórico)</div>
          </div>
        </div>
      </motion.div>

      {/* Tiers table */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mp-card p-5 border-[var(--mp-amber)]/20">
        <h3 className="text-xs font-semibold uppercase tracking-wider mb-3">Tabela de Prémios — Probabilidades Exactas</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[var(--mp-muted)] border-b border-[var(--mp-border)]">
                <th className="text-left pb-2 font-medium">Categoria</th>
                <th className="text-left pb-2 font-medium">Match</th>
                <th className="text-right pb-2 font-medium">Probabilidade exacta</th>
                <th className="text-right pb-2 font-medium">Odds</th>
                <th className="text-right pb-2 font-medium">Prémio médio</th>
                <th className="text-right pb-2 font-medium">EV por bilhete</th>
              </tr>
            </thead>
            <tbody>
              {evd.tiers.map((t: any, i: number) => (
                <tr key={i} className="border-b border-[var(--mp-border)]/40 hover:bg-[var(--mp-amber)]/5">
                  <td className="py-1.5 text-[var(--mp-muted)]">{t.description}</td>
                  <td className="py-1.5 font-mono-n">{t.tier}</td>
                  <td className="py-1.5 font-mono-n text-right">{(t.prob * 100).toFixed(8)}%</td>
                  <td className="py-1.5 font-mono-n text-right text-[var(--mp-muted)]">{t.exactOdds}</td>
                  <td className="py-1.5 font-mono-n text-right">€{t.avgPrize.toLocaleString("pt-PT")}</td>
                  <td className={`py-1.5 font-mono-n text-right ${t.evContribution > 0.01 ? "text-[var(--mp-bull)]" : "text-[var(--mp-muted)]"}`}>
                    €{t.evContribution.toFixed(4)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-[var(--mp-amber)]/40 font-semibold">
                <td colSpan={5} className="pt-2 text-[var(--mp-amber)]">Total retorno esperado por €2,50</td>
                <td className="pt-2 font-mono-n text-right text-[var(--mp-bear)]">€{evd.expectedReturn.toFixed(4)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-[10px] text-[var(--mp-muted)]">
          * Probabilidades calculadas por combinatória exacta: C(50,5) × C(12,2) = 139.838.160. Prémios são médias históricas estimadas — variam com jackpot acumulado e número de vencedores.
        </div>
      </motion.div>

      {/* Historical jackpot */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mp-card p-4 border-[var(--mp-amber)]/20">
        <h3 className="text-xs font-semibold uppercase tracking-wider mb-3">Dados Históricos (1952 sorteios reais)</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {[
            { label: "Sorteios com jackpot ganho", value: `443 / 1952 (22,7%)` },
            { label: "Jackpot médio ganho", value: "€55,9M" },
            { label: "Jackpot máximo ganho", value: "€250M" },
            { label: "Qualquer prémio (odds)", value: `1 em ${evd.anyPrizeOdds}` },
          ].map((s, i) => (
            <div key={i} className="rounded-lg bg-[var(--mp-bg)]/50 p-2.5">
              <div className="text-[var(--mp-muted)] mb-1">{s.label}</div>
              <div className="font-mono-n font-semibold">{s.value}</div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

// ─── Simulador de vida ────────────────────────────────────────────────────────
function LotSimulador() {
  const [playsPerWeek, setPlaysPerWeek] = useState(2);
  const [years, setYears] = useState(20);
  const [mcTickets, setMcTickets] = useState(100000);
  const [tab, setTab] = useState<"vida" | "montecarlo">("vida");

  const lifetime = useQuery({
    queryKey: ["lifetime", playsPerWeek, years],
    queryFn: async () =>
      (await api.lottery.euromillions.lifetime.$get({ query: { playsPerWeek: String(playsPerWeek), years: String(years), weeksPerYear: "104" } })).json(),
  });

  const mc = useQuery({
    queryKey: ["mc", mcTickets],
    queryFn: async () =>
      (await api.lottery.euromillions.simulate.$get({ query: { tickets: String(mcTickets) } })).json(),
    enabled: false,
  });

  const ltd = (lifetime.data as any)?.simulation;
  const mcd = (mc.data as any)?.simulation;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 mb-2">
        {[{id:"vida",l:"Simulador Ciclo de Vida"},{id:"montecarlo",l:"Monte Carlo"}].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            className={`text-xs px-3 py-1.5 rounded-full border ${tab===t.id?"border-[var(--mp-amber)] text-[var(--mp-amber)]":"border-[var(--mp-border)] text-[var(--mp-muted)]"}`}>
            {t.l}
          </button>
        ))}
      </div>

      {tab === "vida" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mp-card p-5 border-[var(--mp-amber)]/20">
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-4">Parâmetros</h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs mb-2">
                  <span className="text-[var(--mp-muted)]">Bilhetes/semana</span>
                  <span className="font-mono-n text-[var(--mp-amber)]">{playsPerWeek}</span>
                </div>
                <input type="range" min={1} max={20} value={playsPerWeek} onChange={e => setPlaysPerWeek(+e.target.value)}
                  className="w-full accent-[var(--mp-amber)]" />
              </div>
              <div>
                <div className="flex justify-between text-xs mb-2">
                  <span className="text-[var(--mp-muted)]">Anos a jogar</span>
                  <span className="font-mono-n text-[var(--mp-amber)]">{years}</span>
                </div>
                <input type="range" min={1} max={50} value={years} onChange={e => setYears(+e.target.value)}
                  className="w-full accent-[var(--mp-amber)]" />
              </div>
              <div className="rounded-lg bg-[var(--mp-bg)]/60 p-3 text-xs space-y-1">
                <div className="flex justify-between"><span className="text-[var(--mp-muted)]">Total de bilhetes</span><span className="font-mono-n">{(playsPerWeek*104*years).toLocaleString("pt-PT")}</span></div>
                <div className="flex justify-between"><span className="text-[var(--mp-muted)]">Total gasto</span><span className="font-mono-n text-[var(--mp-bear)]">€{(playsPerWeek*104*years*2.5).toLocaleString("pt-PT",{minimumFractionDigits:2})}</span></div>
              </div>
            </div>
          </motion.div>

          {ltd && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mp-card p-5 border-[var(--mp-bear)]/30">
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-4 text-[var(--mp-bear)]">Resultados — Perspectiva Honesta</h3>
              <div className="space-y-2.5 text-xs">
                {[
                  { l: "Retorno esperado total", v: `€${ltd.expectedReturn.toLocaleString("pt-PT",{minimumFractionDigits:2})}`, bad: true },
                  { l: "Perda esperada total", v: `€${ltd.expectedLoss.toLocaleString("pt-PT",{minimumFractionDigits:2})}`, bad: true },
                  { l: "ROI esperado", v: `${ltd.returnOnInvestment}%`, bad: true },
                  { l: "Prob. de jackpot em toda a vida", v: ltd.probJackpotStr, bad: true },
                  { l: "Prob. de algum prémio pequeno", v: `${ltd.probAnyPrize.toFixed(2)}%`, good: true },
                  { l: "Bilhetes p/ 50% chance de jackpot", v: ltd.ticketsFor50pct.toLocaleString("pt-PT"), bad: true },
                  { l: "Custo p/ 50% chance de jackpot", v: `€${ltd.costFor50pct.toLocaleString("pt-PT",{maximumFractionDigits:0})}`, bad: true },
                ].map((s, i) => (
                  <div key={i} className="flex justify-between rounded-lg bg-[var(--mp-bg)]/50 px-3 py-2">
                    <span className="text-[var(--mp-muted)]">{s.l}</span>
                    <span className={`font-mono-n font-semibold ${s.bad ? "text-[var(--mp-bear)]" : s.good ? "text-[var(--mp-bull)]" : ""}`}>{s.v}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      )}

      {tab === "montecarlo" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mp-card p-5 border-[var(--mp-amber)]/20">
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-4">Simular compra de N bilhetes</h3>
            <div className="space-y-2 mb-4">
              {[10000, 100000, 1000000, 5000000].map(n => (
                <button key={n} onClick={() => setMcTickets(n)}
                  className={`block w-full text-left px-3 py-2 rounded border text-xs font-mono-n ${
                    mcTickets === n ? "border-[var(--mp-amber)] text-[var(--mp-amber)]" : "border-[var(--mp-border)] text-[var(--mp-muted)]"
                  }`}
                >
                  {n.toLocaleString("pt-PT")} bilhetes · gasto: €{(n*2.5).toLocaleString("pt-PT",{maximumFractionDigits:0})}
                </button>
              ))}
            </div>
            <button onClick={() => mc.refetch()}
              className="w-full text-xs font-semibold px-3 py-2 rounded bg-[var(--mp-amber)] text-black hover:brightness-110 flex items-center justify-center gap-2"
            >
              {mc.isFetching ? <Loader2 className="animate-spin" size={14} /> : <><Activity size={14} />Rodar simulação</>}
            </button>
          </motion.div>

          {mcd && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mp-card p-5 border-[var(--mp-amber)]/20">
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-4">Resultado Monte Carlo</h3>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {[
                  { l: "Gasto", v: `€${mcd.spent.toLocaleString("pt-PT")}` },
                  { l: "Ganho", v: `€${mcd.winnings.toLocaleString("pt-PT")}` },
                  { l: "Líquido", v: `${mcd.net >= 0 ? "+" : ""}€${mcd.net.toLocaleString("pt-PT")}`, color: mcd.net >= 0 ? "var(--mp-bull)" : "var(--mp-bear)" },
                  { l: "ROI simulado", v: `${mcd.roi.toFixed(2)}%`, color: mcd.roi >= 0 ? "var(--mp-bull)" : "var(--mp-bear)" },
                  { l: "Bilhetes premiados", v: `${mcd.hits} (${mcd.hitRate}%)` },
                  { l: "Jackpots ganhos", v: String(mcd.jackpotHits), color: mcd.jackpotHits > 0 ? "var(--mp-amber)" : undefined },
                ].map((s, i) => (
                  <div key={i} className="rounded-lg bg-[var(--mp-bg)]/50 p-2.5 text-xs">
                    <div className="text-[var(--mp-muted)] mb-0.5">{s.l}</div>
                    <div className="font-mono-n font-semibold" style={{ color: s.color }}>{s.v}</div>
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-[var(--mp-muted)]">Prémios por categoria:</div>
              <div className="grid grid-cols-4 gap-1 mt-1">
                {Object.entries(mcd.tierHits).filter(([,v]) => (v as number) > 0).map(([tier, hits]) => (
                  <div key={tier} className="rounded bg-[var(--mp-bg)]/50 px-1.5 py-1 text-center">
                    <div className="font-mono-n text-[10px] text-[var(--mp-amber)]">{tier}</div>
                    <div className="font-mono-n text-xs">{String(hits)}x</div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Analisar bilhete ─────────────────────────────────────────────────────────
function LotAnalisar() {
  const [mainInput, setMainInput] = useState("7 14 23 38 44");
  const [starsInput, setStarsInput] = useState("3 9");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function analyze() {
    const main = mainInput.trim().split(/[\s,]+/).map(Number).filter(n => n >= 1 && n <= 50);
    const stars = starsInput.trim().split(/[\s,]+/).map(Number).filter(n => n >= 1 && n <= 12);
    if (main.length !== 5) { setError("Precisa de exactamente 5 números principais (1–50)"); return; }
    if (stars.length !== 2) { setError("Precisa de exactamente 2 estrelas (1–12)"); return; }
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/lottery/euromillions/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ main, stars }),
      });
      const data = await res.json();
      setResult(data.analysis);
    } catch { setError("Erro ao analisar"); }
    setLoading(false);
  }

  const score = result?.qualityScore ?? 0;
  const scoreColor = score >= 70 ? "var(--mp-bull)" : score >= 40 ? "var(--mp-amber)" : "var(--mp-bear)";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mp-card p-5 border-[var(--mp-amber)]/20">
        <h3 className="text-xs font-semibold uppercase tracking-wider mb-4">Inserir Bilhete</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-[var(--mp-muted)] block mb-1">5 números principais (1–50)</label>
            <input
              value={mainInput}
              onChange={e => setMainInput(e.target.value)}
              className="w-full bg-[var(--mp-bg)] border border-[var(--mp-border)] rounded-lg px-3 py-2 text-sm font-mono-n focus:border-[var(--mp-amber)] outline-none"
              placeholder="ex: 7 14 23 38 44"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--mp-muted)] block mb-1">2 estrelas (1–12)</label>
            <input
              value={starsInput}
              onChange={e => setStarsInput(e.target.value)}
              className="w-full bg-[var(--mp-bg)] border border-[var(--mp-border)] rounded-lg px-3 py-2 text-sm font-mono-n focus:border-[var(--mp-amber)] outline-none"
              placeholder="ex: 3 9"
            />
          </div>
          {error && <div className="text-xs text-[var(--mp-bear)]">{error}</div>}
          <button onClick={analyze}
            className="w-full text-xs font-semibold py-2 rounded bg-[var(--mp-amber)] text-black hover:brightness-110 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" size={14} /> : <><Brain size={14} />Analisar Bilhete</>}
          </button>
        </div>

        <div className="mt-4 pt-4 border-t border-[var(--mp-border)] text-[10px] text-[var(--mp-muted)] space-y-1">
          <div>O score de qualidade (0–100) compara o bilhete com padrões observados em 1952 sorteios históricos.</div>
          <div>Score alto ≠ maior probabilidade de ganhar. Todos os bilhetes têm exactamente a mesma chance.</div>
        </div>
      </motion.div>

      {result && (
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="mp-card p-5 border-[var(--mp-amber)]/20">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-4">Análise do Bilhete</h3>

          {/* Ticket display */}
          <div className="flex items-center gap-1.5 flex-wrap mb-4 p-3 rounded-lg bg-[var(--mp-bg)]/60">
            {result.main.map((n: number) => <Ball key={n} n={n} />)}
            <span className="text-[var(--mp-muted)] mx-1">⭐</span>
            {result.stars.map((n: number) => <Ball key={n} n={n} star />)}
          </div>

          {/* Score ring */}
          <div className="flex items-center gap-4 mb-4">
            <div className="relative w-16 h-16 flex items-center justify-center">
              <svg className="absolute" width="64" height="64" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="28" fill="none" stroke="var(--mp-border)" strokeWidth="4" />
                <circle cx="32" cy="32" r="28" fill="none" stroke={scoreColor} strokeWidth="4"
                  strokeDasharray={`${score * 1.759} 176`} strokeLinecap="round"
                  transform="rotate(-90 32 32)" />
              </svg>
              <span className="font-mono-n text-sm font-bold" style={{ color: scoreColor }}>{score}</span>
            </div>
            <div>
              <div className="text-xs font-semibold" style={{ color: scoreColor }}>
                {score >= 70 ? "Padrão excelente" : score >= 40 ? "Padrão razoável" : "Padrão atípico"}
              </div>
              <div className="text-[10px] text-[var(--mp-muted)]">Score vs padrões históricos</div>
            </div>
          </div>

          {/* Details */}
          <div className="space-y-1.5 text-xs">
            {[
              { l: "Soma dos números", v: String(result.sum), good: result.sumInIdealRange, badge: result.sumInIdealRange ? "✓ ideal (88–165)" : "⚠ fora do intervalo típico" },
              { l: "Par/Ímpar", v: `${result.oddCount}Í + ${result.evenCount}P`, good: result.balancedOddEven, badge: result.balancedOddEven ? "✓ equilíbrio típico" : "⚠ distribuição incomum" },
              { l: "Pares consecutivos", v: String(result.consecutivePairs), good: result.consecutivePairs === 0, badge: result.consecutivePairs === 0 ? "✓ mais comum (65%)" : result.consecutivePairs === 1 ? "✓ comum (30%)" : "⚠ raro" },
              { l: "Par frequente incluído", v: result.hasFrequentPair ? "Sim" : "Não", good: result.hasFrequentPair },
              { l: "Frequência média (principais)", v: `${result.avgMainFreq} sorteios`, good: result.isHot },
            ].map((s, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-[var(--mp-bg)]/50 px-3 py-2">
                <span className="text-[var(--mp-muted)]">{s.l}</span>
                <div className="text-right">
                  <span className="font-mono-n">{s.v}</span>
                  {s.badge && <div className={`text-[9px] ${s.good ? "text-[var(--mp-bull)]" : "text-[var(--mp-amber)]"}`}>{s.badge}</div>}
                </div>
              </div>
            ))}
            {result.hotNumbersIncluded?.length > 0 && (
              <div className="flex items-center justify-between rounded-lg bg-[var(--mp-bg)]/50 px-3 py-2">
                <span className="text-[var(--mp-muted)]">Números quentes incluídos</span>
                <div className="flex gap-1">{result.hotNumbersIncluded.map((n: number) => <Ball key={n} n={n} mini hot />)}</div>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}

function Ball({ n, star, hot, cold, mini }: { n: number; star?: boolean; hot?: boolean; cold?: boolean; mini?: boolean }) {
  const size = mini ? "w-6 h-6 text-[10px]" : "w-7 h-7 text-xs";
  const color = star
    ? "bg-[var(--mp-amber)]/20 text-[var(--mp-amber)] border-[var(--mp-amber)]/40"
    : hot
    ? "bg-orange-500/20 text-orange-400 border-orange-500/40"
    : cold
    ? "bg-blue-500/20 text-blue-400 border-blue-500/40"
    : "bg-[var(--mp-cyan)]/15 text-[var(--mp-cyan)] border-[var(--mp-cyan)]/30";
  return (
    <span className={`inline-flex items-center justify-center ${size} rounded-full font-mono-n font-bold border ${color}`}>
      {n}
    </span>
  );
}

function DirBadge({ dir }: { dir: string }) {
  const map: any = {
    up: { c: "var(--mp-bull)", I: TrendingUp, t: "BULL" },
    down: { c: "var(--mp-bear)", I: TrendingDown, t: "BEAR" },
    flat: { c: "var(--mp-muted)", I: Minus, t: "FLAT" },
  };
  const { c, I, t } = map[dir];
  return (
    <div
      className="flex items-center justify-center w-14 h-14 rounded-xl shrink-0"
      style={{ background: `color-mix(in oklab, ${c} 15%, transparent)`, color: c }}
    >
      <div className="flex flex-col items-center">
        <I size={20} />
        <span className="text-[10px] font-bold font-mono-n mt-0.5">{t}</span>
      </div>
    </div>
  );
}

function Vote({ v }: { v: number }) {
  if (v > 0) return <TrendingUp size={13} className="text-[var(--mp-bull)]" />;
  if (v < 0) return <TrendingDown size={13} className="text-[var(--mp-bear)]" />;
  return <Minus size={13} className="text-[var(--mp-muted)]" />;
}

function Stat({
  label,
  value,
  good,
  bad,
  amber,
}: {
  label: string;
  value: string;
  good?: boolean;
  bad?: boolean;
  amber?: boolean;
}) {
  const color = good
    ? "var(--mp-bull)"
    : bad
    ? "var(--mp-bear)"
    : amber
    ? "var(--mp-amber)"
    : "var(--mp-text)";
  return (
    <div className="rounded-lg bg-[var(--mp-bg)]/50 p-3">
      <div className="text-[10px] uppercase tracking-wider text-[var(--mp-muted)] mb-1">{label}</div>
      <div className="font-mono-n text-lg font-semibold" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

// ─── Tracker helpers imported above ─────────────────────────────────────────
// loadTrackerRecords, saveTrackerRecord, resolveTrackerRecord from ../lib/tracker-client

// ─── RegimeBadge ─────────────────────────────────────────────────────────────
export function RegimeBadge({ regime, strength }: { regime: string; strength: string }) {
  const cfg: Record<string, { bg: string; text: string; label: string }> = {
    bull: { bg: "color-mix(in oklab, var(--mp-bull) 15%, transparent)", text: "var(--mp-bull)", label: "Mercado Alta" },
    bear: { bg: "color-mix(in oklab, var(--mp-bear) 15%, transparent)", text: "var(--mp-bear)", label: "Mercado Baixa" },
    sideways: { bg: "color-mix(in oklab, var(--mp-amber) 15%, transparent)", text: "var(--mp-amber)", label: "Mercado Lateral" },
  };
  const c = cfg[regime] ?? cfg["sideways"];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold font-mono-n uppercase tracking-wider border"
      style={{ background: c.bg, color: c.text, borderColor: `color-mix(in oklab, ${c.text} 40%, transparent)` }}
    >
      <BarChart2 size={10} />
      {c.label} · {strength === "strong" ? "Forte" : strength === "moderate" ? "Moderado" : "Fraco"}
    </span>
  );
}

// ─── ConfidencePanel — expandable breakdown ──────────────────────────────────
export function ConfidencePanel({ confidence, explained, pct }: { confidence: number; explained: any; pct: string }) {
  const [open, setOpen] = useState(false);
  const color = confidence >= 0.55 ? "var(--mp-bull)" : confidence >= 0.35 ? "var(--mp-amber)" : "var(--mp-bear)";
  const label = confidence >= 0.55 ? "Elevada" : confidence >= 0.35 ? "Média" : "Baixa";
  return (
    <div className="rounded-lg bg-[var(--mp-bg)]/50 p-3">
      <button
        className="w-full flex items-center justify-between gap-2 text-left"
        onClick={() => setOpen(v => !v)}
      >
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--mp-muted)] mb-1">Confiança</div>
          <div className="font-mono-n text-lg font-semibold flex items-center gap-2" style={{ color }}>
            {pct} · {label}
            <span className="text-[10px] text-[var(--mp-muted)] normal-case font-normal">({explained?.label ?? ""})</span>
          </div>
        </div>
        {open ? <ChevronUp size={14} className="text-[var(--mp-muted)] shrink-0" /> : <ChevronDown size={14} className="text-[var(--mp-muted)] shrink-0" />}
      </button>
      {open && explained?.breakdown && (
        <div className="mt-3 space-y-1.5 border-t border-[var(--mp-border)] pt-2">
          {explained.breakdown.map((b: any, i: number) => (
            <div key={i} className="flex items-start justify-between text-[11px] gap-2">
              <span className="text-[var(--mp-muted)]">{b.factor}</span>
              <span className="flex items-center gap-1.5 shrink-0">
                <span className="font-mono-n" style={{ color: b.impact.startsWith("+") ? "var(--mp-bull)" : b.impact.startsWith("−") ? "var(--mp-bear)" : "var(--mp-amber)" }}>{b.impact}</span>
                <span className="text-[var(--mp-muted)] italic text-[10px]">{b.note}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Market Tracker Panel ────────────────────────────────────────────────────
export function MarketTrackerPanel() {
  const [records, setRecords] = useState<any[]>([]);
  const [resolving, setResolving] = useState<string | null>(null);
  useEffect(() => {
    setRecords(loadTrackerRecords().filter((r: any) => r.kind === "market"));
  }, []);
  
  const refresh = () => setRecords(loadTrackerRecords().filter((r: any) => r.kind === "market"));
  
  const resolve = (id: string, outcome: string) => {
    resolveTrackerRecord(id, outcome);
    setResolving(null);
    refresh();
  };
  
  const pending = records.filter(r => r.correct === undefined);
  const resolved = records.filter(r => r.correct !== undefined);
  const correct = resolved.filter(r => r.correct).length;
  const accuracy = resolved.length > 0 ? (correct / resolved.length * 100).toFixed(1) : null;

  return (
    <div className="space-y-3">
      {/* Stats bar */}
      {resolved.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-[var(--mp-muted)] bg-[var(--mp-bg)]/50 rounded-lg px-3 py-2">
          <span className="text-[var(--mp-text)]">{records.length} picks</span>
          <span className="text-[var(--mp-bull)]">{correct} ✓</span>
          <span className="text-[var(--mp-bear)]">{resolved.length - correct} ✗</span>
          {accuracy && <span className="text-[var(--mp-cyan)] font-bold">{accuracy}% precisão</span>}
        </div>
      )}
      {records.length === 0 && (
        <p className="text-[var(--mp-muted)] text-sm text-center py-4">Nenhuma previsão guardada ainda.<br/>Carrega em "Guardar Pick" na previsão.</p>
      )}
      {/* Pending */}
      {pending.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--mp-muted)] mb-2 flex items-center gap-1"><Clock size={10}/> Por resolver ({pending.length})</div>
          {pending.map((r: any) => (
            <div key={r.id} className="rounded-lg border border-[var(--mp-border)] p-3 mb-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-mono-n font-bold text-sm">{r.label}</span>
                <span className="text-[10px] text-[var(--mp-muted)]">{new Date(r.createdAt).toLocaleDateString("pt-BR")}</span>
              </div>
              <div className="flex items-center gap-2 text-xs mb-2">
                <span style={{ color: r.predictedOutcome === "up" ? "var(--mp-bull)" : r.predictedOutcome === "down" ? "var(--mp-bear)" : "var(--mp-muted)" }}>
                  {r.predictedOutcome === "up" ? "↑ Alta" : r.predictedOutcome === "down" ? "↓ Baixa" : "→ Flat"}
                </span>
                <span className="text-[var(--mp-muted)]">·</span>
                <span className="text-[var(--mp-amber)]">{(r.confidence * 100).toFixed(0)}% conf.</span>
              </div>
              {resolving === r.id ? (
                <div className="flex gap-2">
                  <button onClick={() => resolve(r.id, "up")} className="flex-1 py-1 rounded text-xs bg-[color-mix(in_oklab,var(--mp-bull)_15%,transparent)] text-[var(--mp-bull)] border border-[color-mix(in_oklab,var(--mp-bull)_40%,transparent)] hover:bg-[color-mix(in_oklab,var(--mp-bull)_25%,transparent)]">↑ Alta</button>
                  <button onClick={() => resolve(r.id, "flat")} className="flex-1 py-1 rounded text-xs bg-[color-mix(in_oklab,var(--mp-muted)_15%,transparent)] text-[var(--mp-muted)] border border-[var(--mp-border)] hover:bg-[color-mix(in_oklab,var(--mp-muted)_25%,transparent)]">→ Flat</button>
                  <button onClick={() => resolve(r.id, "down")} className="flex-1 py-1 rounded text-xs bg-[color-mix(in_oklab,var(--mp-bear)_15%,transparent)] text-[var(--mp-bear)] border border-[color-mix(in_oklab,var(--mp-bear)_40%,transparent)] hover:bg-[color-mix(in_oklab,var(--mp-bear)_25%,transparent)]">↓ Baixa</button>
                  <button onClick={() => setResolving(null)} className="px-2 py-1 rounded text-xs border border-[var(--mp-border)] text-[var(--mp-muted)]"><X size={10}/></button>
                </div>
              ) : (
                <button onClick={() => setResolving(r.id)} className="text-[10px] underline text-[var(--mp-cyan)]">Resolver resultado</button>
              )}
            </div>
          ))}
        </div>
      )}
      {/* Resolved */}
      {resolved.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--mp-muted)] mb-2 flex items-center gap-1"><CheckCircle2 size={10}/> Resolvidos</div>
          {resolved.slice(-10).reverse().map((r: any) => (
            <div key={r.id} className="rounded-lg border border-[var(--mp-border)] p-3 mb-2 flex items-center justify-between">
              <div>
                <div className="font-mono-n font-bold text-sm">{r.label}</div>
                <div className="text-[10px] text-[var(--mp-muted)]">{r.predictedOutcome} → {r.actualOutcome} · {new Date(r.createdAt).toLocaleDateString("pt-BR")}</div>
              </div>
              {r.correct ? <CheckCircle2 size={16} className="text-[var(--mp-bull)] shrink-0" /> : <XCircle size={16} className="text-[var(--mp-bear)] shrink-0" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Save Market Pick Button ──────────────────────────────────────────────────
function SaveMarketPickButton({ pred, symbol }: { pred: any; symbol: string }) {
  const [saved, setSaved] = useState(false);

  const save = () => {
    const id = `market_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    saveTrackerRecord({
      id,
      kind: "market",
      createdAt: new Date().toISOString(),
      label: symbol,
      predictedOutcome: pred.direction, // "up" | "down" | "flat"
      confidence: pred.confidence,
      probUp: pred.probabilityUp,
      regime: pred.regime?.regime,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <button
      onClick={save}
      disabled={saved}
      className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border transition ${
        saved
          ? "border-[var(--mp-bull)] text-[var(--mp-bull)] bg-[color-mix(in_oklab,var(--mp-bull)_10%,transparent)]"
          : "border-[var(--mp-border)] text-[var(--mp-muted)] hover:border-[var(--mp-cyan)] hover:text-[var(--mp-cyan)]"
      }`}
    >
      {saved ? <BookmarkCheck size={13}/> : <Bookmark size={13}/>}
      {saved ? "Guardado!" : "Guardar Pick"}
    </button>
  );
}

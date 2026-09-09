import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Search, TrendingUp, TrendingDown, Minus, Activity, AlertTriangle, Dice5, RefreshCw, Loader2, LineChart, Brain, Download, Share, X, ChevronDown, ChevronUp, Bookmark, BookmarkCheck, BarChart2, History, CheckCircle2, XCircle, Clock } from "lucide-react";
import { LineChart as LineIcon, Trophy as TrophyIcon } from "lucide-react";
import { api } from "../lib/api";
import { PriceChart, EquityChart } from "../components/price-chart";
import { SportsView } from "./sports";
import { XauusdView } from "./xauusd";
import { loadTrackerRecords, saveTrackerRecord, resolveTrackerRecord } from "../lib/tracker-client";

const PRESETS = ["AAPL", "MSFT", "TSLA", "AMZN", "BTC/USD", "ETH/USD", "EUR/USD"];
type View = "markets" | "sports" | "lottery" | "xauusd";

export default function Index() {
  const [view, setView] = useState<View>("markets");
  return (
    <div className="min-h-screen w-full px-4 py-6 md:px-8 md:py-8 max-w-[1400px] mx-auto">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="flex items-center gap-2 mb-6 flex-wrap">
        <h1 className="font-display text-xl md:text-2xl font-extrabold tracking-tight flex items-center gap-2 mr-1 md:mr-3"><span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--mp-cyan)]/15 text-[var(--mp-cyan)]"><Activity size={18} /></span>Predictor</h1>
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          <NavTab active={view === "markets"} onClick={() => setView("markets")} icon={<LineIcon size={14} />} label="Mercados" />
          <NavTab active={view === "xauusd"} onClick={() => setView("xauusd")} icon={<TrendingUp size={14} />} label="XAUUSD" />
          <NavTab active={view === "sports"} onClick={() => setView("sports")} icon={<TrophyIcon size={14} />} label="Esportes" />
          <NavTab active={view === "lottery"} onClick={() => setView("lottery")} icon={<Dice5 size={14} />} label="Loteria" />
        </div>
        <div className="ml-auto"><InstallButton /></div>
      </motion.div>
      {view === "markets" && <MarketsView />}
      {view === "xauusd" && <XauusdView />}
      {view === "sports" && <SportsView />}
      {view === "lottery" && <LotteryStandalone />}
      <footer className="text-center text-xs text-[var(--mp-muted)] mt-8">Protótipo educativo. Não é aconselhamento financeiro nem de apostas. Dados: Twelve Data, football-data.co.uk, TheSportsDB, martj42/international_results.</footer>
    </div>
  );
}

function NavTab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) { return <button onClick={onClick} className={`flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg border transition ${active ? "border-[var(--mp-cyan)] text-[var(--mp-cyan)] bg-[var(--mp-cyan)]/10" : "border-[var(--mp-border)] text-[var(--mp-muted)] hover:text-white"}`}>{icon} {label}</button>; }

// Existing application helpers and MarketsView/LotteryStandalone remain unchanged below.

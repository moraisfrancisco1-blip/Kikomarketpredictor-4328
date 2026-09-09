import { Activity, Brain, ShieldCheck, Target, TrendingUp, TrendingDown } from "lucide-react";

const metrics = [
  ["RSI", "63.2"], ["ADX", "27.4"], ["ATR", "1.84"], ["Spread", "0.12"],
];

export function XauusdView() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-[var(--mp-muted)]">Scalping Command Center</p>
          <h2 className="font-display text-2xl font-extrabold">XAUUSD <span className="text-[var(--mp-bull)]">LIVE</span></h2>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--mp-bull)]"><span className="h-2 w-2 rounded-full bg-[var(--mp-bull)]" /> Paper Trading</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <section className="mp-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-5"><div className="flex items-center gap-2"><Activity size={16} className="text-[var(--mp-cyan)]" /><span className="font-display font-semibold">Current Signal</span></div><span className="text-xs text-[var(--mp-muted)]">M1 / M15 confirmation</span></div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric label="SIGNAL" value="LONG" icon={<TrendingUp size={17} />} accent="bull" />
            <Metric label="ML CONFIDENCE" value="78.4%" icon={<Brain size={17} />} />
            <Metric label="R:R" value="1 : 1.60" icon={<Target size={17} />} />
            <Metric label="RISK" value="0.50%" icon={<ShieldCheck size={17} />} />
          </div>
          <div className="grid grid-cols-3 gap-3 mt-4 text-sm font-mono-n">
            <Price label="ENTRY" value="4356.72" /><Price label="STOP LOSS" value="4354.90" /><Price label="TAKE PROFIT" value="4359.80" />
          </div>
        </section>

        <section className="mp-card p-5">
          <h3 className="font-display font-semibold mb-4">Market State</h3>
          <div className="grid grid-cols-2 gap-3">{metrics.map(([label,value]) => <div key={label} className="rounded-lg border border-[var(--mp-border)] p-3"><div className="text-[10px] text-[var(--mp-muted)]">{label}</div><div className="font-mono-n mt-1">{value}</div></div>)}</div>
          <div className="mt-4 flex justify-between text-xs"><span className="text-[var(--mp-muted)]">Trend</span><span className="text-[var(--mp-bull)]">BULLISH</span></div>
        </section>
      </div>

      <section className="mp-card p-5">
        <div className="flex items-center gap-2 mb-4"><Brain size={16} className="text-[var(--mp-cyan)]" /><h3 className="font-display font-semibold">Why this trade?</h3></div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">{[["ML","+0.74"],["Trend","+0.67"],["Momentum","+0.81"],["Structure","+0.58"],["Volatility","+0.52"]].map(([a,b]) => <div key={a} className="p-3 rounded-lg bg-[var(--mp-surface)] border border-[var(--mp-border)]"><div className="text-xs text-[var(--mp-muted)]">{a}</div><div className="font-mono-n text-lg mt-1">{b}</div></div>)}</div>
      </section>

      <section className="mp-card p-5">
        <h3 className="font-display font-semibold mb-4">Today</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4"><Stat label="Trades" value="17" /><Stat label="Wins" value="11" /><Stat label="Losses" value="6" /><Stat label="Win Rate" value="64.7%" /><Stat label="P&L" value="+€84.20" /></div>
      </section>
    </div>
  );
}

function Metric({label,value,icon,accent}:{label:string;value:string;icon:React.ReactNode;accent?:"bull"}) { return <div className="rounded-lg border border-[var(--mp-border)] p-4"><div className="flex items-center gap-2 text-xs text-[var(--mp-muted)]">{icon}{label}</div><div className={`font-display text-xl font-bold mt-2 ${accent === "bull" ? "text-[var(--mp-bull)]" : ""}`}>{value}</div></div>; }
function Price({label,value}:{label:string;value:string}) { return <div className="rounded-lg border border-[var(--mp-border)] p-3"><div className="text-[10px] text-[var(--mp-muted)]">{label}</div><div className="mt-1">{value}</div></div>; }
function Stat({label,value}:{label:string;value:string}) { return <div><div className="text-xs text-[var(--mp-muted)]">{label}</div><div className="font-mono-n text-lg mt-1">{value}</div></div>; }

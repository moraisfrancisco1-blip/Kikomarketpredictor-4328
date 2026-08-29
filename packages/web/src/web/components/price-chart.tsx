import { useMemo } from "react";

type Candle = { date: string; close: number; high: number; low: number };

export function PriceChart({
  candles,
  height = 280,
}: {
  candles: Candle[];
  height?: number;
}) {
  const data = candles.slice(-180);
  const { path, area, min, max, up } = useMemo(() => {
    if (data.length < 2)
      return { path: "", area: "", min: 0, max: 0, up: true };
    const closes = data.map((d) => d.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const w = 1000;
    const h = height;
    const pad = 8;
    const span = max - min || 1;
    const pts = closes.map((c, i) => {
      const x = (i / (closes.length - 1)) * w;
      const y = pad + (1 - (c - min) / span) * (h - pad * 2);
      return [x, y];
    });
    const path = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    const area = `${path} L${w} ${h} L0 ${h} Z`;
    const up = closes[closes.length - 1] >= closes[0];
    return { path, area, min, max, up };
  }, [data, height]);

  const color = up ? "#34d399" : "#f87171";

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 1000 ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
      >
        <defs>
          <linearGradient id="mp-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line
            key={g}
            x1="0"
            x2="1000"
            y1={g * height}
            y2={g * height}
            stroke="#1f2937"
            strokeWidth="1"
          />
        ))}
        <path d={area} fill="url(#mp-area)" />
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="pointer-events-none absolute right-1 top-1 text-[10px] font-mono-n text-[var(--mp-muted)]">
        {max.toFixed(2)}
      </div>
      <div className="pointer-events-none absolute right-1 bottom-1 text-[10px] font-mono-n text-[var(--mp-muted)]">
        {min.toFixed(2)}
      </div>
    </div>
  );
}

export function EquityChart({
  curve,
  height = 220,
}: {
  curve: { date: string; strategy: number; buyHold: number }[];
  height?: number;
}) {
  const { stratPath, bhPath } = useMemo(() => {
    if (curve.length < 2) return { stratPath: "", bhPath: "" };
    const all = curve.flatMap((c) => [c.strategy, c.buyHold]);
    const min = Math.min(...all);
    const max = Math.max(...all);
    const span = max - min || 1;
    const w = 1000;
    const h = height;
    const pad = 8;
    const toPath = (key: "strategy" | "buyHold") =>
      curve
        .map((c, i) => {
          const x = (i / (curve.length - 1)) * w;
          const y = pad + (1 - (c[key] - min) / span) * (h - pad * 2);
          return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join(" ");
    return { stratPath: toPath("strategy"), bhPath: toPath("buyHold") };
  }, [curve, height]);

  return (
    <svg
      viewBox={`0 0 1000 ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
    >
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1="0" x2="1000" y1={g * height} y2={g * height} stroke="#1f2937" strokeWidth="1" />
      ))}
      <path d={bhPath} fill="none" stroke="#64748b" strokeWidth="1.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      <path d={stratPath} fill="none" stroke="#22d3ee" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

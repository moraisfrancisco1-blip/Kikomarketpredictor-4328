"""Event-driven, bar-based backtester for the XAUUSD scalp engine.

Execution model: signal at bar close, entry at next bar open with configurable
spread/slippage, then stop/target checked on subsequent bars. If SL and TP are
both touched in one candle, SL wins (conservative assumption).
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
import numpy as np
import pandas as pd
from feature_builder import build_features, row_to_features
from xauusd_scalp_engine import ScalpConfig, evaluate


@dataclass
class BacktestConfig:
    initial_equity: float = 10_000.0
    risk_pct: float = 0.50
    rr: float = 1.60
    point_size: float = 0.01
    slippage_points: float = 2.0
    commission_per_trade: float = 0.0


@dataclass
class Trade:
    entry_time: str
    exit_time: str
    side: str
    entry: float
    stop: float
    target: float
    exit: float
    r_multiple: float
    pnl: float
    reason: str


def _metrics(trades: list[Trade], initial_equity: float) -> dict:
    if not trades:
        return {"trades": 0, "winRate": 0.0, "profitFactor": 0.0, "netPnl": 0.0,
                "returnPct": 0.0, "maxDrawdownPct": 0.0, "avgR": 0.0}
    pnl = np.array([t.pnl for t in trades], dtype=float)
    r = np.array([t.r_multiple for t in trades], dtype=float)
    gross_win = pnl[pnl > 0].sum()
    gross_loss = -pnl[pnl < 0].sum()
    equity = initial_equity + np.cumsum(pnl)
    peak = np.maximum.accumulate(np.r_[initial_equity, equity])
    dd = (np.r_[initial_equity, equity] - peak) / peak
    return {
        "trades": len(trades),
        "wins": int((pnl > 0).sum()),
        "losses": int((pnl < 0).sum()),
        "winRate": round(float((pnl > 0).mean() * 100), 2),
        "profitFactor": round(float(gross_win / gross_loss), 3) if gross_loss else float("inf"),
        "netPnl": round(float(pnl.sum()), 2),
        "returnPct": round(float(pnl.sum() / initial_equity * 100), 2),
        "maxDrawdownPct": round(float(-dd.min() * 100), 2),
        "avgR": round(float(r.mean()), 3),
    }


def run_backtest(bars: pd.DataFrame, cfg: BacktestConfig = BacktestConfig(), scalp_cfg: ScalpConfig | None = None) -> dict:
    x = build_features(bars).dropna(subset=["ema50", "atr", "adx14", "volume_ratio"]).reset_index(drop=True)
    scalp_cfg = scalp_cfg or ScalpConfig(risk_per_trade_pct=cfg.risk_pct, rr=cfg.rr)
    trades: list[Trade] = []
    i = 0
    equity = cfg.initial_equity

    while i < len(x) - 2:
        row = x.iloc[i]
        decision = evaluate(row_to_features(row), scalp_cfg)
        if decision.signal == "NO_TRADE":
            i += 1
            continue

        entry_bar = x.iloc[i + 1]
        spread = float(entry_bar.get("spread", 0.0)) * cfg.point_size
        slip = cfg.slippage_points * cfg.point_size
        if decision.signal == "LONG":
            entry = float(entry_bar.open) + spread + slip
            stop, target = float(decision.stop), float(decision.target)
        else:
            entry = float(entry_bar.open) - spread - slip
            stop, target = float(decision.stop), float(decision.target)

        risk_distance = abs(entry - stop)
        if risk_distance <= 0:
            i += 1
            continue
        risk_cash = equity * cfg.risk_pct / 100.0
        qty = risk_cash / risk_distance
        exit_price = None
        exit_reason = "end_of_data"
        exit_time = x.iloc[-1].time
        j = i + 1
        while j < len(x):
            b = x.iloc[j]
            if decision.signal == "LONG":
                hit_sl = b.low <= stop
                hit_tp = b.high >= target
                if hit_sl:
                    exit_price, exit_reason = stop, "stop"
                elif hit_tp:
                    exit_price, exit_reason = target, "target"
            else:
                hit_sl = b.high >= stop
                hit_tp = b.low <= target
                if hit_sl:
                    exit_price, exit_reason = stop, "stop"
                elif hit_tp:
                    exit_price, exit_reason = target, "target"
            if exit_price is not None:
                exit_time = b.time
                break
            j += 1

        if exit_price is None:
            exit_price = float(x.iloc[-1].close)
        gross = (exit_price - entry) * qty if decision.signal == "LONG" else (entry - exit_price) * qty
        pnl = gross - cfg.commission_per_trade
        r_mult = pnl / risk_cash if risk_cash else 0.0
        trades.append(Trade(str(entry_bar.time), str(exit_time), decision.signal, entry, stop, target,
                            float(exit_price), float(r_mult), float(pnl), exit_reason))
        equity += pnl
        i = max(j + 1, i + 1)

    result = _metrics(trades, cfg.initial_equity)
    result["finalEquity"] = round(float(equity), 2)
    result["tradesDetail"] = [asdict(t) for t in trades]
    return result


if __name__ == "__main__":
    from mt5_adapter import load_mt5_bars
    bars = load_mt5_bars("XAUUSD", "M1", 50_000)
    print(run_backtest(bars)["metrics"] if "metrics" in run_backtest(bars) else run_backtest(bars))

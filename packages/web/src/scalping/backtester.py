"""Event-driven, bar-based backtester for the XAUUSD scalp engine.

Signal at bar close -> entry at next bar open. If bid/ask OHLC are present,
longs enter on ask and exit on bid; shorts enter on bid and exit on ask.
If SL and TP are both touched in one candle, SL wins conservatively.
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
        return {"trades": 0, "wins": 0, "losses": 0, "winRate": 0.0, "profitFactor": 0.0,
                "netPnl": 0.0, "returnPct": 0.0, "maxDrawdownPct": 0.0, "avgR": 0.0}
    pnl = np.array([t.pnl for t in trades], dtype=float)
    r = np.array([t.r_multiple for t in trades], dtype=float)
    gross_win = pnl[pnl > 0].sum()
    gross_loss = -pnl[pnl < 0].sum()
    equity = initial_equity + np.cumsum(pnl)
    peak = np.maximum.accumulate(np.r_[initial_equity, equity])
    dd = (np.r_[initial_equity, equity] - peak) / peak
    return {
        "trades": len(trades), "wins": int((pnl > 0).sum()), "losses": int((pnl < 0).sum()),
        "winRate": round(float((pnl > 0).mean() * 100), 2),
        "profitFactor": round(float(gross_win / gross_loss), 3) if gross_loss else float("inf"),
        "netPnl": round(float(pnl.sum()), 2), "returnPct": round(float(pnl.sum() / initial_equity * 100), 2),
        "maxDrawdownPct": round(float(-dd.min() * 100), 2), "avgR": round(float(r.mean()), 3),
    }


def run_backtest(
    bars: pd.DataFrame,
    cfg: BacktestConfig = BacktestConfig(),
    scalp_cfg: ScalpConfig | None = None,
    ml_probabilities: pd.Series | None = None,
) -> dict:
    """Run the strategy with optional externally generated, leak-free ML probabilities."""
    x = build_features(bars).dropna(subset=["ema50", "atr", "adx14", "volume_ratio"]).reset_index(drop=True)
    if ml_probabilities is not None:
        probs = pd.Series(ml_probabilities).reset_index(drop=True)
        if len(probs) != len(x):
            raise ValueError("ml_probabilities must align with the feature rows after preprocessing")
        x["ml_prob_up"] = probs.astype(float).clip(0.0, 1.0)
    scalp_cfg = scalp_cfg or ScalpConfig(risk_per_trade_pct=cfg.risk_pct, rr=cfg.rr)
    trades: list[Trade] = []
    i, equity = 0, cfg.initial_equity

    while i < len(x) - 2:
        decision = evaluate(row_to_features(x.iloc[i], float(x.iloc[i].get("ml_prob_up", 0.50))), scalp_cfg)
        if decision.signal == "NO_TRADE":
            i += 1
            continue

        entry_bar = x.iloc[i + 1]
        slip = cfg.slippage_points * cfg.point_size
        has_ask = all(c in entry_bar.index for c in ("ask_open", "ask_high", "ask_low"))
        if decision.signal == "LONG":
            entry = float(entry_bar.ask_open if has_ask else entry_bar.open) + slip
        else:
            entry = float(entry_bar.open) - slip

        stop, target = float(decision.stop), float(decision.target)
        risk_distance = abs(entry - stop)
        if risk_distance <= 0:
            i += 1
            continue
        risk_cash = equity * cfg.risk_pct / 100.0
        qty = risk_cash / risk_distance
        exit_price, exit_reason, exit_time = None, "end_of_data", x.iloc[-1].time
        j = i + 1
        while j < len(x):
            b = x.iloc[j]
            if decision.signal == "LONG":
                # Long exits are executed against bid prices.
                low = float(b.low)
                high = float(b.high)
                if low <= stop:
                    exit_price, exit_reason = stop, "stop"
                elif high >= target:
                    exit_price, exit_reason = target, "target"
            else:
                # Short exits are executed against ask prices when available.
                low = float(b.ask_low if "ask_low" in b.index else b.low)
                high = float(b.ask_high if "ask_high" in b.index else b.high)
                if high >= stop:
                    exit_price, exit_reason = stop, "stop"
                elif low <= target:
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
    result = run_backtest(load_mt5_bars("XAUUSD", "M1", 50_000))
    print({k: v for k, v in result.items() if k != "tradesDetail"})

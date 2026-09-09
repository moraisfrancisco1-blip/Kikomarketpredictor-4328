import numpy as np
import pandas as pd
from backtester import run_backtest


def test_backtester_returns_metrics_without_lookahead_crash():
    n = 600
    t = pd.date_range("2026-01-05", periods=n, freq="min", tz="UTC")
    base = 4300 + np.arange(n) * 0.04 + np.sin(np.arange(n) / 7) * 0.8
    df = pd.DataFrame({
        "time": t,
        "open": base,
        "high": base + 0.35,
        "low": base - 0.35,
        "close": base + 0.08,
        "tick_volume": np.full(n, 1000),
        "spread": np.full(n, 30),
    })
    result = run_backtest(df)
    assert "trades" in result
    assert "maxDrawdownPct" in result
    assert result["trades"] >= 0

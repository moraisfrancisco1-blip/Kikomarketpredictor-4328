"""Run the first reproducible XAUUSD research backtest.

Usage:
  python run_xauusd_backtest.py /path/to/dukascopy_dataset

The runner compares the exact same strategy with ML disabled (0.50) and with
walk-forward XGBoost probabilities. No future labels are exposed to the model.
"""
from __future__ import annotations
import json
import sys
from feature_builder import build_features
from dukascopy_loader import load_xauusd_m1
from xau_ml_walkforward import walk_forward_probabilities, WalkForwardConfig
from backtester import run_backtest, BacktestConfig


def main(root: str) -> None:
    bars = load_xauusd_m1(root, start="2024-01-01")
    prepared = build_features(bars).dropna(subset=["ema50", "atr", "adx14", "volume_ratio"]).reset_index(drop=True)
    ml = walk_forward_probabilities(prepared, WalkForwardConfig())

    cfg = BacktestConfig(initial_equity=10_000.0, risk_pct=0.50, rr=1.60, point_size=0.01, slippage_points=2.0)
    technical = run_backtest(prepared, cfg=cfg)
    hybrid = run_backtest(prepared, cfg=cfg, ml_probabilities=ml)

    result = {
        "dataset": {"rows": len(prepared), "start": str(prepared.time.iloc[0]), "end": str(prepared.time.iloc[-1])},
        "technicalOnly": {k: v for k, v in technical.items() if k != "tradesDetail"},
        "technicalPlusWalkForwardXGBoost": {k: v for k, v in hybrid.items() if k != "tradesDetail"},
        "ml": {"meanProbUp": float(ml.mean()), "signalsAbove55": int((ml > 0.55).sum()), "signalsBelow45": int((ml < 0.45).sum())},
    }
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python run_xauusd_backtest.py /path/to/dukascopy_dataset")
    main(sys.argv[1])

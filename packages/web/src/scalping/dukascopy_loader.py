"""Load the public Dukascopy-style monthly XAUUSD M1 bid/ask CSV dataset.

Expected layout:
  <root>/xauusd/bid/m1/xauusd_bid_m1_YYYY_MM.csv
  <root>/xauusd/ask/m1/xauusd_ask_m1_YYYY_MM.csv

The loader keeps bid OHLC for strategy features and preserves ask close/open
for execution-aware spread modelling.
"""
from __future__ import annotations
from pathlib import Path
import pandas as pd


def load_xauusd_m1(root: str | Path, start: str = "2024-01-01", end: str | None = None) -> pd.DataFrame:
    root = Path(root)
    bid_files = sorted((root / "xauusd" / "bid" / "m1").glob("xauusd_bid_m1_*.csv"))
    ask_files = sorted((root / "xauusd" / "ask" / "m1").glob("xauusd_ask_m1_*.csv"))
    if not bid_files or not ask_files:
        raise FileNotFoundError("Dukascopy XAUUSD bid/ask M1 files were not found")

    bid = pd.concat((pd.read_csv(p) for p in bid_files), ignore_index=True)
    ask = pd.concat((pd.read_csv(p) for p in ask_files), ignore_index=True)
    bid["time"] = pd.to_datetime(bid["timestamp"], unit="ms", utc=True)
    ask["time"] = pd.to_datetime(ask["timestamp"], unit="ms", utc=True)
    bid = bid.rename(columns={"open": "open", "high": "high", "low": "low", "close": "close"})
    ask = ask.rename(columns={"open": "ask_open", "high": "ask_high", "low": "ask_low", "close": "ask_close"})
    x = bid.merge(ask[["timestamp", "ask_open", "ask_high", "ask_low", "ask_close"]], on="timestamp", how="inner")
    x["time"] = pd.to_datetime(x["timestamp"], unit="ms", utc=True)
    x = x.sort_values("time").drop_duplicates("time").reset_index(drop=True)
    x = x[(x["time"] >= pd.Timestamp(start, tz="UTC"))]
    if end:
        x = x[x["time"] < pd.Timestamp(end, tz="UTC")]
    x["tick_volume"] = 1.0
    x["spread"] = (x["ask_close"] - x["close"]) / 0.01
    return x[["time", "open", "high", "low", "close", "tick_volume", "spread", "ask_open", "ask_high", "ask_low", "ask_close"]].reset_index(drop=True)

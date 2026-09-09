"""Read-only MetaTrader 5 adapter for XAUUSD."""
from __future__ import annotations
from datetime import datetime, timezone
import pandas as pd


def load_mt5_bars(symbol: str = "XAUUSD", timeframe: str = "M1", count: int = 50000) -> pd.DataFrame:
    import MetaTrader5 as mt5
    tf = {"M1": mt5.TIMEFRAME_M1, "M5": mt5.TIMEFRAME_M5, "M15": mt5.TIMEFRAME_M15}[timeframe.upper()]
    if not mt5.initialize():
        raise RuntimeError(f"MT5 initialize failed: {mt5.last_error()}")
    try:
        if not mt5.symbol_select(symbol, True):
            raise RuntimeError(f"Could not select symbol {symbol}: {mt5.last_error()}")
        rates = mt5.copy_rates_from_pos(symbol, tf, 0, count)
        if rates is None or len(rates) == 0:
            raise RuntimeError(f"No {timeframe} data for {symbol}: {mt5.last_error()}")
        df = pd.DataFrame(rates)
        df["time"] = pd.to_datetime(df["time"], unit="s", utc=True)
        return df.sort_values("time").drop_duplicates("time").reset_index(drop=True)
    finally:
        mt5.shutdown()


def latest_tick(symbol: str = "XAUUSD") -> dict:
    import MetaTrader5 as mt5
    if not mt5.initialize():
        raise RuntimeError(f"MT5 initialize failed: {mt5.last_error()}")
    try:
        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            raise RuntimeError(f"No tick for {symbol}: {mt5.last_error()}")
        return {
            "time": datetime.fromtimestamp(tick.time, tz=timezone.utc).isoformat(),
            "bid": float(tick.bid), "ask": float(tick.ask),
            "spread": float(tick.ask - tick.bid),
        }
    finally:
        mt5.shutdown()

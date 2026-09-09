"""Leak-free feature construction for XAUUSD M1/M5 bars."""
from __future__ import annotations
import numpy as np
import pandas as pd
from xauusd_scalp_engine import ScalpFeatures


def _rsi(close: pd.Series, period: int) -> pd.Series:
    delta = close.diff()
    up = delta.clip(lower=0).ewm(alpha=1 / period, adjust=False).mean()
    down = (-delta.clip(upper=0)).ewm(alpha=1 / period, adjust=False).mean()
    rs = up / down.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(50.0)


def _atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    prev = df["close"].shift(1)
    tr = pd.concat([
        df["high"] - df["low"],
        (df["high"] - prev).abs(),
        (df["low"] - prev).abs(),
    ], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / period, adjust=False).mean()


def _adx(df: pd.DataFrame, period: int = 14) -> pd.Series:
    up = df["high"].diff()
    down = -df["low"].diff()
    plus_dm = up.where((up > down) & (up > 0), 0.0)
    minus_dm = down.where((down > up) & (down > 0), 0.0)
    atr = _atr(df, period).replace(0, np.nan)
    plus_di = 100 * plus_dm.ewm(alpha=1 / period, adjust=False).mean() / atr
    minus_di = 100 * minus_dm.ewm(alpha=1 / period, adjust=False).mean() / atr
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    return dx.ewm(alpha=1 / period, adjust=False).mean().fillna(0.0)


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Build features using only current/past information at each bar."""
    x = df.copy().sort_values("time").reset_index(drop=True)
    for c in ("open", "high", "low", "close", "tick_volume"):
        x[c] = pd.to_numeric(x[c], errors="coerce")

    x["ema9"] = x.close.ewm(span=9, adjust=False).mean()
    x["ema21"] = x.close.ewm(span=21, adjust=False).mean()
    x["ema50"] = x.close.ewm(span=50, adjust=False).mean()
    x["rsi7"] = _rsi(x.close, 7)
    x["rsi14"] = _rsi(x.close, 14)
    x["atr"] = _atr(x, 14)
    x["atr_pct"] = x.atr / x.close * 100
    x["adx14"] = _adx(x, 14)

    typical = (x.high + x.low + x.close) / 3
    session = x.time.dt.floor("D")
    pv = typical * x.tick_volume
    x["vwap"] = pv.groupby(session).cumsum() / x.tick_volume.groupby(session).cumsum().replace(0, np.nan)
    x["vwap_distance_pct"] = (x.close / x.vwap - 1) * 100

    x["momentum"] = ((x.close - x.close.shift(3)) / x.atr.replace(0, np.nan)).clip(-1, 1).fillna(0)
    hh = x.high.shift(1).rolling(20).max()
    ll = x.low.shift(1).rolling(20).min()
    width = (hh - ll).replace(0, np.nan)
    x["structure"] = (((x.close - (hh + ll) / 2) / width) * 2).clip(-1, 1).fillna(0)
    x["volume_ratio"] = x.tick_volume / x.tick_volume.shift(1).rolling(20).mean().replace(0, np.nan)

    # M15 trend is computed from completed M15 closes and shifted before joining.
    m15 = x.set_index("time")["close"].resample("15min", label="right", closed="right").last().dropna()
    m15_ema = m15.ewm(span=20, adjust=False).mean()
    m15_trend = ((m15_ema - m15_ema.shift(3)) / m15.replace(0, np.nan) * 10000).clip(-1, 1)
    m15_map = m15_trend.shift(1).reindex(x.time, method="ffill").fillna(0.0).to_numpy()
    x["m15_trend"] = m15_map

    # MT5 spread is in broker points. Keep it unchanged for the engine.
    x["spread_points"] = x.get("spread", pd.Series(0.0, index=x.index)).fillna(0.0)
    x["ml_prob_up"] = 0.50
    return x


def row_to_features(row: pd.Series, ml_prob_up: float = 0.50) -> ScalpFeatures:
    return ScalpFeatures(
        price=float(row.close), ema9=float(row.ema9), ema21=float(row.ema21), ema50=float(row.ema50),
        rsi7=float(row.rsi7), rsi14=float(row.rsi14), atr_pct=float(row.atr_pct), adx14=float(row.adx14),
        vwap_distance_pct=float(row.vwap_distance_pct), momentum=float(row.momentum), structure=float(row.structure),
        volume_ratio=float(row.volume_ratio), spread_points=float(row.spread_points),
        m15_trend=float(row.m15_trend), ml_prob_up=float(ml_prob_up),
    )

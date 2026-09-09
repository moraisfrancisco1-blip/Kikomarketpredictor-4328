"""XAUUSD Scalping Engine v1.

Pure decision layer: converts feature snapshots and an optional ML probability
into LONG/SHORT/NO_TRADE. It never sends orders to a broker.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
from typing import Literal

Signal = Literal["LONG", "SHORT", "NO_TRADE"]

@dataclass(frozen=True)
class ScalpConfig:
    min_score: float = 0.68
    min_edge: float = 0.12
    max_spread_points: float = 80.0
    risk_per_trade_pct: float = 0.50
    max_daily_loss_pct: float = 2.0
    max_open_positions: int = 1
    min_atr_pct: float = 0.015
    max_atr_pct: float = 0.80
    rr: float = 1.60

@dataclass(frozen=True)
class ScalpFeatures:
    price: float
    ema9: float
    ema21: float
    ema50: float
    rsi7: float
    rsi14: float
    atr_pct: float
    adx14: float
    vwap_distance_pct: float
    momentum: float
    structure: float
    volume_ratio: float
    spread_points: float
    m15_trend: float
    ml_prob_up: float = 0.50

@dataclass(frozen=True)
class ScalpDecision:
    signal: Signal
    score: float
    probability_up: float
    probability_down: float
    entry: float
    stop: float | None
    target: float | None
    risk_pct: float
    reason: str
    def to_dict(self) -> dict:
        return asdict(self)

def _clip(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))

def _trend_score(f: ScalpFeatures) -> float:
    if f.ema9 > f.ema21 > f.ema50:
        alignment = 1.0
    elif f.ema9 < f.ema21 < f.ema50:
        alignment = -1.0
    else:
        alignment = 0.0
    return alignment * 0.50 + _clip(f.m15_trend, -1.0, 1.0) * 0.50

def evaluate(f: ScalpFeatures, cfg: ScalpConfig = ScalpConfig()) -> ScalpDecision:
    ml_up = _clip(f.ml_prob_up, 0.0, 1.0)
    technical = (
        0.30 * _clip(_trend_score(f), -1.0, 1.0)
        + 0.18 * _clip(f.momentum, -1.0, 1.0)
        + 0.15 * _clip(f.structure, -1.0, 1.0)
        + 0.10 * _clip(f.volume_ratio - 1.0, -1.0, 1.0)
        + 0.12 * _clip((f.adx14 - 20.0) / 20.0, -1.0, 1.0)
        - 0.05 * _clip(abs(f.vwap_distance_pct) / 0.50, 0.0, 1.0)
    )
    raw = technical + 0.10 * ((ml_up - 0.5) * 2.0)
    score = _clip(0.5 + raw / 2.0, 0.0, 1.0)
    filters_ok = cfg.min_atr_pct <= f.atr_pct <= cfg.max_atr_pct and f.spread_points <= cfg.max_spread_points and f.adx14 >= 18.0
    edge_up, edge_down = ml_up - 0.5, 0.5 - ml_up
    if not filters_ok:
        return ScalpDecision("NO_TRADE", score, ml_up, 1-ml_up, f.price, None, None, 0.0, "market filter rejected")
    if score >= cfg.min_score and edge_up >= cfg.min_edge and technical > 0:
        d = max(f.price * f.atr_pct / 100.0, f.price * 0.00015)
        return ScalpDecision("LONG", score, ml_up, 1-ml_up, f.price, f.price-d, f.price+d*cfg.rr, cfg.risk_per_trade_pct, "trend + momentum + ML agree")
    if score <= 1-cfg.min_score and edge_down >= cfg.min_edge and technical < 0:
        d = max(f.price * f.atr_pct / 100.0, f.price * 0.00015)
        return ScalpDecision("SHORT", score, ml_up, 1-ml_up, f.price, f.price+d, f.price-d*cfg.rr, cfg.risk_per_trade_pct, "trend + momentum + ML agree")
    return ScalpDecision("NO_TRADE", score, ml_up, 1-ml_up, f.price, None, None, 0.0, "edge/score threshold not met")

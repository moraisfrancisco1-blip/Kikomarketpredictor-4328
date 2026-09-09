"""Leak-free walk-forward XAUUSD classifier.

The model is retrained only on observations whose future label is already known.
It is deliberately separate from the generic market predictor because XAUUSD
M1 scalping needs its own feature distribution and horizon.
"""
from __future__ import annotations
from dataclasses import dataclass
import numpy as np
import pandas as pd
from xgboost import XGBClassifier

FEATURES = [
    "rsi7", "rsi14", "atr_pct", "adx14", "vwap_distance_pct",
    "momentum", "structure", "volume_ratio", "m15_trend",
]

@dataclass(frozen=True)
class WalkForwardConfig:
    horizon_bars: int = 5
    min_train: int = 2000
    retrain_every: int = 500
    min_probability_edge: float = 0.03


def _fit(train: pd.DataFrame) -> XGBClassifier:
    x = train[FEATURES].astype(float).to_numpy()
    y = train["target"].astype(int).to_numpy()
    model = XGBClassifier(
        n_estimators=180,
        max_depth=3,
        learning_rate=0.04,
        subsample=0.85,
        colsample_bytree=0.85,
        min_child_weight=8,
        reg_alpha=0.1,
        reg_lambda=1.5,
        objective="binary:logistic",
        eval_metric="logloss",
        random_state=42,
        n_jobs=2,
    )
    model.fit(x, y)
    return model


def add_targets(features: pd.DataFrame, horizon_bars: int = 5) -> pd.DataFrame:
    x = features.copy()
    future = x["close"].shift(-horizon_bars)
    x["target"] = (future > x["close"]).astype(float)
    x.loc[future.isna(), "target"] = np.nan
    return x


def walk_forward_probabilities(features: pd.DataFrame, cfg: WalkForwardConfig = WalkForwardConfig()) -> pd.Series:
    """Return P(up) for each bar using only information available at that bar."""
    x = add_targets(features, cfg.horizon_bars)
    probs = pd.Series(0.5, index=x.index, dtype=float)
    model = None
    last_fit = -10**9
    for i in range(cfg.min_train, len(x) - cfg.horizon_bars):
        train_end = i - cfg.horizon_bars
        if model is None or i - last_fit >= cfg.retrain_every:
            train = x.iloc[:train_end].dropna(subset=FEATURES + ["target"])
            if len(train) < cfg.min_train or train["target"].nunique() < 2:
                continue
            model = _fit(train)
            last_fit = i
        row = x.iloc[[i]][FEATURES]
        if model is not None and row.notna().all(axis=None):
            probs.iloc[i] = float(model.predict_proba(row.astype(float).to_numpy())[0, 1])
    return probs

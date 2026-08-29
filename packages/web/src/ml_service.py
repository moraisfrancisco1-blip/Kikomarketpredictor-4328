"""
Market Predictor ML Microservice — port 4201
XGBoost ensemble (football + market) + SHAP explanations + Isotonic calibration
Injury scraper: Sofascore (no key) + API-Football (free tier)
"""
import os, json, asyncio, logging, warnings
warnings.filterwarnings("ignore")

from typing import Optional
import numpy as np
import pandas as pd
import httpx
import shap
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from xgboost import XGBClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.preprocessing import LabelEncoder
import uvicorn

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ml_service")

app = FastAPI(title="Market Predictor ML Service", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

API_FOOTBALL_KEY = os.getenv("API_FOOTBALL_KEY", "")

# ─── SCHEMAS ──────────────────────────────────────────────────────────────────

class FootballSample(BaseModel):
    probHome: float
    probDraw: float
    probAway: float
    eloDiff: float
    xgDiff: float               # xG home - xG away (per game avg)
    h2hDominance: float         # -1..1: 1 = home always wins H2H (recency-weighted)
    homeRestDays: float
    awayRestDays: float
    homeMotivation: float       # 0-1
    awayMotivation: float       # 0-1
    homeFormPct: float          # 0-1 last 5 games win%
    awayFormPct: float
    logSample: float            # log(n_matches_used)
    outcome: Optional[int] = None  # 0=home, 1=draw, 2=away

class FootballRequest(BaseModel):
    history: list[FootballSample]
    target: FootballSample

class MarketSample(BaseModel):
    rsi14: float
    smaCross: float
    trend20: float
    atrPct: float
    volumeRatio: float
    sentimentScore: float
    regimeEncoded: float
    outcome: Optional[int] = None  # 0=down, 1=up

class MarketRequest(BaseModel):
    history: list[MarketSample]
    target: MarketSample

# ─── FEATURES ─────────────────────────────────────────────────────────────────

FOOTBALL_FEATURES = [
    "probHome","probDraw","probAway","eloDiff","xgDiff",
    "h2hDominance","homeRestDays","awayRestDays",
    "homeMotivation","awayMotivation","homeFormPct","awayFormPct","logSample"
]
FOOTBALL_LABELS = [
    "DC probHome","DC probDraw","DC probAway","Elo diff","xG diff",
    "H2H dominância","Descanso casa","Descanso fora",
    "Motivação casa","Motivação fora","Forma casa (%)","Forma fora (%)","Log amostras"
]

MARKET_FEATURES = [
    "rsi14","smaCross","trend20","atrPct","volumeRatio","sentimentScore","regimeEncoded"
]
MARKET_LABELS = [
    "RSI 14","SMA Cross","Tendência 20d","ATR %","Volume ratio","Sentimento","Regime"
]

MIN_SAMPLES = 50

# ─── ISOTONIC CALIBRATION ─────────────────────────────────────────────────────

def isotonic_calibrate(probs: np.ndarray, labels: np.ndarray, target_probs: np.ndarray) -> np.ndarray:
    """
    Per-class isotonic regression calibration (one-vs-rest).
    probs: (n_train, n_classes), labels: (n_train,), target_probs: (1, n_classes)
    Returns calibrated probabilities for the target, renormalized.
    
    NOTE: We use a 70/30 blend of calibrated vs raw to prevent extreme extrapolation
    when the target sits at the edge of the training distribution.
    """
    n_classes = probs.shape[1]
    calibrated = np.zeros(n_classes)
    for c in range(n_classes):
        y_binary = (labels == c).astype(float)
        p_col = probs[:, c]
        # Need at least 2 unique values and at least some positive cases
        if len(np.unique(p_col)) < 2 or y_binary.sum() < 3:
            calibrated[c] = target_probs[0, c]
            continue
        iso = IsotonicRegression(out_of_bounds="clip")
        iso.fit(p_col, y_binary)
        iso_pred = float(iso.predict([target_probs[0, c]])[0])
        # 70% isotonic + 30% raw to prevent extreme collapse at distribution edges
        calibrated[c] = 0.7 * iso_pred + 0.3 * target_probs[0, c]
    # renormalize
    total = calibrated.sum()
    if total <= 0:
        return target_probs[0]
    return calibrated / total

# ─── SHAP EXPLANATIONS ────────────────────────────────────────────────────────

def compute_shap(model: XGBClassifier, X_train: np.ndarray, X_target: np.ndarray, feature_labels: list, override_class: int = None) -> dict:
    """
    Compute SHAP values for the target sample.
    Returns per-feature SHAP contribution for the predicted class.
    """
    try:
        explainer = shap.TreeExplainer(model, data=shap.sample(X_train, min(100, len(X_train))), feature_perturbation="interventional")
        shap_vals = explainer.shap_values(X_target)
        # shap_vals shape: (n_classes, n_samples, n_features) or (n_samples, n_features)
        proba = model.predict_proba(X_target)[0]
        predicted_class = override_class if override_class is not None else int(np.argmax(proba))
        
        if isinstance(shap_vals, list):
            # list of arrays, one per class
            pc = min(predicted_class, len(shap_vals) - 1)
            arr = shap_vals[pc]
            vals = arr[0] if arr.ndim > 1 else arr
        elif shap_vals.ndim == 3:
            # (n_classes, n_samples, n_features)
            pc = min(predicted_class, shap_vals.shape[0] - 1)
            vals = shap_vals[pc][0]
        elif shap_vals.ndim == 2:
            # (n_samples, n_features) — binary or single class
            vals = shap_vals[0]
        else:
            vals = shap_vals

        # Map predicted class back to original labels via label encoder if present
        le = getattr(model, "_label_encoder", None)
        if le is not None and predicted_class < len(le.classes_):
            original_class = int(le.classes_[predicted_class])
        else:
            original_class = predicted_class

        return {
            "predictedClass": original_class,
            "values": [{"feature": feature_labels[i], "shap": round(float(vals[i]), 4)} for i in range(min(len(feature_labels), len(vals)))]
        }
    except Exception as e:
        logger.warning(f"SHAP failed: {e}")
        return {}

# ─── TRAINING ─────────────────────────────────────────────────────────────────

def train_football(history: list[FootballSample]):
    rows = [s.model_dump() for s in history if s.outcome is not None]
    if len(rows) < MIN_SAMPLES:
        return None, None, None, len(rows)
    df = pd.DataFrame(rows)
    X = df[FOOTBALL_FEATURES].values.astype(float)
    y = df["outcome"].values.astype(int)
    # Outcomes: 0=home, 1=draw, 2=away — always 3 classes with WF samples
    # NOTE: Do NOT use LabelEncoder — it breaks XGBoost multi:softprob indexing.
    # Ensure all 3 classes exist (pad if not, extremely rare edge case).
    unique_classes = np.unique(y)
    n_classes = 3  # always fixed: home/draw/away
    # Class-weighted sample weights (balances imbalanced outcomes)
    counts = np.bincount(y, minlength=3)
    total = counts.sum()
    # Use scale_pos_weight-style: weight = total / (n_classes * class_count)
    class_w = np.where(counts > 0, total / (n_classes * np.maximum(counts, 1)), 1.0)
    sample_w = class_w[y]
    model = XGBClassifier(
        n_estimators=400, max_depth=4, learning_rate=0.03,
        subsample=0.8, colsample_bytree=0.7, min_child_weight=5,
        gamma=0.1, reg_alpha=0.1, reg_lambda=1.0,
        eval_metric="mlogloss", verbosity=0,
        random_state=42, num_class=n_classes, objective="multi:softprob"
    )
    model.fit(X, y, sample_weight=sample_w)
    # Store raw probs for isotonic calibration
    raw_probs = model.predict_proba(X)
    return model, X, raw_probs, len(rows)

def train_market(history: list[MarketSample]):
    rows = [s.model_dump() for s in history if s.outcome is not None]
    if len(rows) < MIN_SAMPLES:
        return None, None, None, len(rows)
    df = pd.DataFrame(rows)
    X = df[MARKET_FEATURES].values.astype(float)
    y = df["outcome"].values.astype(int)
    model = XGBClassifier(
        n_estimators=200, max_depth=3, learning_rate=0.05,
        subsample=0.8, colsample_bytree=0.8,
        eval_metric="logloss", verbosity=0,
        random_state=42, objective="binary:logistic"
    )
    model.fit(X, y)
    raw_probs = model.predict_proba(X)
    return model, X, raw_probs, len(rows)

def get_feature_importance(model, features):
    scores = model.get_booster().get_score(importance_type="gain")
    return {f: round(float(scores.get(f"f{i}", 0)), 3) for i, f in enumerate(features)}

# ─── FOOTBALL ENDPOINT ────────────────────────────────────────────────────────

@app.post("/predict/football")
async def predict_football(req: FootballRequest):
    model, X_train, raw_probs_train, n = train_football(req.history)

    target_dict = req.target.model_dump()
    X_target = np.array([[target_dict[f] for f in FOOTBALL_FEATURES]])

    if model is None:
        return {
            "source": "dixon-coles-only",
            "warning": f"Apenas {n} amostras de treino (mínimo {MIN_SAMPLES}). XGBoost desactivado.",
            "probHome": req.target.probHome,
            "probDraw": req.target.probDraw,
            "probAway": req.target.probAway,
            "confidence": "low",
            "featureImportance": {},
            "shap": {}
        }

    # XGBoost always outputs 3 classes (0=home, 1=draw, 2=away) — no LabelEncoder remapping needed
    xgb_proba = model.predict_proba(X_target)[0][:3]

    # ── Isotonic calibration ──────────────────────────────────────────────────
    history_rows = [s.model_dump() for s in req.history if s.outcome is not None]
    y_train_orig = np.array([r["outcome"] for r in history_rows], dtype=int)
    # raw_probs_train already has 3 columns (num_class=3)
    calibrated_proba = isotonic_calibrate(raw_probs_train[:, :3], y_train_orig, xgb_proba.reshape(1, -1))

    # ── Blend: 35% calibrated XGBoost + 65% Dixon-Coles ─────────────────────
    dc = [req.target.probHome, req.target.probDraw, req.target.probAway]
    blend = [0.35 * calibrated_proba[i] + 0.65 * dc[i] for i in range(3)]
    total = sum(blend)
    blend = [b / total for b in blend]

    # ── Confidence ────────────────────────────────────────────────────────────
    dc_winner = ["home","draw","away"][int(np.argmax(dc))]
    xgb_winner = ["home","draw","away"][int(np.argmax(xgb_proba))]
    cal_winner = ["home","draw","away"][int(np.argmax(calibrated_proba))]
    all_agree = dc_winner == xgb_winner == cal_winner
    confidence = "high" if all_agree else ("medium" if dc_winner == cal_winner else "low")

    # ── SHAP ─────────────────────────────────────────────────────────────────
    predicted_class = int(np.argmax(xgb_proba))
    shap_result = compute_shap(model, X_train, X_target, FOOTBALL_LABELS, override_class=predicted_class)

    importance = get_feature_importance(model, FOOTBALL_FEATURES)

    return {
        "source": "xgboost-ensemble",
        "trainingSamples": n,
        "dixonColes": {"probHome": round(dc[0], 4), "probDraw": round(dc[1], 4), "probAway": round(dc[2], 4)},
        "xgboost": {"probHome": round(float(xgb_proba[0]), 4), "probDraw": round(float(xgb_proba[1]), 4), "probAway": round(float(xgb_proba[2]), 4)},
        "calibrated": {"probHome": round(float(calibrated_proba[0]), 4), "probDraw": round(float(calibrated_proba[1]), 4), "probAway": round(float(calibrated_proba[2]), 4)},
        "ensemble": {"probHome": round(blend[0], 4), "probDraw": round(blend[1], 4), "probAway": round(blend[2], 4)},
        "confidence": confidence,
        "featureImportance": importance,
        "shap": shap_result
    }

# ─── MARKET ENDPOINT ──────────────────────────────────────────────────────────

@app.post("/predict/market")
async def predict_market(req: MarketRequest):
    model, X_train, raw_probs_train, n = train_market(req.history)

    target_dict = req.target.model_dump()
    X_target = np.array([[target_dict[f] for f in MARKET_FEATURES]])

    if model is None:
        return {
            "source": "insufficient-data",
            "warning": f"Apenas {n} amostras (mínimo {MIN_SAMPLES}).",
            "probUp": 0.5, "probDown": 0.5,
            "confidence": "low", "featureImportance": {}, "shap": {}
        }

    xgb_proba = model.predict_proba(X_target)[0]

    # Isotonic calibration (binary)
    history_rows = [s.model_dump() for s in req.history if s.outcome is not None]
    y_train = np.array([r["outcome"] for r in history_rows], dtype=int)
    cal = isotonic_calibrate(raw_probs_train, y_train, xgb_proba.reshape(1, -1))
    prob_up = float(cal[1]) if len(cal) > 1 else float(cal[0])
    prob_up = max(0.0, min(1.0, prob_up))

    confidence = "high" if abs(prob_up - 0.5) > 0.15 else ("medium" if abs(prob_up - 0.5) > 0.07 else "low")

    shap_result = compute_shap(model, X_train, X_target, MARKET_LABELS)
    importance = get_feature_importance(model, MARKET_FEATURES)

    return {
        "source": "xgboost-calibrated",
        "trainingSamples": n,
        "probUp": round(prob_up, 4),
        "probDown": round(1 - prob_up, 4),
        "confidence": confidence,
        "featureImportance": importance,
        "shap": shap_result
    }

# ─── INJURIES ─────────────────────────────────────────────────────────────────

async def fetch_sofascore_injuries(event_id: int) -> dict:
    url = f"https://api.sofascore.com/api/v1/event/{event_id}/lineups"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Referer": "https://www.sofascore.com/"
    }
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(url, headers=headers)
        if r.status_code != 200:
            return {}
        data = r.json()
        result = {"home": [], "away": []}
        for side in ["home", "away"]:
            team_data = data.get(side, {})
            for p in team_data.get("missingPlayers", []):
                result[side].append({
                    "name": p.get("name", "Unknown"),
                    "reason": p.get("injuryType", {}).get("name", "Unknown"),
                    "status": "absent"
                })
        return result

async def fetch_apifootball_injuries(fixture_id: int) -> dict:
    if not API_FOOTBALL_KEY:
        return {}
    headers = {"x-apisports-key": API_FOOTBALL_KEY, "x-rapidapi-host": "v3.football.api-sports.io"}
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get("https://v3.football.api-sports.io/injuries", headers=headers, params={"fixture": fixture_id})
        if r.status_code != 200:
            return {}
        data = r.json()
        result = {}
        for item in data.get("response", []):
            player = item.get("player", {})
            team_name = item.get("team", {}).get("name", "unknown")
            result.setdefault(team_name, []).append({
                "name": player.get("name", "Unknown"),
                "reason": player.get("reason", "Injury"),
                "status": player.get("type", "Doubtful")
            })
        return result

@app.get("/injuries/{event_id}")
async def get_injuries(event_id: int, source: str = "sofascore"):
    result = {"eventId": event_id, "home": [], "away": [], "sources": []}
    tasks = []
    if source in ("sofascore", "both"):
        tasks.append(("sofascore", fetch_sofascore_injuries(event_id)))
    if source in ("apifootball", "both") and API_FOOTBALL_KEY:
        tasks.append(("apifootball", fetch_apifootball_injuries(event_id)))
    for label, coro in tasks:
        try:
            data = await coro
            if data:
                result["sources"].append(label)
                for side in ["home", "away"]:
                    existing = {p["name"] for p in result[side]}
                    for p in data.get(side, []):
                        if p["name"] not in existing:
                            result[side].append(p)
                            existing.add(p["name"])
        except Exception as e:
            logger.warning(f"Injury fetch failed ({label}): {e}")
    return result

@app.get("/health")
async def health():
    return {"status": "ok", "version": "2.0.0", "features": ["xgboost","isotonic-calibration","shap","injuries"]}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=4201, log_level="info")

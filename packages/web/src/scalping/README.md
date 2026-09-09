# XAUUSD Scalp Engine v1

Decision layer for XAUUSD M1/M5 scalping. It combines trend alignment, momentum, structure, volume, ADX, VWAP distance and the existing ML probability to return `LONG`, `SHORT` or `NO_TRADE`.

## Data and backtest

`mt5_adapter.py` reads XAUUSD bars/ticks from an installed MetaTrader 5 terminal. It is deliberately read-only: no broker orders are sent.

`feature_builder.py` creates leak-aware M1/M5 features. The M15 trend is shifted so future M15 information is not used by an earlier M1 bar.

`backtester.py` uses a conservative event model:
- signal at bar close;
- entry on the next bar open;
- spread and slippage applied;
- SL/TP checked bar by bar;
- if SL and TP are both touched in one candle, SL is assumed first;
- position sizing is based on a fixed percentage of current equity.

Example on a Windows machine with MT5 installed:

```bash
cd packages/web/src/scalping
pip install -r requirements.txt
python backtester.py
```

The current implementation does not execute live trades. The next stage is paper trading, then integration with the dashboard and the existing ML market predictor. MT5 provides Python functions for historical bars such as `copy_rates_from_pos` and for eventual trade requests via `order_send`; this project currently uses only the read side. 

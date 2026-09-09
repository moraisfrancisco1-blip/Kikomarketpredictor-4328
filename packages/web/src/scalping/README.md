# XAUUSD Scalp Engine v1

Decision layer for XAUUSD M1/M5 scalping. It combines trend alignment, momentum, structure, volume, ADX, VWAP distance and the existing ML probability to return `LONG`, `SHORT` or `NO_TRADE`.

The module deliberately does not connect to a broker or place orders.

Next stages:
1. MT5 candle/tick adapter.
2. Feature builder from real XAUUSD M1/M5 data.
3. Backtest with spread, commission and slippage.
4. Paper-trading execution adapter.
5. Risk manager and trade journal integration.
6. Dashboard integration.

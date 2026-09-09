"""Deterministic paper-trading state machine for the XAUUSD scalping engine.

This module deliberately contains NO broker/API calls. It consumes generated
signals and bid/ask bars and simulates fills, stops, targets, risk limits and
trade lifecycle so the strategy can be exercised before MT5 execution.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Optional, Literal

Side = Literal["LONG", "SHORT"]


@dataclass(frozen=True)
class PaperConfig:
    initial_equity: float = 10_000.0
    risk_pct: float = 0.50
    max_daily_loss_pct: float = 2.0
    max_consecutive_losses: int = 3
    max_positions: int = 1


@dataclass
class Position:
    side: Side
    entry: float
    stop: float
    target: float
    units: float
    opened_at: object


@dataclass
class ClosedTrade:
    side: Side
    entry: float
    exit: float
    units: float
    pnl: float
    r_multiple: float
    opened_at: object
    closed_at: object
    reason: str


class PaperTrader:
    """Single-position paper trader with deterministic risk controls."""

    def __init__(self, config: PaperConfig | None = None):
        self.config = config or PaperConfig()
        self.equity = self.config.initial_equity
        self.day_start_equity = self.equity
        self.position: Optional[Position] = None
        self.trades: list[ClosedTrade] = []
        self.consecutive_losses = 0

    def reset_day(self) -> None:
        self.day_start_equity = self.equity
        self.consecutive_losses = 0

    @property
    def daily_loss_pct(self) -> float:
        return max(0.0, (self.day_start_equity - self.equity) / self.day_start_equity * 100.0)

    @property
    def halted(self) -> bool:
        return (
            self.daily_loss_pct >= self.config.max_daily_loss_pct
            or self.consecutive_losses >= self.config.max_consecutive_losses
        )

    def _units_for_risk(self, entry: float, stop: float) -> float:
        risk_cash = self.equity * self.config.risk_pct / 100.0
        distance = abs(entry - stop)
        if distance <= 0:
            return 0.0
        return risk_cash / distance

    def open(self, side: Side, bid: float, ask: float, stop: float, target: float, timestamp: object) -> bool:
        if self.position is not None or self.halted:
            return False
        entry = ask if side == "LONG" else bid
        units = self._units_for_risk(entry, stop)
        if units <= 0:
            return False
        self.position = Position(side, entry, stop, target, units, timestamp)
        return True

    def on_bar(self, bid_high: float, bid_low: float, ask_high: float, ask_low: float, timestamp: object) -> Optional[ClosedTrade]:
        """Process one bar. If stop and target are both touched, stop wins."""
        p = self.position
        if p is None:
            return None

        if p.side == "LONG":
            stop_hit = bid_low <= p.stop
            target_hit = bid_high >= p.target
            if stop_hit:
                return self._close(p.stop, timestamp, "SL")
            if target_hit:
                return self._close(p.target, timestamp, "TP")
        else:
            stop_hit = ask_high >= p.stop
            target_hit = ask_low <= p.target
            if stop_hit:
                return self._close(p.stop, timestamp, "SL")
            if target_hit:
                return self._close(p.target, timestamp, "TP")
        return None

    def _close(self, exit_price: float, timestamp: object, reason: str) -> ClosedTrade:
        p = self.position
        assert p is not None
        direction = 1.0 if p.side == "LONG" else -1.0
        pnl = (exit_price - p.entry) * p.units * direction
        risk_cash = abs(p.entry - p.stop) * p.units
        r = pnl / risk_cash if risk_cash else 0.0
        trade = ClosedTrade(p.side, p.entry, exit_price, p.units, pnl, r, p.opened_at, timestamp, reason)
        self.equity += pnl
        self.trades.append(trade)
        self.consecutive_losses = self.consecutive_losses + 1 if pnl < 0 else 0
        self.position = None
        return trade

    def snapshot(self) -> dict:
        wins = sum(t.pnl > 0 for t in self.trades)
        losses = sum(t.pnl < 0 for t in self.trades)
        gross_profit = sum(t.pnl for t in self.trades if t.pnl > 0)
        gross_loss = -sum(t.pnl for t in self.trades if t.pnl < 0)
        return {
            "equity": self.equity,
            "returnPct": (self.equity / self.config.initial_equity - 1) * 100,
            "trades": len(self.trades),
            "wins": wins,
            "losses": losses,
            "winRatePct": wins / len(self.trades) * 100 if self.trades else 0.0,
            "profitFactor": gross_profit / gross_loss if gross_loss else None,
            "dailyLossPct": self.daily_loss_pct,
            "halted": self.halted,
            "position": asdict(self.position) if self.position else None,
        }

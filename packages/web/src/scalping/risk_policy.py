"""Central risk policy shared by backtest, paper trading and future MT5 execution."""
from __future__ import annotations
from dataclasses import dataclass


@dataclass(frozen=True)
class RiskPolicy:
    risk_per_trade_pct: float = 0.50
    max_daily_loss_pct: float = 2.00
    max_consecutive_losses: int = 3
    max_open_positions: int = 1
    min_rr: float = 1.30
    max_spread_points: float = 40.0
    min_atr: float = 0.05

    def approve(self, *, equity: float, daily_start_equity: float,
                consecutive_losses: int, open_positions: int,
                spread_points: float, atr: float, reward_risk: float) -> tuple[bool, str]:
        if equity <= 0 or daily_start_equity <= 0:
            return False, "invalid_equity"
        daily_loss = max(0.0, (daily_start_equity - equity) / daily_start_equity * 100.0)
        if daily_loss >= self.max_daily_loss_pct:
            return False, "daily_loss_limit"
        if consecutive_losses >= self.max_consecutive_losses:
            return False, "consecutive_loss_limit"
        if open_positions >= self.max_open_positions:
            return False, "position_limit"
        if spread_points > self.max_spread_points:
            return False, "spread_too_wide"
        if atr < self.min_atr:
            return False, "volatility_too_low"
        if reward_risk < self.min_rr:
            return False, "rr_too_low"
        return True, "approved"

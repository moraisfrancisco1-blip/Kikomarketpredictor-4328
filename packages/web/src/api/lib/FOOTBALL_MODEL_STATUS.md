# Football prediction engine status

## Production path

The public football prediction API now routes through `football-production-engine.ts`.

The active statistical core is Dixon-Coles with recency weighting, fitted home advantage, low-score correction, target-date rest, walk-forward validation, and conservative empirical shrinkage toward observed base rates.

Fixture predictions pass the actual fixture date into the model. The API no longer needs to use the current date to estimate rest/fatigue for a future fixture.

## Validation gates

Brier score and multiclass log loss are calculated from walk-forward predictions only. Hyperparameter tuning is done on a prior tuning window rather than on the final holdout.

A prediction is flagged when the validation sample is insufficient, the probability distribution is excessively concentrated, or the model fails to beat the historical base-rate baseline.

## xG

The existing Understat xG feed is retained as contextual/display data. It is **not** used to change production 1X2 probabilities yet. The reason is methodological: the repository does not currently contain a per-match historical xG series aligned with every walk-forward prediction, so a genuine leakage-safe xG blend cannot yet be validated.

The xG blend module and acceptance gate are implemented. xG can enter the probability path only after a historical per-match xG dataset demonstrates a required out-of-sample improvement in both Brier and log loss.

## AI context

The AI evidence layer accepts structured evidence such as injuries, suspensions, probable lineups, news, rest and motivation. Evidence is weighted by confidence, source quality and recency.

AI context is hard-bounded before reaching the statistical model: attack/defence multipliers are limited to a small range and motivation is limited even further. The AI layer cannot emit a probability directly or override the statistical core.

## Prediction ledger

Resolved predictions can be stored with their 1X2 probabilities and later scored. The ledger reports Brier, log loss, accuracy, unresolved count and calibration state.

## Explicit non-goals

The system does not claim guaranteed betting profit. No bookmaker odds are used to train the football model. No live contextual source is allowed to bypass the validation gates.

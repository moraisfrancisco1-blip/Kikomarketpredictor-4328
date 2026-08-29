# Design — Market Predictor

## Vibe
Quant trading terminal. Dark, dense, data-first. Honest about uncertainty.

## Color
- bg: #0a0e17 (near-black navy)
- surface: #121826
- border: #1f2937
- text: #e5e7eb / muted #94a3b8
- accent green (bull): #34d399
- accent red (bear): #f87171
- accent cyan (primary action / model): #22d3ee
- amber (warning/disclaimer): #fbbf24

## Typography
- Display/UI: "Space Grotesk" avoided per anti-patterns → use "Sora" for headings
- Body + numbers: "JetBrains Mono" for tabular figures, "Inter" avoided → use "IBM Plex Sans" for body
- Tabular numerals everywhere for prices/stats.

## Layout
- Left: symbol + controls rail. Main: chart + prediction. Right/bottom: backtest stats + lottery module.
- Grid-breaking cards, thin borders, subtle glow on accents.

## Motion
- Single staggered load reveal with Motion. Chart draws in.

## Honesty principle
- Every predictive output shows confidence + disclaimer. Lottery module explicitly labeled "random — no edge exists".

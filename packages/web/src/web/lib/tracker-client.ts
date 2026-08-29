// Client-side tracker helpers — localStorage only, no server deps.
const TRACKER_KEY = "mp_tracker_v1";
const BANKROLL_KEY = "mp_bankroll_v1";

export interface TrackerRecord {
  id: string;
  createdAt: string;
  resolvedAt?: string;
  match: string;
  league: string;
  kind: string;
  predictedOutcome: string;
  actualOutcome?: string;
  correct?: boolean;
  // Kelly / value betting fields
  modelProb?: number;
  odds?: number;
  edge?: number;
  kellyFraction?: number;    // 0..1 recommended stake as % of bankroll
  quarterKelly?: number;     // kellyFraction * 0.25
  stakeAmount?: number;      // actual € staked (user-entered)
  pnl?: number;              // profit/loss in € (computed on resolution)
}

export interface BankrollState {
  initial: number;
  current: number;
  updatedAt: string;
}

export function loadTrackerRecords(): TrackerRecord[] {
  try {
    return JSON.parse(localStorage.getItem(TRACKER_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveTrackerRecord(rec: TrackerRecord) {
  const records = loadTrackerRecords();
  records.push(rec);
  localStorage.setItem(TRACKER_KEY, JSON.stringify(records));
}

export function updateTrackerRecord(id: string, patch: Partial<TrackerRecord>) {
  const records = loadTrackerRecords();
  const idx = records.findIndex((r) => r.id === id);
  if (idx < 0) return;
  records[idx] = { ...records[idx], ...patch };
  localStorage.setItem(TRACKER_KEY, JSON.stringify(records));
}

export function resolveTrackerRecord(id: string, actualOutcome: string) {
  const records = loadTrackerRecords();
  const idx = records.findIndex((r) => r.id === id);
  if (idx < 0) return;
  const rec = records[idx];
  rec.resolvedAt = new Date().toISOString();
  rec.actualOutcome = actualOutcome;
  rec.correct = rec.predictedOutcome === actualOutcome;
  // Compute P&L
  if (rec.stakeAmount != null && rec.odds != null) {
    if (rec.correct) {
      rec.pnl = rec.stakeAmount * (rec.odds - 1);
    } else {
      rec.pnl = -rec.stakeAmount;
    }
    // Update bankroll
    const br = loadBankroll();
    if (br) {
      br.current += rec.pnl;
      br.updatedAt = new Date().toISOString();
      saveBankroll(br);
    }
  }
  records[idx] = rec;
  localStorage.setItem(TRACKER_KEY, JSON.stringify(records));
}

export function deleteTrackerRecord(id: string) {
  const records = loadTrackerRecords();
  localStorage.setItem(TRACKER_KEY, JSON.stringify(records.filter((r) => r.id !== id)));
}

// Bankroll management
export function loadBankroll(): BankrollState | null {
  try {
    return JSON.parse(localStorage.getItem(BANKROLL_KEY) ?? "null");
  } catch {
    return null;
  }
}

export function saveBankroll(state: BankrollState) {
  localStorage.setItem(BANKROLL_KEY, JSON.stringify(state));
}

export function initBankroll(initial: number) {
  const state: BankrollState = { initial, current: initial, updatedAt: new Date().toISOString() };
  saveBankroll(state);
  return state;
}

// Kelly Criterion helpers
export function calcKelly(modelProb: number, odds: number): number {
  // Kelly = (p * (odds - 1) - (1 - p)) / (odds - 1)
  //       = (p * odds - 1) / (odds - 1)
  if (odds <= 1) return 0;
  const kelly = (modelProb * odds - 1) / (odds - 1);
  return Math.max(0, Math.min(kelly, 0.5)); // cap at 50%
}

export function calcQuarterKelly(modelProb: number, odds: number): number {
  return calcKelly(modelProb, odds) * 0.25;
}

// ROI & stats
export interface TrackerStats {
  total: number;
  resolved: number;
  correct: number;
  accuracy: number;
  totalStaked: number;
  totalPnl: number;
  roi: number;
  pending: number;
  bestWin: number;
  worstLoss: number;
  avgEdge: number;
  avgKelly: number;
  valueBetCount: number;
  valueBetCorrect: number;
}

export function calcTrackerStats(records: TrackerRecord[]): TrackerStats {
  const resolved = records.filter((r) => r.resolvedAt != null);
  const correct = resolved.filter((r) => r.correct);
  const staked = records.filter((r) => r.stakeAmount != null);
  const totalStaked = staked.reduce((s, r) => s + (r.stakeAmount ?? 0), 0);
  const totalPnl = resolved.reduce((s, r) => s + (r.pnl ?? 0), 0);
  const pnls = resolved.filter((r) => r.pnl != null).map((r) => r.pnl ?? 0);
  const edgesAll = records.filter((r) => r.edge != null).map((r) => r.edge ?? 0);
  const kellys = records.filter((r) => r.kellyFraction != null).map((r) => r.kellyFraction ?? 0);
  const valueBets = records.filter((r) => (r.edge ?? 0) >= 0.05);
  const valueBetCorrect = valueBets.filter((r) => r.correct).length;
  return {
    total: records.length,
    resolved: resolved.length,
    correct: correct.length,
    accuracy: resolved.length ? correct.length / resolved.length : 0,
    totalStaked,
    totalPnl,
    roi: totalStaked > 0 ? totalPnl / totalStaked : 0,
    pending: records.length - resolved.length,
    bestWin: pnls.length ? Math.max(...pnls) : 0,
    worstLoss: pnls.length ? Math.min(...pnls) : 0,
    avgEdge: edgesAll.length ? edgesAll.reduce((a, b) => a + b, 0) / edgesAll.length : 0,
    avgKelly: kellys.length ? kellys.reduce((a, b) => a + b, 0) / kellys.length : 0,
    valueBetCount: valueBets.length,
    valueBetCorrect,
  };
}

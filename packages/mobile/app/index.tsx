import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { API_BASE_URL, apiFetch, checkApi } from "../lib/api";

type Tab = "overview" | "markets" | "football";
type Health = { status: string };
type Candle = { datetime?: string; close?: number };
type Prediction = {
  probabilityUp?: number;
  calibratedProbabilityUp?: number;
  expectedReturn?: number;
  confidence?: number;
  regime?: string;
  dataQuality?: string;
  confidenceExplained?: string;
};
type MarketResponse = { symbol: string; candles: Candle[] };
type PredictionResponse = { prediction: Prediction };
type FootballGame = {
  date: string;
  time?: string;
  home?: string;
  away?: string;
  prediction?: { probHome?: number; probDraw?: number; probAway?: number; confidence?: number; validation?: { brier?: number | null; logLoss?: number | null; samples?: number } };
  error?: string | null;
};
type FootballResponse = { league: string; season?: string; offseason?: boolean; games: FootballGame[] };
type MarketResult = { symbol: string; m: MarketResponse; p: PredictionResponse };

const WATCH_SYMBOLS = ["AAPL", "MSFT", "NVDA", "TSLA"];

function pct(value?: number, digits = 1) {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : "—";
}

function money(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "—";
}

function Card({ children, style }: { children: ReactNode; style?: any }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function SectionTitle({ title, action, onPress }: { title: string; action?: string; onPress?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action && <Pressable onPress={onPress} hitSlop={8}><Text style={styles.action}>{action}</Text></Pressable>}
    </View>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text>{detail ? <Text style={styles.metricDetail}>{detail}</Text> : null}</View>;
}

export default function Index() {
  const [tab, setTab] = useState<Tab>("overview");
  const [refreshing, setRefreshing] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [market, setMarket] = useState<Record<string, MarketResponse>>({});
  const [predictions, setPredictions] = useState<Record<string, PredictionResponse>>({});
  const [football, setFootball] = useState<FootballResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setHealthError(null);

    const [healthResult, ...dataResults] = await Promise.allSettled([
      checkApi(),
      ...WATCH_SYMBOLS.map(async (symbol): Promise<MarketResult> => {
        const [m, p] = await Promise.all([
          apiFetch<MarketResponse>(`/api/markets?symbol=${encodeURIComponent(symbol)}`),
          apiFetch<PredictionResponse>(`/api/predict?symbol=${encodeURIComponent(symbol)}`),
        ]);
        return { symbol, m, p };
      }),
      apiFetch<FootballResponse>("/api/sports/football/fixtures?league=E0&days=7"),
    ]);

    if (healthResult.status === "fulfilled") {
      setHealth(healthResult.value);
    } else {
      setHealth(null);
      setHealthError(healthResult.reason?.message || "Unable to reach API");
    }

    const nextMarkets: Record<string, MarketResponse> = {};
    const nextPredictions: Record<string, PredictionResponse> = {};
    dataResults.slice(0, WATCH_SYMBOLS.length).forEach((result) => {
      if (result.status === "fulfilled" && "symbol" in result.value) {
        nextMarkets[result.value.symbol] = result.value.m;
        nextPredictions[result.value.symbol] = result.value.p;
      }
    });
    setMarket(nextMarkets);
    setPredictions(nextPredictions);

    const footballResult = dataResults[WATCH_SYMBOLS.length];
    if (footballResult?.status === "fulfilled" && "games" in footballResult.value) {
      setFootball(footballResult.value);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [load]);

  const latest = useMemo(() => WATCH_SYMBOLS.map((symbol) => ({
    symbol,
    price: market[symbol]?.candles?.at(-1)?.close,
    prediction: predictions[symbol]?.prediction,
  })).filter((x) => x.price !== undefined || x.prediction), [market, predictions]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>PrevCore</Text>
          <Text style={styles.subtitle}>Prediction Intelligence</Text>
        </View>
        <View style={[styles.statusPill, health ? styles.statusOk : styles.statusBad]}>
          <View style={styles.dot} />
          <Text style={styles.statusText}>{health ? "ONLINE" : "OFFLINE"}</Text>
        </View>
      </View>

      <View style={styles.tabs}>
        {(["overview", "markets", "football"] as Tab[]).map((item) => (
          <Pressable key={item} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.tabActive]}>
            <Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{item === "overview" ? "Overview" : item === "markets" ? "Markets" : "Football"}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#fff" />}
      >
        {healthError ? (
          <Card style={styles.errorCard}>
            <Text style={styles.errorTitle}>API connection problem</Text>
            <Text style={styles.errorText}>{healthError}</Text>
            <Text style={styles.errorText}>Endpoint: {API_BASE_URL || "not configured"}</Text>
            <Pressable style={styles.retry} onPress={() => void refresh()}><Text style={styles.retryText}>Retry</Text></Pressable>
          </Card>
        ) : null}

        {loading ? <View style={styles.loading}><ActivityIndicator size="large" color="#fff" /><Text style={styles.loadingText}>Loading intelligence…</Text></View> : null}

        {!loading && tab === "overview" ? (
          <>
            <View style={styles.hero}>
              <Text style={styles.eyebrow}>SYSTEM OVERVIEW</Text>
              <Text style={styles.heroTitle}>Your models, at a glance.</Text>
              <Text style={styles.heroText}>Live market signals and conservative prediction outputs. Confidence is model confidence, not a guarantee.</Text>
            </View>
            <SectionTitle title="Market watchlist" action="Markets" onPress={() => setTab("markets")} />
            <View style={styles.grid}>{latest.slice(0, 4).map((item) => (
              <Card key={item.symbol} style={styles.marketCard}>
                <Text style={styles.symbol}>{item.symbol}</Text>
                <Text style={styles.price}>{money(item.price)}</Text>
                <Text style={styles.signal}>{pct(item.prediction?.calibratedProbabilityUp ?? item.prediction?.probabilityUp)} up</Text>
                <Text style={styles.small}>{item.prediction?.regime ?? "No regime"} · confidence {pct(item.prediction?.confidence)}</Text>
              </Card>
            ))}</View>
            <SectionTitle title="Football" action="Open" onPress={() => setTab("football")} />
            <Card>
              <View style={styles.row}><Text style={styles.cardTitle}>{football?.league ?? "Premier League"}</Text><Text style={styles.badge}>{football?.games?.length ?? 0} fixtures</Text></View>
              {football?.games?.slice(0, 3).map((game, i) => (
                <View key={`${game.home}-${game.away}-${i}`} style={styles.fixtureRow}>
                  <View style={styles.fixtureTeams}><Text style={styles.fixtureText}>{game.home ?? "Home"}</Text><Text style={styles.fixtureText}>{game.away ?? "Away"}</Text></View>
                  <Text style={styles.fixtureProb}>{game.prediction ? pct(Math.max(game.prediction.probHome ?? 0, game.prediction.probAway ?? 0, game.prediction.probDraw ?? 0)) : "—"}</Text>
                </View>
              ))}
              {!football?.games?.length ? <Text style={styles.muted}>No upcoming fixtures returned.</Text> : null}
            </Card>
            <SectionTitle title="Model health" />
            <Card><Metric label="API" value={health?.status === "ok" ? "Healthy" : "Unknown"} detail={API_BASE_URL || "Configure EXPO_PUBLIC_API_URL"} /></Card>
          </>
        ) : null}

        {!loading && tab === "markets" ? (
          <>
            <View style={styles.hero}><Text style={styles.eyebrow}>MARKET INTELLIGENCE</Text><Text style={styles.heroTitle}>Signals without the noise.</Text><Text style={styles.heroText}>Calibrated directional probabilities, expected return and regime context.</Text></View>
            {WATCH_SYMBOLS.map((symbol) => {
              const p = predictions[symbol]?.prediction;
              const candles = market[symbol]?.candles ?? [];
              return <Card key={symbol} style={styles.detailCard}>
                <View style={styles.row}><View><Text style={styles.symbol}>{symbol}</Text><Text style={styles.price}>{money(candles.at(-1)?.close)}</Text></View><View style={styles.right}><Text style={styles.bigSignal}>{pct(p?.calibratedProbabilityUp ?? p?.probabilityUp)}</Text><Text style={styles.muted}>direction up</Text></View></View>
                <View style={styles.metricsRow}>
                  <Metric label="Expected" value={pct(p?.expectedReturn)} />
                  <Metric label="Confidence" value={pct(p?.confidence)} />
                  <Metric label="Regime" value={p?.regime ?? "—"} />
                </View>
                <Text style={styles.explained}>{p?.confidenceExplained ?? "Waiting for model explanation."}</Text>
              </Card>;
            })}
          </>
        ) : null}

        {!loading && tab === "football" ? (
          <>
            <View style={styles.hero}><Text style={styles.eyebrow}>FOOTBALL ENGINE</Text><Text style={styles.heroTitle}>{football?.league ?? "Premier League"}</Text><Text style={styles.heroText}>Dixon–Coles predictions with fixture-date-safe context and validation metrics.</Text></View>
            {football?.games?.map((game, i) => {
              const p = game.prediction;
              const values = [p?.probHome ?? 0, p?.probDraw ?? 0, p?.probAway ?? 0];
              const labels = ["H", "D", "A"];
              const best = Math.max(...values);
              return <Card key={`${game.date}-${game.home}-${game.away}-${i}`} style={styles.detailCard}>
                <Text style={styles.muted}>{game.date}{game.time ? ` · ${game.time}` : ""}</Text>
                <View style={styles.matchHeader}><Text style={styles.matchTeam}>{game.home ?? "Home"}</Text><Text style={styles.vs}>VS</Text><Text style={styles.matchTeam}>{game.away ?? "Away"}</Text></View>
                {p ? <View style={styles.probRow}>{values.map((value, j) => <View key={labels[j]} style={[styles.probBox, value === best && styles.probBest]}><Text style={styles.probLabel}>{labels[j]}</Text><Text style={styles.probValue}>{pct(value)}</Text></View>)}</View> : <Text style={styles.warning}>{game.error ?? "Prediction unavailable"}</Text>}
                {p?.validation ? <Text style={styles.validation}>Validation · Brier {p.validation.brier?.toFixed(3) ?? "—"} · Log Loss {p.validation.logLoss?.toFixed(3) ?? "—"} · {p.validation.samples ?? 0} samples</Text> : null}
              </Card>;
            })}
            {!football?.games?.length ? <Card><Text style={styles.muted}>No fixtures available. Pull to refresh.</Text></Card> : null}
          </>
        ) : null}
        <View style={styles.footer}><Text style={styles.footerText}>PrevCore · Prediction engine</Text></View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#08111f" },
  header: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brand: { color: "#fff", fontSize: 25, fontWeight: "800", letterSpacing: 0.2 },
  subtitle: { color: "#8ea0b8", fontSize: 12, marginTop: 2 },
  statusPill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1 },
  statusOk: { borderColor: "#245d4b", backgroundColor: "#0c241d" },
  statusBad: { borderColor: "#663b3b", backgroundColor: "#281517" },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#61d6a4", marginRight: 6 },
  statusText: { color: "#b8c5d6", fontSize: 10, fontWeight: "800" },
  tabs: { flexDirection: "row", paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: "#16243a" },
  tab: { flex: 1, alignItems: "center", paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: "#fff" },
  tabText: { color: "#71829a", fontSize: 13, fontWeight: "700" },
  tabTextActive: { color: "#fff" },
  content: { padding: 16, paddingBottom: 40 },
  hero: { padding: 4, marginBottom: 24 },
  eyebrow: { color: "#6f87a5", fontSize: 10, fontWeight: "800", letterSpacing: 1.4, marginBottom: 8 },
  heroTitle: { color: "#fff", fontSize: 27, fontWeight: "800", lineHeight: 32 },
  heroText: { color: "#91a1b7", fontSize: 13, lineHeight: 19, marginTop: 8, maxWidth: 430 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10, marginTop: 4 },
  sectionTitle: { color: "#dce5f0", fontSize: 16, fontWeight: "800" },
  action: { color: "#aebed2", fontSize: 12, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 22 },
  card: { backgroundColor: "#0d192a", borderColor: "#18283f", borderWidth: 1, borderRadius: 16, padding: 15, marginBottom: 12 },
  marketCard: { width: "48.5%", minHeight: 132 },
  symbol: { color: "#a7b8cc", fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  price: { color: "#fff", fontSize: 22, fontWeight: "800", marginTop: 6 },
  signal: { color: "#91d7bb", fontSize: 13, fontWeight: "800", marginTop: 5 },
  small: { color: "#687c96", fontSize: 10, marginTop: 5 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { color: "#fff", fontSize: 15, fontWeight: "800" },
  badge: { color: "#91a3ba", backgroundColor: "#14243a", paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, fontSize: 10 },
  fixtureRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#17263b" },
  fixtureTeams: { gap: 4 },
  fixtureText: { color: "#b8c6d8", fontSize: 13 },
  fixtureProb: { color: "#fff", fontWeight: "800", alignSelf: "center" },
  muted: { color: "#71839b", fontSize: 11 },
  metric: { flex: 1 },
  metricsRow: { flexDirection: "row", gap: 12, marginTop: 16 },
  metricLabel: { color: "#70839d", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6 },
  metricValue: { color: "#fff", fontSize: 15, fontWeight: "800", marginTop: 4 },
  metricDetail: { color: "#667991", fontSize: 9, marginTop: 4 },
  loading: { alignItems: "center", paddingVertical: 80 },
  loadingText: { color: "#8294ab", marginTop: 12, fontSize: 13 },
  errorCard: { borderColor: "#5b3438", backgroundColor: "#211419" },
  errorTitle: { color: "#f1c5c8", fontWeight: "800", fontSize: 14 },
  errorText: { color: "#a98c91", fontSize: 11, marginTop: 5 },
  retry: { marginTop: 12, alignSelf: "flex-start", backgroundColor: "#fff", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 9 },
  retryText: { color: "#08111f", fontWeight: "800", fontSize: 12 },
  detailCard: { padding: 17 },
  right: { alignItems: "flex-end" },
  bigSignal: { color: "#fff", fontSize: 25, fontWeight: "800" },
  explained: { color: "#8496ac", fontSize: 11, lineHeight: 17, marginTop: 14 },
  matchHeader: { flexDirection: "row", alignItems: "center", marginVertical: 14 },
  matchTeam: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "800" },
  vs: { color: "#60738d", fontSize: 10, fontWeight: "800", marginHorizontal: 8 },
  probRow: { flexDirection: "row", gap: 7 },
  probBox: { flex: 1, backgroundColor: "#111f32", borderRadius: 10, paddingVertical: 9, alignItems: "center", borderWidth: 1, borderColor: "#1b2b42" },
  probBest: { borderColor: "#7186a1", backgroundColor: "#16263b" },
  probLabel: { color: "#6e819a", fontSize: 9, fontWeight: "800" },
  probValue: { color: "#fff", fontSize: 14, fontWeight: "800", marginTop: 3 },
  validation: { color: "#657993", fontSize: 9, marginTop: 12 },
  warning: { color: "#c9a8a8", fontSize: 11, marginTop: 6 },
  footer: { paddingVertical: 22, alignItems: "center" },
  footerText: { color: "#44566e", fontSize: 10 },
});

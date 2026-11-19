/**
 * The model's report card (/performance, DESIGN.md section 6): metrics against the baselines,
 * rolling accuracy, calibration, and the best and worst calls. Pure functions over graded games
 * (finished games that had a pregame prediction), so they're easy to test.
 */

export interface GradedGame {
  gameId: string;
  gameDate: string;
  homeAbbr: string;
  awayAbbr: string;
  homeScore: number;
  awayScore: number;
  /** The model's pregame home win probability. */
  homeWinProb: number;
  /** Elo's pregame home win probability (the challenger); null if not stored. */
  eloHomeWinProb: number | null;
  /** live = published before tip-off; backfill = walk-forward backtest. */
  source: "live" | "backfill";
}

/**
 * The "home team" baseline: always pick the home team, with this probability. It's the training
 * home win rate (2015-16..2023-24, ml/reports/baselines_validation.md), as in the ML pipeline.
 */
export const HOME_RATE = 0.568;

export interface Metrics {
  n: number;
  /** Share of games where the side given 50%+ won. */
  accuracy: number;
  /** Mean negative log likelihood of the result (lower is better; 0.693 = coin flip). */
  logLoss: number;
  /** Mean squared error of the probability (lower is better; 0.25 = coin flip). */
  brier: number;
}

export const homeWon = (g: GradedGame) => g.homeScore > g.awayScore;

/** Accuracy, log loss and Brier score of home win probabilities against results. */
export function metrics(probs: readonly number[], homeWins: readonly boolean[]): Metrics {
  const n = probs.length;
  if (!n) return { n: 0, accuracy: NaN, logLoss: NaN, brier: NaN };
  let correct = 0;
  let ll = 0;
  let brier = 0;
  for (let i = 0; i < n; i++) {
    const p = Math.min(1 - 1e-15, Math.max(1e-15, probs[i]));
    const y = homeWins[i] ? 1 : 0;
    if ((p >= 0.5) === (y === 1)) correct++;
    ll -= y ? Math.log(p) : Math.log(1 - p);
    brier += (p - y) ** 2;
  }
  return { n, accuracy: correct / n, logLoss: ll / n, brier: brier / n };
}

export interface ReportCard {
  model: Metrics;
  elo: Metrics;
  home: Metrics;
}

/** The model, Elo and the home-team baseline, all on the same games (those with an Elo number). */
export function reportCard(games: readonly GradedGame[]): ReportCard {
  const withElo = games.filter((g) => g.eloHomeWinProb !== null);
  const y = withElo.map(homeWon);
  return {
    model: metrics(
      withElo.map((g) => g.homeWinProb),
      y,
    ),
    elo: metrics(
      withElo.map((g) => g.eloHomeWinProb!),
      y,
    ),
    home: metrics(
      withElo.map(() => HOME_RATE),
      y,
    ),
  };
}

export interface RollingPoint {
  /** Day of the last game in the window. */
  gameDate: string;
  /** 1-based game number of the last game in the window. */
  game: number;
  model: number;
  elo: number | null;
}

/** Accuracy over the last ``window`` games, after each game from the window-th on (games in date order). */
export function rollingAccuracy(games: readonly GradedGame[], window = 50): RollingPoint[] {
  const out: RollingPoint[] = [];
  const modelHit = games.map((g) => (g.homeWinProb >= 0.5) === homeWon(g));
  const eloHit = games.map((g) => (g.eloHomeWinProb === null ? null : (g.eloHomeWinProb >= 0.5) === homeWon(g)));
  let m = 0;
  let e = 0;
  let eN = 0;
  for (let i = 0; i < games.length; i++) {
    m += modelHit[i] ? 1 : 0;
    if (eloHit[i] !== null) {
      e += eloHit[i] ? 1 : 0;
      eN++;
    }
    if (i >= window) {
      m -= modelHit[i - window] ? 1 : 0;
      if (eloHit[i - window] !== null) {
        e -= eloHit[i - window] ? 1 : 0;
        eN--;
      }
    }
    if (i >= window - 1) {
      out.push({ gameDate: games[i].gameDate, game: i + 1, model: m / window, elo: eN === window ? e / window : null });
    }
  }
  return out;
}

export interface CalibrationBin {
  /** e.g. "50–60%" */
  label: string;
  from: number;
  to: number;
  /** Mean probability the model gave its favorite in this bin. */
  predicted: number;
  /** How often that favorite actually won. */
  actual: number;
  n: number;
}

/**
 * Calibration from the favorite's side: games grouped by the probability the model gave the team
 * it favored (50–60%, ..., 90–100%), with how often that team won. A calibrated model's dots sit
 * on the diagonal.
 */
export function calibration(games: readonly GradedGame[]): CalibrationBin[] {
  const edges = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];
  const bins = edges.slice(0, -1).map((from, i) => ({ from, to: Math.min(1, edges[i + 1]), sumP: 0, wins: 0, n: 0 }));
  for (const g of games) {
    const favHome = g.homeWinProb >= 0.5;
    const p = favHome ? g.homeWinProb : 1 - g.homeWinProb;
    const bin = bins.find((b, i) => p >= b.from && p < edges[i + 1]);
    if (!bin) continue;
    bin.n++;
    bin.sumP += p;
    if (favHome === homeWon(g)) bin.wins++;
  }
  return bins
    .filter((b) => b.n > 0)
    .map((b) => ({
      label: `${Math.round(b.from * 100)}–${Math.round(b.to * 100)}%`,
      from: b.from,
      to: b.to,
      predicted: b.sumP / b.n,
      actual: b.wins / b.n,
      n: b.n,
    }));
}

export interface Call {
  game: GradedGame;
  /** The probability the model gave its pick. */
  confidence: number;
  correct: boolean;
}

export function call(g: GradedGame): Call {
  const favHome = g.homeWinProb >= 0.5;
  return { game: g, confidence: favHome ? g.homeWinProb : 1 - g.homeWinProb, correct: favHome === homeWon(g) };
}

/** The most confident correct calls and the most confident misses. */
export function bestAndWorst(games: readonly GradedGame[], n = 3): { best: Call[]; worst: Call[] } {
  const calls = games.map(call).sort((a, b) => b.confidence - a.confidence);
  return { best: calls.filter((c) => c.correct).slice(0, n), worst: calls.filter((c) => !c.correct).slice(0, n) };
}

/** One row of the recent-picks table. */
export interface PickRow {
  gameId: string;
  gameDate: string;
  away: string;
  home: string;
  awayScore: number;
  homeScore: number;
  /** The model's pick and the probability it gave it. */
  pick: string;
  confidence: number;
  correct: boolean;
  /** Elo's pick and whether it was right (null without an Elo number). */
  eloPick: string | null;
  eloCorrect: boolean | null;
  source: "live" | "backfill";
}

export function pickRow(g: GradedGame): PickRow {
  const c = call(g);
  const favHome = g.homeWinProb >= 0.5;
  const eloHome = g.eloHomeWinProb === null ? null : g.eloHomeWinProb >= 0.5;
  return {
    gameId: g.gameId,
    gameDate: g.gameDate,
    away: g.awayAbbr,
    home: g.homeAbbr,
    awayScore: g.awayScore,
    homeScore: g.homeScore,
    pick: favHome ? g.homeAbbr : g.awayAbbr,
    confidence: c.confidence,
    correct: c.correct,
    eloPick: eloHome === null ? null : eloHome ? g.homeAbbr : g.awayAbbr,
    eloCorrect: eloHome === null ? null : eloHome === homeWon(g),
    source: g.source,
  };
}

/** Everything /performance shows for one season, small enough to send to the browser. */
export interface SeasonSummary {
  season: string;
  card: ReportCard;
  rolling: RollingPoint[];
  calibration: CalibrationBin[];
  best: PickRow[];
  worst: PickRow[];
  /** Most recent first, capped. */
  recent: PickRow[];
  live: number;
  backfill: number;
  from: string;
  to: string;
}

export const RECENT_ROWS = 150;

export function seasonSummary(season: string, games: readonly GradedGame[]): SeasonSummary {
  const { best, worst } = bestAndWorst(games, 3);
  return {
    season,
    card: reportCard(games),
    rolling: rollingAccuracy(games, 50),
    calibration: calibration(games),
    best: best.map((c) => pickRow(c.game)),
    worst: worst.map((c) => pickRow(c.game)),
    recent: games.slice(-RECENT_ROWS).reverse().map(pickRow),
    live: games.filter((g) => g.source === "live").length,
    backfill: games.filter((g) => g.source === "backfill").length,
    from: games[0]?.gameDate ?? "",
    to: games.at(-1)?.gameDate ?? "",
  };
}

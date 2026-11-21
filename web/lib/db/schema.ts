/**
 * Database schema: the single source of truth (docs/ARCHITECTURE.md section 4).
 * Change it here, run `pnpm db:generate`, commit the SQL in web/drizzle/, then `pnpm db:migrate`.
 * The Python pipeline (ml/) reflects these tables at runtime instead of redefining them.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  pgView,
  primaryKey,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const teams = pgTable("teams", {
  teamId: integer("team_id").primaryKey(), // NBA team id, e.g. 1610612738
  abbr: text("abbr").notNull().unique(),
  city: text("city").notNull(),
  name: text("name").notNull(),
  conference: text("conference").notNull(),
  division: text("division").notNull(),
});

export const GAME_STATUSES = ["scheduled", "live", "final", "postponed"] as const;

export const games = pgTable(
  "games",
  {
    gameId: text("game_id").primaryKey(), // e.g. 0022600123
    season: text("season").notNull(), // 2026-27
    seasonType: text("season_type").notNull().default("regular"),
    gameDate: date("game_date").notNull(), // ET schedule date
    tipoffUtc: timestamp("tipoff_utc", { withTimezone: true }),
    homeTeamId: integer("home_team_id").references(() => teams.teamId),
    awayTeamId: integer("away_team_id").references(() => teams.teamId),
    status: text("status", { enum: GAME_STATUSES }).notNull(),
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
    isNeutral: boolean("is_neutral").notNull().default(false),
    gameLabel: text("game_label"), // e.g. "Emirates NBA Cup"
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("games_game_date_idx").on(t.gameDate),
    check("games_status_check", sql`${t.status} in ('scheduled', 'live', 'final', 'postponed')`),
  ],
);

export const modelVersions = pgTable("model_versions", {
  modelVersion: text("model_version").primaryKey(), // e.g. game-v1
  kind: text("kind").notNull(), // game | player
  trainedAt: timestamp("trained_at", { withTimezone: true }).notNull(),
  trainWindow: text("train_window"),
  metrics: jsonb("metrics"),
  mlflowRunId: text("mlflow_run_id"),
});

export const PREDICTION_SOURCES = ["live", "backfill"] as const;

export const gamePredictions = pgTable(
  "game_predictions",
  {
    gameId: text("game_id")
      .notNull()
      .references(() => games.gameId),
    modelVersion: text("model_version")
      .notNull()
      .references(() => modelVersions.modelVersion),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    homeWinProb: real("home_win_prob").notNull(),
    /** Top factors: [{factor, label, favors, pp, logit}] (see shared/factors.json). */
    factors: jsonb("factors").notNull(),
    featuresHash: text("features_hash").notNull(),
    isPregame: boolean("is_pregame").notNull().default(true),
    /** live = published before tip-off; backfill = walk-forward backtest (data cutoff before the game). */
    source: text("source", { enum: PREDICTION_SOURCES }).notNull().default("live"),
    /** Elo's own pregame probability: the challenger shown beside the model on /performance. */
    eloHomeWinProb: real("elo_home_win_prob"),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.modelVersion] }),
    check("game_predictions_prob_check", sql`${t.homeWinProb} between 0 and 1`),
    check("game_predictions_source_check", sql`${t.source} in ('live', 'backfill')`),
  ],
);

export const playerProjections = pgTable(
  "player_projections",
  {
    gameId: text("game_id")
      .notNull()
      .references(() => games.gameId),
    playerId: integer("player_id").notNull(),
    teamId: integer("team_id").references(() => teams.teamId),
    playerName: text("player_name").notNull(),
    jerseyNumber: text("jersey_number"),
    modelVersion: text("model_version")
      .notNull()
      .references(() => modelVersions.modelVersion),
    projMinutes: real("proj_minutes"),
    pts: real("pts"),
    reb: real("reb"),
    ast: real("ast"),
    // 80% ranges
    ptsLo: real("pts_lo"),
    ptsHi: real("pts_hi"),
    rebLo: real("reb_lo"),
    rebHi: real("reb_hi"),
    astLo: real("ast_lo"),
    astHi: real("ast_hi"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    featuresHash: text("features_hash"),
    /** live = published before tip-off; backfill = walk-forward backtest (data cutoff before the game). */
    source: text("source", { enum: PREDICTION_SOURCES }).notNull().default("live"),
    /** The real line once the game is final (minutes 0 = didn't play); filled by `tipoff results`. */
    actualMinutes: real("actual_minutes"),
    actualPts: integer("actual_pts"),
    actualReb: integer("actual_reb"),
    actualAst: integer("actual_ast"),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.playerId, t.modelVersion] }),
    check("player_projections_source_check", sql`${t.source} in ('live', 'backfill')`),
  ],
);

/** Latest pregame prediction per game; live predictions win over backfilled ones. */
export const currentGamePredictions = pgView("current_game_predictions", {
  gameId: text("game_id"),
  modelVersion: text("model_version"),
  generatedAt: timestamp("generated_at", { withTimezone: true }),
  homeWinProb: real("home_win_prob"),
  factors: jsonb("factors"),
  featuresHash: text("features_hash"),
  isPregame: boolean("is_pregame"),
  source: text("source"),
  eloHomeWinProb: real("elo_home_win_prob"),
}).as(
  sql`select distinct on (game_id) * from game_predictions where is_pregame order by game_id, (source = 'live') desc, generated_at desc`,
);

/**
 * One projection set per game: the newest live set if there is one, else the newest backfill.
 * (Whole sets, so a game never mixes players from two runs.)
 */
export const currentPlayerProjections = pgView("current_player_projections", {
  gameId: text("game_id"),
  playerId: integer("player_id"),
  teamId: integer("team_id"),
  playerName: text("player_name"),
  jerseyNumber: text("jersey_number"),
  modelVersion: text("model_version"),
  projMinutes: real("proj_minutes"),
  pts: real("pts"),
  reb: real("reb"),
  ast: real("ast"),
  ptsLo: real("pts_lo"),
  ptsHi: real("pts_hi"),
  rebLo: real("reb_lo"),
  rebHi: real("reb_hi"),
  astLo: real("ast_lo"),
  astHi: real("ast_hi"),
  generatedAt: timestamp("generated_at", { withTimezone: true }),
  featuresHash: text("features_hash"),
  source: text("source"),
  actualMinutes: real("actual_minutes"),
  actualPts: integer("actual_pts"),
  actualReb: integer("actual_reb"),
  actualAst: integer("actual_ast"),
}).as(
  sql`select p.* from player_projections p join (select distinct on (game_id) game_id, model_version from player_projections order by game_id, (source = 'live') desc, generated_at desc) pick using (game_id, model_version)`,
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * Pipeline state for the cloud daily job (not read by the website): the compressed staged game
 * history ("staged") and the champion model bundle ("champion"), written by `tipoff state push`.
 */
export const pipelineState = pgTable("pipeline_state", {
  key: text("key").primaryKey(),
  data: bytea("data").notNull(),
  sha256: text("sha256").notNull(),
  bytes: integer("bytes").notNull(),
  meta: jsonb("meta"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Box scores for the advanced stats (docs/DESIGN.md section 5): one row per team per game and one
 * per player per game, regular season, this season and last. Written by `tipoff stats` (part of
 * the daily job) from the staged box scores; the website aggregates them into season-to-date
 * ratings, the Four Factors and player shooting and usage, from games before the day only.
 */
const boxColumns = {
  minutes: integer("minutes").notNull(),
  pts: integer("pts").notNull(),
  fgm: integer("fgm").notNull(),
  fga: integer("fga").notNull(),
  fg3m: integer("fg3m").notNull(),
  fg3a: integer("fg3a").notNull(),
  ftm: integer("ftm").notNull(),
  fta: integer("fta").notNull(),
  oreb: integer("oreb").notNull(),
  dreb: integer("dreb").notNull(),
  ast: integer("ast").notNull(),
  stl: integer("stl").notNull(),
  blk: integer("blk").notNull(),
  tov: integer("tov").notNull(),
  pf: integer("pf").notNull(),
};

export const teamGameStats = pgTable(
  "team_game_stats",
  {
    gameId: text("game_id")
      .notNull()
      .references(() => games.gameId),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.teamId),
    oppTeamId: integer("opp_team_id")
      .notNull()
      .references(() => teams.teamId),
    season: text("season").notNull(),
    gameDate: date("game_date").notNull(),
    isHome: boolean("is_home").notNull(),
    ...boxColumns,
    oppPts: integer("opp_pts").notNull(),
    /** Possessions (box-score estimate, the same formula as the ML features). */
    poss: real("poss").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.teamId] }),
    index("team_game_stats_season_date_idx").on(t.season, t.gameDate),
  ],
);

export const playerGameStats = pgTable(
  "player_game_stats",
  {
    gameId: text("game_id")
      .notNull()
      .references(() => games.gameId),
    playerId: integer("player_id").notNull(),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.teamId),
    season: text("season").notNull(),
    gameDate: date("game_date").notNull(),
    playerName: text("player_name").notNull(),
    ...boxColumns,
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.playerId] }),
    index("player_game_stats_player_date_idx").on(t.playerId, t.gameDate),
  ],
);

export type Game = typeof games.$inferSelect;
export type GamePrediction = typeof gamePredictions.$inferSelect;
export type PlayerProjection = typeof currentPlayerProjections.$inferSelect;

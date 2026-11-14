/**
 * Database schema: the single source of truth (docs/ARCHITECTURE.md section 4).
 * Change it here, run `pnpm db:generate`, commit the SQL in web/drizzle/, then `pnpm db:migrate`.
 * The Python pipeline (ml/) reflects these tables at runtime instead of redefining them.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
    ptsLo: real("pts_lo"), // 80% interval
    ptsHi: real("pts_hi"),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.playerId, t.modelVersion] })],
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

export type Game = typeof games.$inferSelect;
export type GamePrediction = typeof gamePredictions.$inferSelect;

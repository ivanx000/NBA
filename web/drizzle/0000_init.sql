CREATE TABLE "game_predictions" (
	"game_id" text NOT NULL,
	"model_version" text NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"home_win_prob" real NOT NULL,
	"factors" jsonb NOT NULL,
	"features_hash" text NOT NULL,
	"is_pregame" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'live' NOT NULL,
	"elo_home_win_prob" real,
	CONSTRAINT "game_predictions_game_id_model_version_pk" PRIMARY KEY("game_id","model_version"),
	CONSTRAINT "game_predictions_prob_check" CHECK ("game_predictions"."home_win_prob" between 0 and 1),
	CONSTRAINT "game_predictions_source_check" CHECK ("game_predictions"."source" in ('live', 'backfill'))
);
--> statement-breakpoint
CREATE TABLE "games" (
	"game_id" text PRIMARY KEY NOT NULL,
	"season" text NOT NULL,
	"season_type" text DEFAULT 'regular' NOT NULL,
	"game_date" date NOT NULL,
	"tipoff_utc" timestamp with time zone,
	"home_team_id" integer,
	"away_team_id" integer,
	"status" text NOT NULL,
	"home_score" integer,
	"away_score" integer,
	"is_neutral" boolean DEFAULT false NOT NULL,
	"game_label" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_status_check" CHECK ("games"."status" in ('scheduled', 'live', 'final', 'postponed'))
);
--> statement-breakpoint
CREATE TABLE "model_versions" (
	"model_version" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"trained_at" timestamp with time zone NOT NULL,
	"train_window" text,
	"metrics" jsonb,
	"mlflow_run_id" text
);
--> statement-breakpoint
CREATE TABLE "player_projections" (
	"game_id" text NOT NULL,
	"player_id" integer NOT NULL,
	"team_id" integer,
	"player_name" text NOT NULL,
	"jersey_number" text,
	"model_version" text NOT NULL,
	"proj_minutes" real,
	"pts" real,
	"reb" real,
	"ast" real,
	"pts_lo" real,
	"pts_hi" real,
	CONSTRAINT "player_projections_game_id_player_id_model_version_pk" PRIMARY KEY("game_id","player_id","model_version")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"team_id" integer PRIMARY KEY NOT NULL,
	"abbr" text NOT NULL,
	"city" text NOT NULL,
	"name" text NOT NULL,
	"conference" text NOT NULL,
	"division" text NOT NULL,
	CONSTRAINT "teams_abbr_unique" UNIQUE("abbr")
);
--> statement-breakpoint
ALTER TABLE "game_predictions" ADD CONSTRAINT "game_predictions_game_id_games_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("game_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_predictions" ADD CONSTRAINT "game_predictions_model_version_model_versions_model_version_fk" FOREIGN KEY ("model_version") REFERENCES "public"."model_versions"("model_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_home_team_id_teams_team_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("team_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_away_team_id_teams_team_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("team_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_projections" ADD CONSTRAINT "player_projections_game_id_games_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("game_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_projections" ADD CONSTRAINT "player_projections_team_id_teams_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("team_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_projections" ADD CONSTRAINT "player_projections_model_version_model_versions_model_version_fk" FOREIGN KEY ("model_version") REFERENCES "public"."model_versions"("model_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "games_game_date_idx" ON "games" USING btree ("game_date");--> statement-breakpoint
CREATE VIEW "public"."current_game_predictions" AS (select distinct on (game_id) * from game_predictions where is_pregame order by game_id, (source = 'live') desc, generated_at desc);
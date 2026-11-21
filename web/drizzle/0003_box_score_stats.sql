CREATE TABLE "player_game_stats" (
	"game_id" text NOT NULL,
	"player_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"season" text NOT NULL,
	"game_date" date NOT NULL,
	"player_name" text NOT NULL,
	"minutes" integer NOT NULL,
	"pts" integer NOT NULL,
	"fgm" integer NOT NULL,
	"fga" integer NOT NULL,
	"fg3m" integer NOT NULL,
	"fg3a" integer NOT NULL,
	"ftm" integer NOT NULL,
	"fta" integer NOT NULL,
	"oreb" integer NOT NULL,
	"dreb" integer NOT NULL,
	"ast" integer NOT NULL,
	"stl" integer NOT NULL,
	"blk" integer NOT NULL,
	"tov" integer NOT NULL,
	"pf" integer NOT NULL,
	CONSTRAINT "player_game_stats_game_id_player_id_pk" PRIMARY KEY("game_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "team_game_stats" (
	"game_id" text NOT NULL,
	"team_id" integer NOT NULL,
	"opp_team_id" integer NOT NULL,
	"season" text NOT NULL,
	"game_date" date NOT NULL,
	"is_home" boolean NOT NULL,
	"minutes" integer NOT NULL,
	"pts" integer NOT NULL,
	"fgm" integer NOT NULL,
	"fga" integer NOT NULL,
	"fg3m" integer NOT NULL,
	"fg3a" integer NOT NULL,
	"ftm" integer NOT NULL,
	"fta" integer NOT NULL,
	"oreb" integer NOT NULL,
	"dreb" integer NOT NULL,
	"ast" integer NOT NULL,
	"stl" integer NOT NULL,
	"blk" integer NOT NULL,
	"tov" integer NOT NULL,
	"pf" integer NOT NULL,
	"opp_pts" integer NOT NULL,
	"poss" real NOT NULL,
	CONSTRAINT "team_game_stats_game_id_team_id_pk" PRIMARY KEY("game_id","team_id")
);
--> statement-breakpoint
ALTER TABLE "player_game_stats" ADD CONSTRAINT "player_game_stats_game_id_games_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("game_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_game_stats" ADD CONSTRAINT "player_game_stats_team_id_teams_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("team_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_game_stats" ADD CONSTRAINT "team_game_stats_game_id_games_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("game_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_game_stats" ADD CONSTRAINT "team_game_stats_team_id_teams_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("team_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_game_stats" ADD CONSTRAINT "team_game_stats_opp_team_id_teams_team_id_fk" FOREIGN KEY ("opp_team_id") REFERENCES "public"."teams"("team_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_game_stats_player_date_idx" ON "player_game_stats" USING btree ("player_id","game_date");--> statement-breakpoint
CREATE INDEX "team_game_stats_season_date_idx" ON "team_game_stats" USING btree ("season","game_date");
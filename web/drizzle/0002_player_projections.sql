ALTER TABLE "player_projections" ADD COLUMN "reb_lo" real;--> statement-breakpoint
ALTER TABLE "player_projections" ADD COLUMN "reb_hi" real;--> statement-breakpoint
ALTER TABLE "player_projections" ADD COLUMN "ast_lo" real;--> statement-breakpoint
ALTER TABLE "player_projections" ADD COLUMN "ast_hi" real;--> statement-breakpoint
ALTER TABLE "player_projections" ADD COLUMN "generated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "player_projections" ADD COLUMN "features_hash" text;--> statement-breakpoint
ALTER TABLE "player_projections" ADD COLUMN "source" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "player_projections" ADD COLUMN "actual_minutes" real;--> statement-breakpoint
ALTER TABLE "player_projections" ADD COLUMN "actual_pts" integer;--> statement-breakpoint
ALTER TABLE "player_projections" ADD COLUMN "actual_reb" integer;--> statement-breakpoint
ALTER TABLE "player_projections" ADD COLUMN "actual_ast" integer;--> statement-breakpoint
ALTER TABLE "player_projections" ADD CONSTRAINT "player_projections_source_check" CHECK ("player_projections"."source" in ('live', 'backfill'));--> statement-breakpoint
CREATE VIEW "public"."current_player_projections" AS (select p.* from player_projections p join (select distinct on (game_id) game_id, model_version from player_projections order by game_id, (source = 'live') desc, generated_at desc) pick using (game_id, model_version));
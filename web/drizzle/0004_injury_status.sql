ALTER TABLE "player_projections" ADD COLUMN "injury_status" text;--> statement-breakpoint
-- The view's "p.*" was expanded when it was created; replace it so it includes the new column.
CREATE OR REPLACE VIEW "public"."current_player_projections" AS (select p.* from player_projections p join (select distinct on (game_id) game_id, model_version from player_projections order by game_id, (source = 'live') desc, generated_at desc) pick using (game_id, model_version));

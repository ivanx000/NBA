CREATE TABLE "pipeline_state" (
	"key" text PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL,
	"sha256" text NOT NULL,
	"bytes" integer NOT NULL,
	"meta" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

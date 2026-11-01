-- CreateEnum
CREATE TYPE "auth_provider" AS ENUM ('guest', 'google', 'apple');

-- CreateEnum
CREATE TYPE "variant" AS ENUM ('paulista', 'mineiro');

-- CreateEnum
CREATE TYPE "match_format" AS ENUM ('single', 'bo3');

-- CreateEnum
CREATE TYPE "match_visibility" AS ENUM ('public', 'private');

-- CreateEnum
CREATE TYPE "match_status" AS ENUM ('finished', 'cancelled');

-- CreateEnum
CREATE TYPE "report_reason" AS ENUM ('cheating', 'abusive_chat', 'offensive_nickname', 'harassment', 'other');

-- CreateEnum
CREATE TYPE "report_status" AS ENUM ('open', 'reviewed', 'dismissed');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "provider" "auth_provider" NOT NULL,
    "provider_subject" TEXT NOT NULL,
    "nickname" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avatars" (
    "user_id" UUID NOT NULL,
    "parts" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "avatars_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" UUID NOT NULL,
    "variant" "variant" NOT NULL,
    "format" "match_format" NOT NULL,
    "iron_hand" BOOLEAN NOT NULL,
    "visibility" "match_visibility" NOT NULL,
    "room_code" VARCHAR(8),
    "seed" BIGINT NOT NULL,
    "options" JSONB NOT NULL,
    "events" JSONB NOT NULL,
    "deals" JSONB,
    "winner_team" SMALLINT,
    "games" JSONB NOT NULL,
    "status" "match_status" NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_players" (
    "match_id" UUID NOT NULL,
    "seat" SMALLINT NOT NULL,
    "user_id" UUID,
    "team" SMALLINT NOT NULL,
    "bot_from" INTEGER,

    CONSTRAINT "match_players_pkey" PRIMARY KEY ("match_id","seat")
);

-- CreateTable
CREATE TABLE "partner_codes" (
    "id" UUID NOT NULL,
    "user_a_id" UUID NOT NULL,
    "user_b_id" UUID NOT NULL,
    "codes" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "partner_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "reporter_id" UUID,
    "reported_id" UUID,
    "match_id" UUID,
    "reason" "report_reason" NOT NULL,
    "text" VARCHAR(500),
    "status" "report_status" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(3),

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocks" (
    "id" UUID NOT NULL,
    "blocker_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_provider_provider_subject_key" ON "users"("provider", "provider_subject");

-- CreateIndex
CREATE INDEX "matches_ended_at_id_idx" ON "matches"("ended_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "match_players_user_id_match_id_idx" ON "match_players"("user_id", "match_id");

-- CreateIndex
CREATE INDEX "partner_codes_user_b_id_idx" ON "partner_codes"("user_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "partner_codes_user_a_id_user_b_id_key" ON "partner_codes"("user_a_id", "user_b_id");

-- CreateIndex
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "reports_reported_id_created_at_idx" ON "reports"("reported_id", "created_at");

-- CreateIndex
CREATE INDEX "reports_reporter_id_created_at_idx" ON "reports"("reporter_id", "created_at");

-- CreateIndex
CREATE INDEX "reports_match_id_idx" ON "reports"("match_id");

-- CreateIndex
CREATE INDEX "blocks_blocked_id_idx" ON "blocks"("blocked_id");

-- CreateIndex
CREATE UNIQUE INDEX "blocks_blocker_id_blocked_id_key" ON "blocks"("blocker_id", "blocked_id");

-- AddForeignKey
ALTER TABLE "avatars" ADD CONSTRAINT "avatars_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_codes" ADD CONSTRAINT "partner_codes_user_a_id_fkey" FOREIGN KEY ("user_a_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_codes" ADD CONSTRAINT "partner_codes_user_b_id_fkey" FOREIGN KEY ("user_b_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reported_id_fkey" FOREIGN KEY ("reported_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- EDITADO À MÃO: regras que o Prisma não expressa. Não remover ao gerar novas migrações.
-- ===========================================================================

-- users: apelido de 3 a 16 caracteres, sem espaços nas pontas, e único sem diferenciar caixa.
ALTER TABLE "users" ADD CONSTRAINT "users_nickname_length_check"
  CHECK (char_length("nickname") BETWEEN 3 AND 16 AND "nickname" = btrim("nickname"));
ALTER TABLE "users" ADD CONSTRAINT "users_provider_subject_check"
  CHECK (char_length("provider_subject") BETWEEN 1 AND 255);
CREATE UNIQUE INDEX "users_nickname_lower_key" ON "users" (lower("nickname"));

-- avatars: AvatarParts é um objeto JSON.
ALTER TABLE "avatars" ADD CONSTRAINT "avatars_parts_object_check"
  CHECK (jsonb_typeof("parts") = 'object');

-- matches: semente uint32; events/games são arrays; status coerente com o vencedor;
-- fim não anterior ao início.
ALTER TABLE "matches" ADD CONSTRAINT "matches_seed_check"
  CHECK ("seed" BETWEEN 0 AND 4294967295);
ALTER TABLE "matches" ADD CONSTRAINT "matches_events_array_check"
  CHECK (jsonb_typeof("events") = 'array');
ALTER TABLE "matches" ADD CONSTRAINT "matches_games_array_check"
  CHECK (jsonb_typeof("games") = 'array');
ALTER TABLE "matches" ADD CONSTRAINT "matches_deals_array_check"
  CHECK ("deals" IS NULL OR jsonb_typeof("deals") = 'array');
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_team_check"
  CHECK ("winner_team" IN (0, 1));
ALTER TABLE "matches" ADD CONSTRAINT "matches_status_winner_check"
  CHECK (("status" = 'finished') = ("winner_team" IS NOT NULL));
ALTER TABLE "matches" ADD CONSTRAINT "matches_period_check"
  CHECK ("ended_at" >= "started_at");

-- match_players: mesa de 4 (assentos 0..3; a Fase 8 amplia o limite para 5 trocando este CHECK),
-- dupla = assento % 2, bot_from é um seq não negativo.
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_seat_check"
  CHECK ("seat" BETWEEN 0 AND 3);
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_team_check"
  CHECK ("team" IN (0, 1) AND "team" = "seat" % 2);
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_bot_from_check"
  CHECK ("bot_from" IS NULL OR "bot_from" >= 0);

-- partner_codes: forma canônica do par (a < b) e codes é um objeto JSON.
ALTER TABLE "partner_codes" ADD CONSTRAINT "partner_codes_ordered_pair_check"
  CHECK ("user_a_id" < "user_b_id");
ALTER TABLE "partner_codes" ADD CONSTRAINT "partner_codes_codes_object_check"
  CHECK (jsonb_typeof("codes") = 'object');

-- reports: não denunciar a si mesmo (quando ambos ainda existem).
ALTER TABLE "reports" ADD CONSTRAINT "reports_not_self_check"
  CHECK ("reporter_id" IS NULL OR "reported_id" IS NULL OR "reporter_id" <> "reported_id");
ALTER TABLE "reports" ADD CONSTRAINT "reports_text_length_check"
  CHECK ("text" IS NULL OR char_length("text") <= 500);

-- blocks: ninguém bloqueia a si mesmo.
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_not_self_check"
  CHECK ("blocker_id" <> "blocked_id");

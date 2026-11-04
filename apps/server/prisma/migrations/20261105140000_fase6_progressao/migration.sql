-- ===========================================================================
-- Fase 6, bloco 6C: progressão (conquistas, missões, estatísticas) e vínculo de conta.
-- ADITIVA: só tabelas novas e uma coluna anulável em `users`; nenhum dado existente é lido, alterado ou
-- apagado. O catálogo de conquistas e missões fica em código (@trucaco/protocol), sem tabelas de catálogo
-- (docs/adr/0009). Todas as FKs para `users` são ON DELETE CASCADE (apagar conta leva a progressão junto).
-- As linhas "CHECK" abaixo são EDITADAS À MÃO (o Prisma não as expressa); o `migrate diff` não as vê.
-- Rollback (reversível, só perde a progressão gravada depois): DROP TABLE progression_applied, user_stats,
-- user_missions, user_achievements; ALTER TABLE users DROP COLUMN linked_at.
-- ===========================================================================


-- AlterTable
ALTER TABLE "users" ADD COLUMN     "linked_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "user_achievements" (
    "user_id" UUID NOT NULL,
    "achievement_id" VARCHAR(40) NOT NULL,
    "level" SMALLINT NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "unlocked_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("user_id","achievement_id")
);

-- CreateTable
CREATE TABLE "user_missions" (
    "user_id" UUID NOT NULL,
    "mission_id" VARCHAR(40) NOT NULL,
    "period_key" VARCHAR(16) NOT NULL,
    "target" INTEGER NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "user_missions_pkey" PRIMARY KEY ("user_id","mission_id","period_key")
);

-- CreateTable
CREATE TABLE "user_stats" (
    "user_id" UUID NOT NULL,
    "variant" "variant" NOT NULL,
    "played" INTEGER NOT NULL DEFAULT 0,
    "won" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_stats_pkey" PRIMARY KEY ("user_id","variant")
);

-- CreateTable
CREATE TABLE "progression_applied" (
    "match_id" UUID NOT NULL,
    "applied_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progression_applied_pkey" PRIMARY KEY ("match_id")
);

-- CreateIndex
CREATE INDEX "user_missions_user_id_period_key_idx" ON "user_missions"("user_id", "period_key");

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_missions" ADD CONSTRAINT "user_missions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progression_applied" ADD CONSTRAINT "progression_applied_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- EDITADO À MÃO: CHECKs de integridade
-- ===========================================================================

-- Ids do catálogo: só texto não vazio (a validade contra o catálogo é do repositório).
ALTER TABLE "user_achievements"
  ADD CONSTRAINT "user_achievements_id_check" CHECK (char_length("achievement_id") >= 1),
  ADD CONSTRAINT "user_achievements_progress_check" CHECK ("progress" >= 0),
  ADD CONSTRAINT "user_achievements_level_check" CHECK ("level" >= 0),
  -- Nível > 0 <=> desbloqueada (unlocked_at preenchido).
  ADD CONSTRAINT "user_achievements_unlock_check" CHECK (("level" = 0) = ("unlocked_at" IS NULL));

ALTER TABLE "user_missions"
  ADD CONSTRAINT "user_missions_id_check" CHECK (char_length("mission_id") >= 1),
  ADD CONSTRAINT "user_missions_target_check" CHECK ("target" > 0),
  ADD CONSTRAINT "user_missions_progress_check" CHECK ("progress" >= 0 AND "progress" <= "target"),
  -- '2026-11-04' (diária) ou '2026-W45' (semanal): 8 a 10 caracteres, formato fixo.
  ADD CONSTRAINT "user_missions_period_key_length_check" CHECK (char_length("period_key") BETWEEN 8 AND 10),
  ADD CONSTRAINT "user_missions_period_key_format_check"
    CHECK ("period_key" ~ '^[0-9]{4}-(W[0-9]{2}|[0-9]{2}-[0-9]{2})$');

ALTER TABLE "user_stats"
  ADD CONSTRAINT "user_stats_won_check" CHECK ("won" >= 0),
  ADD CONSTRAINT "user_stats_played_check" CHECK ("played" >= "won");

-- ===========================================================================
-- Auditoria 6I: uma denúncia por (denunciante, denunciado, partida).
-- Só um índice único novo. Antes dele, remove duplicatas EXATAS (mesmo trio com partida preenchida, que a
-- checagem da aplicação, não atômica, podia deixar escapar numa corrida), mantendo a mais antiga. Linhas
-- com qualquer coluna NULL (denúncia sem partida, anonimizadas) nunca colidem e não são tocadas.
-- Também: `reports.throttled` (denúncia gravada acima do teto por denunciado/hora) e
-- `progression_applied.scored` (false = a partida só contou em user_stats; o anti-farm barrou conquistas e
-- missões). Linhas existentes: throttled = false, scored = true.
-- Rollback: DROP INDEX "reports_reporter_id_reported_id_match_id_key"; ALTER TABLE reports DROP COLUMN throttled;
-- ALTER TABLE progression_applied DROP COLUMN scored;
-- ===========================================================================

DELETE FROM "reports" r
 USING "reports" k
 WHERE r."reporter_id" = k."reporter_id"
   AND r."reported_id" = k."reported_id"
   AND r."match_id" = k."match_id"
   AND (k."created_at", k."id") < (r."created_at", r."id");

-- CreateIndex
CREATE UNIQUE INDEX "reports_reporter_id_reported_id_match_id_key" ON "reports"("reporter_id", "reported_id", "match_id");

-- AlterTable
ALTER TABLE "reports" ADD COLUMN "throttled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "progression_applied" ADD COLUMN "scored" BOOLEAN NOT NULL DEFAULT true;

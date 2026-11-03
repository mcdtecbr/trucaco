-- ===========================================================================
-- Migração escrita à mão (sem alteração de schema.prisma): dados.
-- ADR 0003: `accessory` passa de 5 para 3 variantes (0 nenhum, 1 bigode, 2 brinco); os óculos e o
-- boné de acessório saem do catálogo para o avatar seguir o `assets/rive/avatar.riv`.
-- `parseAvatarParts` recusa o avatar INTEIRO se uma parte estiver fora do intervalo, então perfis
-- gravados com accessory 3 ou 4 perderiam todas as partes. Esta migração leva só o acessório a 0
-- e preserva o resto. Idempotente: rodar de novo não altera nada.
-- ===========================================================================
UPDATE "avatars"
   SET "parts" = jsonb_set("parts", '{accessory}', '0'::jsonb)
 WHERE CASE WHEN jsonb_typeof("parts" -> 'accessory') = 'number'
             THEN ("parts" ->> 'accessory')::numeric >= 3
             ELSE false END;

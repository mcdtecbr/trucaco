-- ===========================================================================
-- Migração escrita à mão (sem alteração de schema.prisma): dados.
-- Ampliação do catálogo do avatar, fatia 1 (cores): `skin` cresce de 6 para 8 (intervalo maior, nada a
-- migrar) e entram três chaves obrigatórias no fim de AvatarParts: `hair_color`, `eye_color` e
-- `outfit_color`. `parseAvatarParts` recusa o avatar INTEIRO quando falta chave, então os perfis já
-- gravados precisam recebê-las. Índice 0 de cada cor preserva o visual atual (cabelo '#2B1B12', pupila
-- '#1B1B1F'); `outfit_color` copia o índice de `outfit`, porque as 6 primeiras cores de roupa são as
-- cores principais atuais, na mesma ordem. Idempotente: só preenche a chave que falta.
-- ===========================================================================
UPDATE "avatars"
   SET "parts" = "parts"
     || CASE WHEN "parts" ? 'hair_color' THEN '{}'::jsonb ELSE '{"hair_color":0}'::jsonb END
     || CASE WHEN "parts" ? 'eye_color' THEN '{}'::jsonb ELSE '{"eye_color":0}'::jsonb END
     || CASE WHEN "parts" ? 'outfit_color' THEN '{}'::jsonb
             ELSE jsonb_build_object(
                    'outfit_color',
                    CASE WHEN jsonb_typeof("parts" -> 'outfit') = 'number'
                              AND ("parts" ->> 'outfit')::numeric BETWEEN 0 AND 5
                         THEN "parts" -> 'outfit'
                         ELSE '0'::jsonb END)
        END
 WHERE jsonb_typeof("parts") = 'object'
   AND NOT ("parts" ? 'hair_color' AND "parts" ? 'eye_color' AND "parts" ? 'outfit_color');

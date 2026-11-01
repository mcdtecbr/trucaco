-- ===========================================================================
-- Migração escrita à mão (sem alteração de schema.prisma): endurece regras que o Prisma não expressa.
-- Não remover ao gerar novas migrações.
-- Pré-requisitos: Postgres 13+ (normalize()), banco com encoding UTF8 e locale UTF-8 (lower() do
-- índice users_nickname_lower_key precisa dobrar caixa de letras acentuadas).
-- Se já existirem apelidos fora da política, o ADD CONSTRAINT falha e a migração inteira reverte;
-- corrija os dados e reaplique.
-- ===========================================================================

-- users.nickname: política de apelido.
--   * NFC obrigatório (forma única para o mesmo texto; recusa "o" + acento combinante).
--   * Só letras LATINAS (Latin-1 e Latin Extended-A/B: U+00C0-U+024F, sem × U+00D7 e ÷ U+00F7),
--     dígitos, "_", "." e "-". Sem espaço, tab, controle, zero-width, bidi nem outros alfabetos.
--   * 3 a 16 caracteres (users_nickname_length_check, da init, continua valendo).
-- O mesmo conjunto está em apps/server/src/db/validation.ts (NICKNAME_PATTERN).
ALTER TABLE "users" ADD CONSTRAINT "users_nickname_nfc_check"
  CHECK (normalize("nickname", NFC) = "nickname");
ALTER TABLE "users" ADD CONSTRAINT "users_nickname_charset_check"
  CHECK ("nickname" ~ '^[0-9A-Za-z_.À-ÖØ-öø-ɏ-]+$');

-- Tetos de tamanho dos jsonb (pg_column_size do valor ainda não comprimido). Uma linha não deve
-- crescer sem limite por uma entrada hostil; a validação fina é da aplicação.
ALTER TABLE "avatars" ADD CONSTRAINT "avatars_parts_size_check"
  CHECK (pg_column_size("parts") < 16384);
ALTER TABLE "partner_codes" ADD CONSTRAINT "partner_codes_codes_size_check"
  CHECK (pg_column_size("codes") < 16384);
ALTER TABLE "matches" ADD CONSTRAINT "matches_options_size_check"
  CHECK (pg_column_size("options") < 16384);
ALTER TABLE "matches" ADD CONSTRAINT "matches_games_size_check"
  CHECK (pg_column_size("games") < 65536);
ALTER TABLE "matches" ADD CONSTRAINT "matches_deals_size_check"
  CHECK ("deals" IS NULL OR pg_column_size("deals") < 1048576);
ALTER TABLE "matches" ADD CONSTRAINT "matches_events_size_check"
  CHECK (pg_column_size("events") < 2097152);

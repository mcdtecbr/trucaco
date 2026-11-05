-- Fase 7 (7A): esqueleto do apelido contra imitação por letra parecida.
-- A expressão é a MESMA do `nicknameSkeleton` (apps/server/src/db/validation.ts): letras de Latin
-- Extended parecidas com ASCII viram a letra ASCII, `I` vira `l`, `0` vira `o`, tudo em minúsculas.
-- `translate` e `lower` são IMMUTABLE, então servem a um índice de expressão. Um teste confere que este
-- arquivo traz exatamente as tabelas do TypeScript.
--
-- Colisões que já existem: nenhum usuário é apagado. O mais antigo de cada grupo (created_at, id) mantém o
-- apelido; os demais recebem 'Jogador' + 8 hex do id (15 caracteres, dentro da política), e o jogador
-- pode trocar em PUT /me. Rollback: DROP INDEX users_nickname_skeleton_key.

WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY lower(translate(nickname, 'ĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžƠơƯưǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛǜǞǟǠǡǦǧǨǩǪǫǬǭǰǴǵǸǹǺǻȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧȨȩȪȫȬȭȮȯȰȱȲȳıłŁđĐħĦŧŦøØƒǥǤƀǀȷŀĿƚɉɈſĸƖI0', 'AaAaAaCcCcCcCcDdEeEeEeEeEeGgGgGgGgHhlililililJjKkLlLlLlNnNnNnOoOoOoRrRrRrSsSsSsSsTtTtUuUuUuUuUuUuWwYyYZzZzZzOoUuAaliOoUuUuUuUuUuAaAaGgKkOoOojGgNnAaAaAaEeEeliliOoOoRrRrUuUuSsTtHhAaEeOoOoOoOoYyilLdDhHtToOfgGbljlLljJskllo')) ORDER BY created_at, id) AS rn
  FROM users
)
UPDATE users u
SET nickname = 'Jogador' || substr(md5(u.id::text), 1, 8)
FROM ranked r
WHERE r.id = u.id AND r.rn > 1;

CREATE UNIQUE INDEX users_nickname_skeleton_key ON users ((lower(translate(nickname, 'ĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžƠơƯưǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛǜǞǟǠǡǦǧǨǩǪǫǬǭǰǴǵǸǹǺǻȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧȨȩȪȫȬȭȮȯȰȱȲȳıłŁđĐħĦŧŦøØƒǥǤƀǀȷŀĿƚɉɈſĸƖI0', 'AaAaAaCcCcCcCcDdEeEeEeEeEeGgGgGgGgHhlililililJjKkLlLlLlNnNnNnOoOoOoRrRrRrSsSsSsSsTtTtUuUuUuUuUuUuWwYyYZzZzZzOoUuAaliOoUuUuUuUuUuAaAaGgKkOoOojGgNnAaAaAaEeEeliliOoOoRrRrUuUuSsTtHhAaEeOoOoOoOoYyilLdDhHtToOfgGbljlLljJskllo'))));

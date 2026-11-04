# 0007: cabelo (19), barba (5) e chapéu (11) seguem as pranchas e os avatares salvos são apagados de novo

- Status: aceita (Fatia 4 de 5 da ampliação do catálogo)
- Data: 2026-11-05
- Relacionada: ADR 0004, 0005, 0006

## Decisão

1. `hair` passa de 8 para **19 formatos**, na ordem das pranchas (esquerda para a direita, cima para baixo), **sem as repetições que só mudam de cor** (a cor vem de `hair_color`). Índice 0 = careca. Boné e chapéu **saem de `hair`**.
2. Duas dimensões novas ao fim de `AVATAR_PART_KEYS`, depois de `nose`: `beard` (5: sem barba, barba cheia, sombra de barba, cavanhaque com bigode, cavanhaque; cor = `hair_color`) e `hat` (11: nenhum e os 10 chapéus e bonés da prancha, **cada um com a sua cor**; não existe `hat_color`). Total de 15 Numbers. `accessory` não muda (nenhum, bigode, brinco). `PROTOCOL_VERSION` 5.
3. Camadas: cabelo de trás na camada 2 (`hair_<n>_back`), barba na 4 (logo depois do rosto, para a boca, o nariz e o bigode ficarem por cima), cabelo da frente na 7 (`hair_<n>_front`) e chapéu na 7 depois do cabelo (`hat_<n>_<papel>`).
4. **Chapéu esconde o cabelo da frente e do topo.** Com `hat != 0` somem todas as peças de frente do cabelo (`hair_<n>_front`, `hair_16_cap`, `hair_16_bun`, `hair_bald_shade`; no código `Part.hideWithHat`) e, do cabelo de trás, o cacheado e o afro (`hair_3_back`, `hair_8_back`, volume acima da cabeça). Ficam só os de trás dos longos (`hair_<n>_back`, que começam em y 92, abaixo da copa), então o chapéu assenta direto na cabeça, como um boné real, e a copa cobre o topo sem cabelo vazando. No Rive isso é um grupo-embrulho `hair_front` (filho dos nós de frente, mais `hair_3_back` e `hair_8_back`) cuja opacidade é chaveada pelas timelines `hat_*`, na layer `hat` (hat 0 = 100%, hat 1..10 = 0%), sem conflito com as timelines de `hair`, que continuam escolhendo o formato dentro do grupo.
5. **Sem compatibilidade**: migração `20261105130000_avatar_cabelo` faz `DELETE FROM "avatars"`, como a da fatia 3. Sem avatar, `GET /me` devolve `avatar: null` e o cliente usa `DEFAULT_AVATAR_PARTS`.
6. Orçamento de vértices do `art.ts` de 760 para 1300 (175 paths, 1210 vértices).

7. **Cabelos 2 (longo ondulado) e 14 (longo liso) não aceitam chapéu** (decisão do usuário). `HAIR_WITHOUT_HAT = [2, 14]` e `isHatAllowed(hair, hat)` ficam em `packages/protocol`; `parseAvatarParts` rejeita `hair` 2 ou 14 com `hat != 0` (mesmo `INVALID_AVATAR` das outras violações do catálogo, no `PUT /me/avatar` e em toda leitura de avatar gravado). O editor do mobile zera o chapéu ao escolher esses cabelos e deixa as opções de chapéu (menos "Sem chapéu") desabilitadas com a dica "Este cabelo não combina com chapéu". O desenho é defensivo: se chegar essa combinação, `art.ts` e o fallback ignoram o chapéu (`effectiveCfg`). **O `.riv` não precisa tratar a regra**: a combinação não ocorre, então basta o chaveamento de `hair_front` pela layer `hat`. Não há sorteio de avatar no servidor.

## Mapa de índices

- `hair`: 0 careca, 1 espetado, 2 longo ondulado, 3 cacheado, 4 coque alto, 5 longo com franja, 6 ondulado médio, 7 topete lateral, 8 afro, 9 pixie, 10 repicado, 11 bob de lado, 12 longo de lado, 13 ondulado curto, 14 longo liso, 15 bob repicado, 16 coque, 17 bob com franja, 18 raspado.
- `beard`: 0 sem barba, 1 cheia, 2 sombra, 3 cavanhaque com bigode, 4 cavanhaque.
- `hat`: 0 nenhum, 1 boné azul, 2 boné vermelho, 3 boné preto, 4 chapéu de palha, 5 boné vermelho de lado, 6 gorro azul com pompom, 7 gorro vermelho canelado, 8 fedora, 9 chapéu de pescador, 10 boné preto e vermelho.

## Estado do `.riv` (05/11/2026)

- `assets/rive/avatar.riv` reexportado: 58.135 bytes, 15 Numbers, 16 triggers. Validado no runtime web (`@rive-app/canvas` 2.21.6): `hair` 0 a 18 com `hair_color` 0 a 7; `beard` 0 a 4 com a cor do cabelo; `hat` 0 a 10 com o cabelo da frente sumindo e o de trás permanecendo.
- Estrutura montada em `docs/avatar-rig.md` (seção 3.1); lições e pendências em `docs/avatar-rive-estado.md` (Fatia 4).
- `rivFile.test.ts` confere os 15 Numbers e as animações `hair_18`, `beard_4` e `hat_10`; não há mais `it.todo`.

## Pendências

- `eye_color` pode ter o mesmo defeito que `hair_color` (sem transição Any State → `eye_color_0`): não verificado no runtime.
- Franjas dos cabelos 1, 5, 7, 10 e 17 cobrem parte das sobrancelhas (geometria do SVG de origem).
- Cabelo 18 (raspado, opacidade 50%) parece cinza claro no `.riv`.
- Chapéu 6 passa um pouco do topo do artboard.
- Aparelho iOS/Android não testado.
- Das 24 amostras de cabelo das pranchas, 5 ficaram de fora por repetirem a forma de outra, só em outra cor ou comprimento parecido: espetado preto (3ª linha), longo liso cinza, longo com franja degradê, grisalho ondulado curto e bob azul (os 19 restantes, mais a careca, fecham os 19 de `hair`).
- Tranças (a 24ª amostra) foram removidas por decisão do usuário: `hair` tem 19 opções e o raspado é o 18.
- Desenho vetorial plano, aproximado das pranchas (sem mechas internas nem degradê); o chapéu de lado (5) e o preto e vermelho (10) são vistos de frente com a aba para o lado, sem a perspectiva da prancha.

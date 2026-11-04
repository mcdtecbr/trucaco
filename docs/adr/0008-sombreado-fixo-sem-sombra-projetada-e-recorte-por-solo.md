# 0008: sombreado fixo (sem sombra projetada) e recorte por Solo no Rive

- Status: aceita (Fatia 5 de 5 da ampliação do catálogo)
- Data: 2026-11-04
- Relacionada: ADR 0003, 0004, 0007

## Contexto

A fatia 5 era opcional no ADR 0004: sombreado para dar volume ao rosto sem criar dimensão nova. O rosto e o cabelo das pranchas são planos; sem sombra, os avatares ficam chapados a 64 px.

## Decisão

1. **Sombreado fixo.** Sete formas translúcidas (`shade_jaw_soft`, `shade_jaw`, `shade_cheek_l`, `shade_cheek_r`, `shade_beard_neck`, `shade_bald_gloss`, `shade_hair_gloss`) com opacidade e cor definidas em `packages/avatar/src/art.ts`. Não há input novo, nem dimensão nova, nem migração, e `PROTOCOL_VERSION` continua 5.
2. **Sem sombra projetada.** Não há sombra que acompanhe a posição da cabeça ou do sinal. O volume vem só das formas fixas.
3. **Cor derivada da pele.** `shade` é a sombra da pele já existente; `deep` e `blush` são misturas dela com cores fixas (ver `docs/avatar-rig.md`, seção 3.2).
4. **Recorte por forma de rosto e de cabelo.** Mandíbula (dois degraus, meia-elipse inferior) e brilho do careca são recortados pelo rosto escolhido (as bochechas não são recortadas); o brilho do cabelo, pelo cabelo escolhido. No Rive o recorte é o Solo inteiro (`faces3` e `cabelo4a`), não o path de cada variante; o fallback usa `ClipPath` com o path exato. Como um Solo renderiza só o filho ativo, o resultado no Rive é o mesmo (ver Consequências e `docs/avatar-rig.md`, seção 3.2).
5. Os nomes dos nós são contrato, como nas fatias anteriores.

## Alternativas

- **Sombra projetada:** não entrou (decisão do usuário, fatia 5: sombreado fixo).
- **Sombreado como dimensão própria** (um Number para escolher o nível de sombra): não entrou. Acrescentaria dimensão nova ao catálogo e exigiria migração.
- **Recorte pelo path exato de cada variante no Rive:** não foi o caminho montado. O Clipping Shape aceita Solo como fonte, e o recorte foi feito assim; o path exato fica só no fallback.

## Consequências

- O `.riv` tem os mesmos 16 triggers e 15 Numbers da fatia 4; o arquivo sobe para 60.606 bytes. Depois da correção visual de 04/11/2026 (`fix/avatar-pendencias`), o arquivo está em 60.502 bytes; a decisão não muda (ver `docs/avatar-rive-estado.md`).
- Combinações de cabelo e rosto precisam ser conferidas no runtime. Parte da matriz foi vista só no runtime web, não no editor (ver `docs/avatar-rive-estado.md`, fatia 5).
- Atualização (04/11/2026): a suspeita de divergência no recorte do brilho do cabelo foi verificada e descartada. Um Solo renderiza só o filho ativo, então o brilho do cabelo no Rive não vaza para a pele em nenhum formato de `hair` (0 a 18). Não há divergência de recorte entre o Rive e o fallback neste ponto.
- Dependência do `react-native-svg` com `ClipPath` no nativo: não testada em aparelho.
- Sem sombra projetada, qualquer mudança de iluminação futura exigirá nova decisão e nova fatia.

# 0006: rosto (formato, olhos, sobrancelhas, nariz) segue as pranchas e os avatares salvos são apagados

- Status: aceita (Fatia 3 de 5 da ampliação do catálogo)
- Data: 2026-11-05
- Relacionada: ADR 0003, 0004, 0005

## Decisão

1. `face_shape` 6, `eyes` 6, e duas dimensões novas ao fim de `AVATAR_PART_KEYS`: `brows` 4 e `nose` 8 (13 Numbers). `PROTOCOL_VERSION` 4.
2. Os índices seguem a **ordem das pranchas de referência** (IA, não versionadas), sem manter o desenho antigo: rostos = 1ª linha da prancha 18 (oval alto, redondo, quadrado, coração, queixo em V, longo); olhos = estilos da prancha 17 de cima para baixo (amendoado com delineador, aberto com pálpebra marcada, redondo liso, arregalado com cílios, grande com brilho, cílios longos); sobrancelhas = arco grosso, inclinada para baixo, inclinada para cima, arco fino; narizes = os 8 primeiros de frente das duas fileiras.
3. Cada olho tem branco, íris (`eye_color`), miolo e pálpebra/cílios (o 4 também brilho); o piscar e o `wink` continuam sendo `scaleY` do grupo do olho.
4. **Sem compatibilidade**: a migração `20261105120000_avatar_rosto` faz `DELETE FROM "avatars"`. `avatars` só tem FK para `users`; sem avatar, `GET /me` devolve `avatar: null` e o cliente usa `DEFAULT_AVATAR_PARTS`. `HAIR_COLOR` removido (sem uso em `packages` nem `apps`).
5. Orçamento de vértices do `art.ts` de 420 para 760 (122 paths, 725 vértices; cerca de 13 KB a mais no `.riv`, de 25,8 KB para 38,5 KB).

## Pendências

- Resolvida: `.riv` reexportado (38.546 bytes, 13 Numbers, 16 triggers, validado no runtime web) e `rivFile.test.ts` sem `it.todo`, conferindo os 13 Numbers e as animações da fatia.
- Os narizes são silhuetas aproximadas das pranchas (sem sombreado interno); olhos e sobrancelhas são redesenho vetorial plano, não cópia.
- Nariz sem o Multiply 70% e Feather 5 do desenho anterior (preenchimento sólido da sombra da pele). Ajustes de pescoço e sombra da fatia 1 seguem só no Rive, fora do `art.ts`.

# assets/audio

Áudio do Trucaço. **Hoje todos os arquivos são placeholders** (tom curto e baixo gerado por script, sem direitos de terceiros). O sistema inteiro (eventos, takes, legendas, manifesto) já funciona com eles; a voz e os efeitos finais entram trocando arquivos, sem mudar código.

## Estrutura

```
assets/audio/
  voices/<voiceId>/<evento>_<n>.m4a   # masc_1, fem_1 (as demais, até masc_5 e fem_4, ainda sem arquivo)
  sfx/<id>.m4a                        # 8 efeitos do painel + 4 efeitos de jogo locais
```

O catálogo (ids, textos de cada take, vozes com arquivo, ids de efeitos) fica em `packages/avatar/src/audioCatalog.json`. O texto de cada take é a legenda do balão e o roteiro da gravação (tabela em `docs/audio.md`).

## Formato

Mono, AAC `.m4a`, cerca de 1 s por fala. Orçamento: até 1 MB por voz completa e 1 MB de efeitos (conferido por `packages/avatar/src/audioFiles.test.ts`).

## Como trocar pelos arquivos finais

1. Grave ou gere cada take com o texto do catálogo e salve com o **mesmo nome** (`voices/masc_1/truco_1.m4a`). Normalize o volume e exporte mono AAC.
2. Para uma voz com id já reservado em `VOICE_IDS` (`masc_2` a `masc_5`, `fem_2` a `fem_4`): crie `voices/<voiceId>/` com todos os takes e acrescente o id em `voicesWithFiles` no `audioCatalog.json`.
3. Para um take novo: acrescente `{ "id": "<evento>_<n>", "text": "..." }` ao evento no `audioCatalog.json` (ids antigos nunca são renomeados) e grave o arquivo para **toda** voz com arquivos.
4. Registre fonte e licença em `LICENSES.md`. Sem licença comercial confirmada, não versione o arquivo (o repositório é público).
5. Regere o manifesto e rode os testes: `node scripts/audio/gen-manifest.mjs`, depois `pnpm --filter @trucaco/avatar test`.

`node scripts/audio/gen-placeholders.mjs` recria os placeholders que faltam (precisa de `ffmpeg` no PATH); só sobrescreve arquivo existente com `--force`.

## Manifesto (como o cliente consome)

`packages/avatar/src/audioManifest.ts` é **gerado** e versionado: um `require()` estático por arquivo (o Metro só empacota asset assim). Ele não sai do `index` do pacote, para o Node e o Vitest não tentarem carregar `.m4a`. O cliente Expo importa o subcaminho:

```ts
import { VOICE_AUDIO, SFX_AUDIO } from '@trucaco/avatar/audio';
const source = VOICE_AUDIO[resolveVoice(parts.voice) ?? 'masc_1']?.[take.id]; // take.id vem de pickTake
const horn = SFX_AUDIO.horn;
```

Os testes não importam o manifesto: leem o arquivo como texto e conferem o disco.

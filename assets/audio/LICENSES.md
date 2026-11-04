# Licenças do áudio

Regra: nenhum áudio entra no repositório sem fonte e licença comercial registradas aqui. O repositório é público no início.

## Arquivos presentes

| Arquivo ou grupo                                                                                 | Origem                                                                             | Licença                                                        |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `voices/masc_1/*.m4a`, `voices/fem_1/*.m4a` (46 takes por voz)                                   | Placeholder: tom senoidal gerado por `scripts/audio/gen-placeholders.mjs` (ffmpeg) | Sem direitos de terceiros (sinal sintético do próprio projeto) |
| `sfx/*.m4a` (8 do painel e 4 de jogo: `card_play`, `card_shuffle`, `table_slam`, `ambience_bar`) | Placeholder gerado pelo mesmo script                                               | Sem direitos de terceiros                                      |

Os placeholders não contêm fala nem som de terceiros. Serão substituídos antes da Fase 7.

## Textos das falas

Os textos (legenda e roteiro de gravação) são do projeto. O repertório de truco, seis, nove, doze e provocações veio do usuário; as 6 falas de `corro` foram criadas para o projeto. As falas da `rai-avatar` além do repertório (oito, dez, quero, mão especial, mão de ferro, vitórias) e "Meio pau!" em `seis` aguardam revisão do usuário antes da gravação. O texto de cada take está em `packages/avatar/src/audioCatalog.json`.

## A definir (decisão do usuário)

| Item                                                                                                       | Fonte candidata                                                   | Licença                                           |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------- |
| Vozes `masc_1`, `fem_1` (protótipo): 46 takes cada                                                         | A DEFINIR (ex.: ElevenLabs voice-to-voice, Azure TTS, Google TTS) | A DEFINIR: conferir termos vigentes antes de usar |
| Vozes `masc_2`, `masc_3`, `fem_2`, `fem_3` (lançamento)                                                    | A DEFINIR (gravação contratada ou do time, ou serviço de voz)     | A DEFINIR: conferir termos vigentes antes de usar |
| Efeitos do painel (`horn`, `sad_trombone`, `laugh`, `crowd_ooh`, `rooster`, `rimshot`, `clap`, `crickets`) | A DEFINIR (ex.: Pixabay, Freesound CC0, Envato)                   | A DEFINIR: conferir termos vigentes antes de usar |
| Efeitos de jogo (`card_play`, `card_shuffle`, `table_slam`, `ambience_bar`)                                | A DEFINIR (mesmas candidatas)                                     | A DEFINIR: conferir termos vigentes antes de usar |

Ao incluir um arquivo real: uma linha por arquivo ou grupo com URL da fonte, autor, data de obtenção, licença e a exigência de atribuição (se houver), e remova a linha de placeholder correspondente.

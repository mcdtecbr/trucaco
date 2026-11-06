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

| Item                                                                                                       | Fonte candidata                                                                                                                                                                                                                  | Licença                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Vozes `masc_1`, `fem_1` (protótipo): 46 takes cada                                                         | A DEFINIR (ex.: ElevenLabs voice-to-voice, Azure TTS, Google TTS)                                                                                                                                                                | A DEFINIR: conferir termos vigentes antes de usar                                                                                   |
| Vozes `masc_1` a `masc_5` e `fem_1` a `fem_4` (lançamento)                                                 | Gemini TTS (Google), modelo `gemini-3.8-flash-tts`; vozes por id: `masc_1` Puck, `masc_2` Schedar, `masc_3` Zubenelgenubi, `masc_4` Sadaltager, `masc_5` Fenrir, `fem_1` Autonoe, `fem_2` Aoede, `fem_3` Despina, `fem_4` Zephyr | Uso comercial do áudio gerado **confirmado pelo responsável do projeto em 2026-11-06** (URL e texto dos termos ainda a anexar aqui) |
| Efeitos do painel (`horn`, `sad_trombone`, `laugh`, `crowd_ooh`, `rooster`, `rimshot`, `clap`, `crickets`) | A DEFINIR (ex.: Pixabay, Freesound CC0, Envato)                                                                                                                                                                                  | A DEFINIR: conferir termos vigentes antes de usar                                                                                   |
| Efeitos de jogo (`card_play`, `card_shuffle`, `table_slam`, `ambience_bar`)                                | A DEFINIR (mesmas candidatas)                                                                                                                                                                                                    | A DEFINIR: conferir termos vigentes antes de usar                                                                                   |

Ao incluir um arquivo real: uma linha por arquivo ou grupo com URL da fonte, autor, data de obtenção, licença e a exigência de atribuição (se houver), e remova a linha de placeholder correspondente.

/**
 * Diretor de fala da mesa: traduz eventos públicos de jogo em voz, legenda e efeitos locais.
 * O servidor é a fonte de verdade: o evento só DISPARA o som, nada trafega pela rede e nada aqui decide
 * jogada. A legenda (`onSpeak`) sai SEMPRE, mesmo com "sem som", sem arquivo ou jogador silenciado.
 *
 * Fluxo: `voiceEventForGameEvent` (quem fala e qual evento) -> voz do avatar daquele assento
 * (`avatarPartsOf(...).voice`, padrão `masc_1`) -> `pickTake` (sem repetir o último do assento).
 */
import { pickTake, voiceEventForGameEvent } from '@trucaco/avatar';
import type { GameSfxId, VoiceEvent } from '@trucaco/avatar';
import { SFX_IDS, VARIANT_IDS } from '@trucaco/protocol';
import type { PublicGameEvent, VariantId, VoiceId } from '@trucaco/protocol';
import type { TableViewModel } from '../table/projectTable';
import type { AudioService } from './audioService';

export const DEFAULT_VOICE: VoiceId = 'masc_1';
/** Efeitos de jogo pré-carregados (os que tocam a cada mão). */
export const PRELOAD_SFX_IDS: readonly GameSfxId[] = ['card_shuffle', 'card_play', 'table_slam'];
/** Se o `seriesDecided` não vier logo depois do `gameDecided`, a fala do jogo sai sozinha. */
export const GAME_DECIDED_HOLD_MS = 400;

export interface SpeechLine {
  readonly seat: number;
  readonly event: VoiceEvent;
  readonly takeId: string;
  /** Legenda do balão (texto do take). */
  readonly text: string;
}

export interface SpeechTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SpeechDirectorOptions {
  audio: AudioService;
  getVm(): TableViewModel | null;
  /** Silenciado neste aparelho (por apelido): a voz não toca, a legenda continua. */
  isMuted?(nickname: string): boolean;
  /** Legenda: o controlador mostra o balão grande. */
  onSpeak(line: SpeechLine): void;
  rng?: () => number;
  timers?: SpeechTimers;
}

export interface SpeechDirector {
  /** Evento público de jogo (nunca replay: quem chama filtra). */
  onEvent(e: PublicGameEvent): void;
  /** Cada novo estado: pré-carrega as vozes dos avatares presentes e os efeitos de jogo. */
  onState(vm: TableViewModel): void;
  reset(): void;
}

function variantOf(vm: TableViewModel | null): VariantId {
  const v = vm?.variant;
  return (VARIANT_IDS as readonly string[]).includes(v ?? '') ? (v as VariantId) : 'paulista';
}

export function createSpeechDirector(opts: SpeechDirectorOptions): SpeechDirector {
  const { audio } = opts;
  let funnyPreloaded = false;
  const rng = opts.rng ?? Math.random;
  const timers: SpeechTimers = opts.timers ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  /** Último take por assento (evita repetir a mesma frase em seguida). */
  const lastTake = new Map<number, string>();
  let pendingGame: PublicGameEvent | null = null;
  let pendingTimer: unknown = null;
  let preloadKey = '';

  function voiceOf(vm: TableViewModel | null, seat: number): VoiceId {
    return vm?.seats[seat]?.avatar.voice ?? DEFAULT_VOICE;
  }

  function speak(e: PublicGameEvent): void {
    const vm = opts.getVm();
    const cue = voiceEventForGameEvent(e, {
      variant: variantOf(vm),
      rng,
      seats: Math.max(2, vm?.seats.length ?? 4),
    });
    if (cue === null) return;
    const voice = voiceOf(vm, cue.seat);
    // Prefere take já carregado (só 1 por evento é pré-carregado): o grito nunca espera o arquivo.
    const take = pickTake(cue.event, lastTake.get(cue.seat) ?? null, rng, (id) =>
      audio.isVoiceReady(voice, id),
    );
    lastTake.set(cue.seat, take.id);
    audio.warmEvent(voice, cue.event); // os outros takes do evento chegam para as próximas vezes
    const player = vm?.seats[cue.seat];
    const muted =
      player !== undefined &&
      player.nickname !== '' &&
      !player.isMe &&
      opts.isMuted?.(player.nickname) === true;
    if (!muted) audio.playVoice(voice, take.id);
    opts.onSpeak({ seat: cue.seat, event: cue.event, takeId: take.id, text: take.text });
  }

  function flushGame(): void {
    if (pendingTimer !== null) timers.clearTimeout(pendingTimer);
    pendingTimer = null;
    const g = pendingGame;
    pendingGame = null;
    if (g !== null) speak(g);
  }

  return {
    onEvent(e) {
      // `gameDecided` espera: no último jogo da série vem `seriesDecided` em seguida e só ele fala.
      if (e.type === 'seriesDecided') {
        pendingGame = null;
        if (pendingTimer !== null) timers.clearTimeout(pendingTimer);
        pendingTimer = null;
        // Partida `single` também termina com `seriesDecided`, mas é um jogo só: fala `venceu_jogo`.
        // "Campeões!" (`venceu_serie`) é só da melhor de 3.
        if (opts.getVm()?.series.format === 'bo3') {
          speak(e);
        } else {
          speak({ type: 'gameDecided', winnerTeam: e.winnerTeam, scores: [0, 0] });
        }
        return;
      }
      flushGame();
      switch (e.type) {
        case 'gameDecided':
          pendingGame = e;
          pendingTimer = timers.setTimeout(flushGame, GAME_DECIDED_HOLD_MS);
          return;
        case 'handStarted':
          audio.playSfx('card_shuffle');
          break;
        case 'cardPlayed':
          audio.playSfx('card_play');
          break;
        case 'betCalled':
        case 'betRaised':
          audio.playSfx('table_slam');
          break;
        default:
          break;
      }
      speak(e);
    },

    onState(vm) {
      // Quem está sentado pode mandar (e sempre ouve) os efeitos engraçados: carrega os 8 ao entrar na mesa,
      // para o primeiro toque no painel não criar player nativo (e decodificar) no meio de uma jogada.
      // Silenciados (som geral ou efeitos engraçados) não carregam: ao religar, o próximo estado carrega.
      const prefs = audio.getPrefs();
      if (!funnyPreloaded && vm.mySeat >= 0 && !prefs.muted && !prefs.funnyMuted) {
        funnyPreloaded = true;
        void audio.preloadSfx(SFX_IDS);
      }
      const voices = [...new Set(vm.seats.map((s) => s.avatar.voice ?? DEFAULT_VOICE))].sort();
      const key = voices.join(',');
      if (key === preloadKey) return;
      preloadKey = key;
      void audio.preloadVoices(voices);
      // Efeitos de jogo; os do soundboard carregam acima, para quem está sentado.
      void audio.preloadSfx(PRELOAD_SFX_IDS);
    },

    reset() {
      if (pendingTimer !== null) timers.clearTimeout(pendingTimer);
      pendingTimer = null;
      pendingGame = null;
      lastTake.clear();
      preloadKey = '';
      funnyPreloaded = false;
      audio.release();
    },
  };
}

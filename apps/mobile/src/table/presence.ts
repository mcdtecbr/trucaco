import type { PresenceStatus } from '@trucaco/protocol';

const STATUSES: readonly PresenceStatus[] = ['online', 'away', 'bot'];

export function isPresenceStatus(x: unknown): x is PresenceStatus {
  return typeof x === 'string' && (STATUSES as readonly string[]).includes(x);
}

/** Frase curta para a faixa de aviso e para o leitor de tela. Apelido sempre como texto. */
export function presenceText(nickname: string, isMe: boolean, status: PresenceStatus): string {
  const name = isMe ? 'Você' : nickname !== '' ? nickname : 'Um jogador';
  switch (status) {
    case 'away':
      return isMe ? 'Você está ausente.' : `${name} está ausente.`;
    case 'bot':
      return isMe ? 'Um bot está jogando por você.' : `${name} agora é jogado por um bot.`;
    case 'online':
      return isMe ? 'Você voltou.' : `${name} voltou.`;
  }
}

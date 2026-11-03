/** Montagem pura das props do `CodesPanel` (testável sem React nem `getApp`). */
import { codesErrorMessage } from '../i18n/errors';
import type { TableController } from '../table/tableController';
import type { TableStoreState } from '../table/tableStore';
import type { CodesPanelProps } from './CodesPanel';

export interface CodesSeatInput {
  readonly seat: number;
  readonly nickname: string;
  readonly status: string;
  readonly isBot: boolean;
}

export interface CodesPanelInput {
  codesOpen: boolean;
  codes: TableStoreState['codes'];
  codesError: string | null;
  seats: readonly CodesSeatInput[];
  mySeat: number;
  connected: boolean;
  guest: boolean;
  table: Pick<TableController, 'sendCode' | 'setCodesOpen'>;
}

/** O parceiro (mesma dupla, assento oposto) só conta se for um humano sentado; bot ou vazio = null. */
export function humanPartnerName(seats: readonly CodesSeatInput[], mySeat: number): string | null {
  if (mySeat < 0) return null;
  const p = seats.find((s) => s.seat === (mySeat + 2) % 4);
  if (p === undefined || p.isBot || p.nickname === '') return null;
  if (p.status !== 'connected' && p.status !== 'away') return null;
  return p.nickname;
}

export function buildCodesPanelProps(i: CodesPanelInput): CodesPanelProps | null {
  // Sem assento (espectador/estado parcial) não há dupla: nunca mostra o painel.
  if (!i.codesOpen || i.mySeat < 0) return null;
  return {
    codes: i.codes,
    partnerName: humanPartnerName(i.seats, i.mySeat),
    connected: i.connected,
    guest: i.guest,
    errorText: i.codesError === null ? null : codesErrorMessage(i.codesError),
    on: {
      save: (id, meaning) => i.table.sendCode(id, meaning),
      close: () => i.table.setCodesOpen(false),
    },
  };
}

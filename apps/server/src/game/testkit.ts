/**
 * Utilitário de teste: simula a camada de rede do Colyseus (Encoder + StateView por cliente +
 * Decoder) sem subir sala, espelhando `SchemaSerializer` do @colyseus/core (shared encode + um
 * `encodeView` por cliente, `encodeAllView` no join/reconexão). Não é importado pelo servidor.
 */
import { Decoder, Encoder } from '@colyseus/schema';
import type { Seat } from '@trucaco/rules';
import { TableStateSchema, createSeatView } from './schema';
import type { TableState } from './schema';

import type { StateView } from '@colyseus/schema';

export interface SimClient {
  readonly seat: Seat;
  readonly view: StateView;
  readonly decoder: Decoder<TableState>;
}

function copy(b: Uint8Array): Uint8Array {
  return Uint8Array.from(b);
}

export class WireSim {
  readonly encoder: Encoder<TableState>;
  readonly clients: SimClient[] = [];

  constructor(readonly state: TableState) {
    this.encoder = new Encoder(state);
  }

  /** Bytes que o cliente recebe ao entrar/reconectar (`getFullState`). */
  private fullBytes(view: StateView): Uint8Array {
    const it = { offset: 1 };
    this.encoder.encodeAll(it);
    const shared = it.offset;
    return copy(this.encoder.encodeAllView(view, shared, { offset: shared }));
  }

  /** Conecta um cliente novo no assento: view nova + decoder novo + estado completo. */
  connect(seat: Seat): SimClient {
    const view = createSeatView(this.state, seat);
    const decoder = new Decoder(new TableStateSchema());
    decoder.decode(this.fullBytes(view), { offset: 1 });
    const client: SimClient = { seat, view, decoder };
    this.clients.push(client);
    return client;
  }

  /** Conexão efêmera só para inspecionar o que um recém-chegado/reconectado receberia. */
  snapshotFor(seat: Seat): unknown {
    const view = createSeatView(this.state, seat);
    const decoder = new Decoder(new TableStateSchema());
    decoder.decode(this.fullBytes(view), { offset: 1 });
    view.dispose();
    return decoder.state.toJSON();
  }

  /** Um tick de patch: cada cliente recebe o shared + o seu próprio view. */
  flush(): void {
    const it = { offset: 1 };
    this.encoder.encode(it);
    const shared = it.offset;
    for (const c of this.clients) {
      const bytes = copy(this.encoder.encodeView(c.view, shared, it));
      c.decoder.decode(bytes, { offset: 1 });
    }
    this.encoder.discardChanges();
  }

  /** O que o cliente conectado enxerga agora (JSON do estado decodificado). */
  json(client: SimClient): unknown {
    return client.decoder.state.toJSON();
  }
}

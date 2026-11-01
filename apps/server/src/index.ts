import { PROTOCOL_VERSION } from '@trucaco/protocol';

export interface HealthStatus {
  status: 'ok';
  protocol: number;
}

/** Corpo do endpoint /health. Colyseus, salas e REST entram na Fase 2. */
export function buildHealth(): HealthStatus {
  return { status: 'ok', protocol: PROTOCOL_VERSION };
}

import { PROTOCOL_VERSION } from '@trucaco/protocol';

export interface HealthStatus {
  status: 'ok';
  protocol: number;
}

/** Corpo do endpoint /health. */
export function buildHealth(): HealthStatus {
  return { status: 'ok', protocol: PROTOCOL_VERSION };
}

export { createServer } from './server';
export type { CreateServerOptions, RunningServer } from './server';

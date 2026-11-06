import { PROTOCOL_VERSION } from '@trucaco/protocol';
import type { SocialProvider } from '@trucaco/protocol';

export interface HealthStatus {
  status: 'ok';
  protocol: number;
  /** Provedores de login social ligados (client IDs configurados). */
  socialProviders: SocialProvider[];
}

/** Corpo do endpoint /health. */
export function buildHealth(socialProviders: readonly SocialProvider[] = []): HealthStatus {
  return { status: 'ok', protocol: PROTOCOL_VERSION, socialProviders: [...socialProviders] };
}

export { createServer } from './server';
export type { CreateServerOptions, RunningServer } from './server';

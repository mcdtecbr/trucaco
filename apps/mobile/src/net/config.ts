/** Configuração de rede. Sem segredo: `EXPO_PUBLIC_*` vai para o bundle. */
export const DEFAULT_SERVER_URL = 'http://localhost:2567';

/** Hosts em que HTTP puro é aceito mesmo em produção: loopback e a rede local de dev (10.x). */
function isLocalDevHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
}

function isProductionBuild(): boolean {
  const dev = (globalThis as { __DEV__?: boolean }).__DEV__;
  return process.env.NODE_ENV === 'production' || dev === false;
}

/**
 * URL base do servidor, sem barra final. A leitura literal de `process.env.EXPO_PUBLIC_*` é exigida pelo
 * Expo. Em build de PRODUÇÃO só `https:` é aceito (o `wss:` do WebSocket deriva dela), salvo loopback e
 * 10.x: JWT e refresh nunca trafegam em texto claro por engano de configuração.
 */
export function getServerUrl(): string {
  const raw = process.env.EXPO_PUBLIC_SERVER_URL;
  const url = (raw !== undefined && raw !== '' ? raw : DEFAULT_SERVER_URL).replace(/\/+$/, '');
  if (isProductionBuild()) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('EXPO_PUBLIC_SERVER_URL inválida');
    }
    if (parsed.protocol !== 'https:' && !isLocalDevHost(parsed.hostname)) {
      throw new Error('EXPO_PUBLIC_SERVER_URL deve usar https: em build de produção');
    }
  }
  return url;
}

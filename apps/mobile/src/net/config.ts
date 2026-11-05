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
  const configured = raw !== undefined && raw !== '';
  // Web de produção servido pelo próprio servidor (mesma origem): sem variável, usa a origem da página.
  const pageOrigin = typeof window !== 'undefined' ? window.location?.origin : undefined;
  const sameOrigin =
    !configured && isProductionBuild() && pageOrigin !== undefined && pageOrigin !== 'null';
  const url = (configured ? raw : sameOrigin ? pageOrigin : DEFAULT_SERVER_URL).replace(/\/+$/, '');
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

/**
 * Modo E2E (`EXPO_PUBLIC_E2E=1`): liga a sonda `table-state` da mesa, que os testes usam para esperar
 * por estado. Fora dele a sonda não existe. A leitura literal é exigida pelo Expo.
 */
export function isE2EMode(): boolean {
  return process.env.EXPO_PUBLIC_E2E === '1';
}

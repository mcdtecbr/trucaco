/** Configuração de rede. Sem segredo: `EXPO_PUBLIC_*` vai para o bundle. */
export const DEFAULT_SERVER_URL = 'http://localhost:2567';

/** URL base do servidor, sem barra final. A leitura literal de `process.env.EXPO_PUBLIC_*` é exigida pelo Expo. */
export function getServerUrl(): string {
  const raw = process.env.EXPO_PUBLIC_SERVER_URL;
  const url = raw !== undefined && raw !== '' ? raw : DEFAULT_SERVER_URL;
  return url.replace(/\/+$/, '');
}

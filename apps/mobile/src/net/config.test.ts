import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SERVER_URL, getServerUrl } from './config';

describe('getServerUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it('usa o padrão de dev sem a variável', () => {
    vi.stubEnv('EXPO_PUBLIC_SERVER_URL', '');
    expect(getServerUrl()).toBe(DEFAULT_SERVER_URL);
  });
  it('remove barras finais', () => {
    vi.stubEnv('EXPO_PUBLIC_SERVER_URL', 'https://api.exemplo.com//');
    expect(getServerUrl()).toBe('https://api.exemplo.com');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SERVER_URL, getServerUrl } from './config';

describe('getServerUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it('usa o padrão de dev sem a variável', () => {
    vi.stubEnv('EXPO_PUBLIC_SERVER_URL', '');
    expect(getServerUrl()).toBe(DEFAULT_SERVER_URL);
  });
  it('remove barras finais', () => {
    vi.stubEnv('EXPO_PUBLIC_SERVER_URL', 'https://api.exemplo.com//');
    expect(getServerUrl()).toBe('https://api.exemplo.com');
  });

  describe('build de produção', () => {
    const prod = (url: string) => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('EXPO_PUBLIC_SERVER_URL', url);
    };
    it('aceita https', () => {
      prod('https://api.trucaco.app/');
      expect(getServerUrl()).toBe('https://api.trucaco.app');
    });
    it.each(['http://api.trucaco.app', 'ws://api.trucaco.app', 'http://192.168.0.5:2567', 'lixo'])(
      'recusa %s',
      (url) => {
        prod(url);
        expect(() => getServerUrl()).toThrow('EXPO_PUBLIC_SERVER_URL');
      },
    );
    it.each(['http://localhost:2567', 'http://127.0.0.1:2567', 'http://10.0.2.2:2567'])(
      'mantém exceção de loopback/10.x: %s',
      (url) => {
        prod(url);
        expect(getServerUrl()).toBe(url);
      },
    );
    it('sem a variável, o padrão de dev (localhost) segue permitido', () => {
      prod('');
      expect(getServerUrl()).toBe(DEFAULT_SERVER_URL);
    });
    it('__DEV__ === false também conta como produção', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubGlobal('__DEV__', false);
      vi.stubEnv('EXPO_PUBLIC_SERVER_URL', 'http://api.trucaco.app');
      expect(() => getServerUrl()).toThrow();
    });
  });

  it('em dev aceita http em qualquer host', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('EXPO_PUBLIC_SERVER_URL', 'http://192.168.0.5:2567');
    expect(getServerUrl()).toBe('http://192.168.0.5:2567');
  });
});

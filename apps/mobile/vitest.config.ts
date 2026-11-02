import { resolve } from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';

// React Native roda no Vitest via react-native-web (DOM-less, renderToStaticMarkup).
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      'react-native': 'react-native-web',
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  // `*.int.test.ts` sobe o servidor real: só via `pnpm test:int` (vitest.int.config.ts).
  test: { environment: 'node', exclude: [...configDefaults.exclude, '**/*.int.test.ts'] },
});

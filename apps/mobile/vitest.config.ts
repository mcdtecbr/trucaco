import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// React Native roda no Vitest via react-native-web (DOM-less, renderToStaticMarkup).
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      'react-native': 'react-native-web',
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  test: { environment: 'node' },
});

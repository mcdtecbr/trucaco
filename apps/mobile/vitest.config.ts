import { defineConfig } from 'vitest/config';

// React Native roda no Vitest via react-native-web (DOM-less, renderToStaticMarkup).
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { 'react-native': 'react-native-web' } },
  test: { environment: 'node' },
});

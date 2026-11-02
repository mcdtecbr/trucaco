import { defineConfig } from 'vitest/config';

// Componentes RN rodam no Vitest via react-native-web (sem DOM, renderToStaticMarkup).
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { 'react-native': 'react-native-web' } },
  test: { environment: 'node' },
});

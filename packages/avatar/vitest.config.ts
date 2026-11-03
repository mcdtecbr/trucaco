import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig } from 'vitest/config';

// react-native-svg: no Vitest usa a implementação web (elementos SVG do DOM), sem código nativo.
const require = createRequire(import.meta.url);
const svgWeb = join(
  dirname(require.resolve('react-native-svg/package.json')),
  'lib/module/ReactNativeSVG.web.js',
);

// Componentes RN rodam no Vitest via react-native-web (sem DOM, renderToStaticMarkup).
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    extensions: ['.web.js', '.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
    alias: {
      'react-native-svg': svgWeb,
      '@react-native/assets-registry/registry': join(
        import.meta.dirname,
        'test/assetsRegistryStub.ts',
      ),
      'react-native': 'react-native-web',
    },
  },
  test: { environment: 'node', server: { deps: { inline: [/react-native-svg/] } } },
});

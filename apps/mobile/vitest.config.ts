import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';

// react-native-svg: no Vitest usa a implementação web (elementos SVG do DOM), sem código nativo.
const require = createRequire(import.meta.url);
const svgWeb = join(
  dirname(require.resolve('react-native-svg/package.json')),
  'lib/module/ReactNativeSVG.web.js',
);

// React Native roda no Vitest via react-native-web (DOM-less, renderToStaticMarkup).
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    extensions: ['.web.js', '.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
    alias: {
      'react-native': 'react-native-web',
      'react-native-svg': svgWeb,
      // transitivo do react-native-svg web (só resolve asset numérico, que o avatar não usa)
      '@react-native/assets-registry/registry': resolve(
        import.meta.dirname,
        'shims/assets-registry-stub.js',
      ),
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  // `*.int.test.ts` sobe o servidor real: só via `pnpm test:int` (vitest.int.config.ts).
  // `e2e/` é do Playwright (`*.spec.ts`): só via `pnpm test:e2e`.
  test: {
    environment: 'node',
    exclude: [...configDefaults.exclude, '**/*.int.test.ts', 'e2e/**'],
    server: { deps: { inline: [/react-native-svg/] } },
  },
});

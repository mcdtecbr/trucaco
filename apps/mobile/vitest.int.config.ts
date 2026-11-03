import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig } from 'vitest/config';

const svgWeb = join(
  dirname(createRequire(import.meta.url).resolve('react-native-svg/package.json')),
  'lib/module/ReactNativeSVG.web.js',
);

// Integração contra o servidor REAL (processo `apps/server/dist/main.js`, em memória, sem Redis/Postgres).
// Fora do `pnpm test`: rode `pnpm --filter @trucaco/mobile test:int` (exige `pnpm build` antes).
// A mesa importa `@trucaco/ui` (react-native): no Node vira react-native-web, como no `vitest.config.ts`.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    extensions: ['.web.js', '.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
    alias: {
      'react-native': 'react-native-web',
      'react-native-svg': svgWeb,
      '@react-native/assets-registry/registry': join(
        import.meta.dirname,
        'shims/assets-registry-stub.js',
      ),
    },
  },
  test: {
    environment: 'node',
    server: { deps: { inline: [/react-native-svg/] } },
    include: ['src/**/*.int.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

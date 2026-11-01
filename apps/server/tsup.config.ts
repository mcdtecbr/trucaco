import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Pacotes do workspace são ESM com imports sem extensão: entram no bundle.
  noExternal: [/^@trucaco\//],
});

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const internalImports = (names, message) => ({
  'no-restricted-imports': ['error', { patterns: [{ group: names, message }] }],
});

export default tseslint.config(
  {
    ignores: [
      '**/generated/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/.expo/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  // Fronteiras do monorepo (docs/specs/2026-11-01-trucaco-design.md, seção 3)
  {
    files: ['packages/rules/**/*.ts', 'packages/protocol/**/*.ts'],
    rules: internalImports(
      ['@trucaco/*'],
      'rules e protocol não dependem de nenhum pacote interno.',
    ),
  },
  {
    files: ['apps/mobile/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}', 'packages/avatar/**/*.ts'],
    rules: internalImports(
      ['@trucaco/rules'],
      'O cliente não decide regra de jogo: o servidor é a fonte de verdade.',
    ),
  },
);

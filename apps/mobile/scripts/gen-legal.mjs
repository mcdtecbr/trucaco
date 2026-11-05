// Gera src/legal/generated/legalText.ts a partir de docs/legal/*.md (texto embutido no bundle).
// Metro nao importa .md sem configuracao; um modulo TS com strings e o caminho mais simples e portavel.
// Nunca grava placeholder: se faltar um .md, falha (--strict, usado no build e no CI) ou, fora do modo
// estrito, mantem o modulo ja commitado (dev e testes) com um aviso.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const legalDir = resolve(here, '../../../docs/legal');
const out = resolve(here, '../src/legal/generated/legalText.ts');
const strict = process.argv.includes('--strict');

const missing = ['termos-de-uso.md', 'politica-de-privacidade.md'].filter(
  (n) => !existsSync(join(legalDir, n)),
);
if (missing.length > 0) {
  const msg = `docs/legal: arquivo(s) ausente(s): ${missing.join(', ')}`;
  if (strict || !existsSync(out)) {
    const why = strict ? '(--strict)' : 'e nao ha legalText.ts commitado';
    console.error(`gen-legal: ERRO: ${msg} ${why}.`);
    process.exit(1);
  }
  console.warn(`gen-legal: aviso: ${msg}; mantendo src/legal/generated/legalText.ts existente.`);
  process.exit(0);
}

const load = (name) => readFileSync(join(legalDir, name), 'utf8').replace(/\r\n/g, '\n');

const body = `// GERADO por scripts/gen-legal.mjs a partir de docs/legal/*.md. Nao editar a mao.
export const TERMS_MD: string = ${JSON.stringify(load('termos-de-uso.md'))};
export const PRIVACY_MD: string = ${JSON.stringify(load('politica-de-privacidade.md'))};
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, body);

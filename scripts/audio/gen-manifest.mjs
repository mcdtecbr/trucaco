// Gera packages/avatar/src/audioManifest.ts: um `require()` estático por arquivo de assets/audio
// (o Metro só empacota asset com require literal). Rode depois de trocar ou adicionar arquivos.
// Uso: node scripts/audio/gen-manifest.mjs [--check] [--audio-dir <dir>] [--out <arquivo>]
//   --check      não escreve; sai com erro se o arquivo de saída difere do gerado.
//   --audio-dir  pasta de áudio alternativa (testes).
//   --out        arquivo de saída alternativo (testes).
// Nomes fora de `^[a-z0-9_]+\.m4a$` (arquivo) e `^[a-z0-9_]+$` (pasta de voz) abortam: o nome
// entra no TypeScript gerado e iria ao bundle.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const check = args.includes('--check');
const audioDir = resolve(flag('--audio-dir') ?? join(root, 'assets/audio'));
const outFile = resolve(flag('--out') ?? join(root, 'packages/avatar/src/audioManifest.ts'));
// De packages/avatar/src (e de packages/avatar/dist) até assets/audio: mesma profundidade.
const REL = '../../../assets/audio';

const FILE_RE = /^[a-z0-9_]+\.m4a$/;
const DIR_RE = /^[a-z0-9_]+$/;

const fail = (msg) => {
  console.error(`gen-manifest: ${msg}`);
  process.exit(1);
};

const list = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .filter((d) => !d.name.startsWith('.'))
    : [];

const m4aFiles = (dir, label) => {
  const out = [];
  for (const d of list(dir)) {
    if (!d.isFile() || !d.name.endsWith('.m4a')) continue;
    if (!FILE_RE.test(d.name))
      fail(`nome de arquivo inválido em ${label}: ${JSON.stringify(d.name)} (use ${FILE_RE})`);
    out.push(d.name);
  }
  return out;
};

const lines = [];
lines.push(
  '// GERADO por scripts/audio/gen-manifest.mjs. Não edite à mão.',
  "import type { VoiceId } from '@trucaco/protocol';",
  '',
  '// Só o Metro (Expo) carrega este módulo; vitest e Node não o importam (use `@trucaco/avatar/audio`).',
  'declare const require: (path: string) => AudioSource;',
  '',
  '/** Id do asset empacotado pelo Metro (aceito por `expo-audio`). */',
  'export type AudioSource = number;',
  '',
  'export const VOICE_AUDIO: Readonly<Partial<Record<VoiceId, Readonly<Record<string, AudioSource>>>>> = {',
);
for (const voice of list(join(audioDir, 'voices')).filter((d) => d.isDirectory())) {
  if (!DIR_RE.test(voice.name))
    fail(`nome de pasta de voz inválido: ${JSON.stringify(voice.name)} (use ${DIR_RE})`);
  lines.push(`  ${voice.name}: {`);
  for (const name of m4aFiles(join(audioDir, 'voices', voice.name), `voices/${voice.name}`)) {
    const key = name.replace(/\.m4a$/, '');
    lines.push(
      `    ${key}: require(${JSON.stringify(`${REL}/voices/${voice.name}/${name}`).replace(/"/g, "'")}),`,
    );
  }
  lines.push('  },');
}
lines.push('};', '', 'export const SFX_AUDIO: Readonly<Record<string, AudioSource>> = {');
for (const name of m4aFiles(join(audioDir, 'sfx'), 'sfx')) {
  const key = name.replace(/\.m4a$/, '');
  lines.push(`  ${key}: require(${JSON.stringify(`${REL}/sfx/${name}`).replace(/"/g, "'")}),`);
}
lines.push('};', '');
const content = lines.join('\n');

if (check) {
  const current = existsSync(outFile) ? readFileSync(outFile, 'utf8') : '';
  if (current !== content) fail(`${outFile} está desatualizado; rode o gerador sem --check`);
  console.log('audioManifest.ts está atualizado');
} else {
  writeFileSync(outFile, content);
  console.log('audioManifest.ts gerado');
}

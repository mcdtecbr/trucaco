// Gera áudio PLACEHOLDER (tom curto e baixo, mono, AAC .m4a) para todo par voz-com-arquivo x take,
// para os efeitos do painel e para os efeitos de jogo. Sem direitos de terceiros: é um seno gerado.
// Uso: node scripts/audio/gen-placeholders.mjs [--force]   (ffmpeg precisa estar no PATH)
// Sem --force, arquivos que já existem NÃO são sobrescritos (assim um arquivo final não é perdido).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const catalog = JSON.parse(
  readFileSync(join(root, 'packages/avatar/src/audioCatalog.json'), 'utf8'),
);
const audioDir = join(root, 'assets/audio');
const force = process.argv.includes('--force');

/** Seno de `freq` Hz por `dur` s, a -30 dB, com entrada e saída suaves. */
function render(outFile, freq, dur) {
  if (!/^[a-z0-9_]+\.m4a$/.test(basename(outFile)))
    throw new Error(`nome inválido no catálogo: ${JSON.stringify(basename(outFile))}`);
  if (existsSync(outFile) && !force) return false;
  mkdirSync(dirname(outFile), { recursive: true });
  const fade = Math.min(0.08, dur / 4);
  const args = [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${freq}:duration=${dur}:sample_rate=44100`,
    '-af',
    `volume=-30dB,afade=t=in:d=${fade},afade=t=out:st=${(dur - fade).toFixed(3)}:d=${fade}`,
    '-ac',
    '1',
    '-c:a',
    'aac',
    '-b:a',
    '32k',
    // reprodutível: sem data de criação nem versão do encoder nos metadados
    '-map_metadata',
    '-1',
    '-fflags',
    '+bitexact',
    '-flags:a',
    '+bitexact',
    outFile,
  ];
  const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg falhou em ${outFile}`);
  return true;
}

let made = 0;
const events = Object.keys(catalog.voiceEvents);
for (const voice of catalog.voicesWithFiles) {
  // Vozes diferentes ficam uma oitava aparte só para teste auditivo.
  const octave = voice.startsWith('fem') ? 2 : 1;
  events.forEach((event, e) => {
    catalog.voiceEvents[event].forEach((take, n) => {
      const freq = (200 + e * 40 + n * 15) * octave;
      if (render(join(audioDir, 'voices', voice, `${take.id}.m4a`), freq, 0.6 + 0.05 * n)) made++;
    });
  });
}
[...catalog.soundboardSfx, ...catalog.gameSfx].forEach((id, i) => {
  if (render(join(audioDir, 'sfx', `${id}.m4a`), 300 + i * 55, 0.8)) made++;
});
console.log(`placeholders gerados: ${made}`);

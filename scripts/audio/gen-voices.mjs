#!/usr/bin/env node
// Gera os takes de voz com o Gemini TTS (Interactions API) a partir de packages/avatar/src/audioCatalog.json.
//
// Uso (Node 20+; ffmpeg no PATH):
//   node scripts/audio/gen-voices.mjs --list                          mostra o plano e o que falta (sem chamar a API)
//   node scripts/audio/gen-voices.mjs --voice masc_1 --only truco_1   gera um take (teste)
//   node scripts/audio/gen-voices.mjs [--voice fem_2 ...] [--max 95] [--force]
//
// RESUMÍVEL: o áudio bruto de cada take fica em `.audio-work/<voz>/<take>.wav` (ignorado pelo Git). Take com cache
// não chama a API de novo; só a conversão para .m4a é refeita. Ao bater no limite DIÁRIO da conta (Tier 1: 100
// pedidos/dia) o script salva o progresso e sai com código 2: rode de novo no dia seguinte. O limite por minuto
// (Tier 1: 10) é respeitado com pausa entre pedidos e nova tentativa.
//
// A chave NUNCA é impressa nem versionada: vem de GEMINI_API_KEY ou do arquivo `.env.geminiAPI.google` (ignorado
// pelo Git; aceita só a chave ou `GEMINI_API_KEY=...`) e vai no cabeçalho `x-goog-api-key`. Só o TEXTO das
// falas (públicas, do catálogo) é enviado ao serviço.
//
// Saída: assets/audio/voices/<voiceId>/<take>.m4a (mono, AAC). Depois de gerar uma voz inteira, acrescente-a a
// `voicesWithFiles` em packages/avatar/src/audioCatalog.json e rode `node scripts/audio/gen-manifest.mjs`.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const MODEL = 'gemini-3.8-flash-tts';
const NAME_RE = /^[a-z0-9_]+$/;
/** Placeholder gerado tem de ~3 a ~4,6 KB. Mesmo limiar usado nos testes de tamanho. */
const PLACEHOLDER_MAX_BYTES = 4800;
/** Pausa entre pedidos: 10/min no Tier 1 => um a cada 6,5 s. */
const GAP_MS = 6500;

// Voz do Gemini por voz do jogo (decisão do usuário, 2026-11-04). O nome do fornecedor não entra no protocolo.
const VOICE_MAP = {
  masc_1: 'Puck',
  masc_2: 'Schedar',
  masc_3: 'Zubenelgenubi',
  masc_4: 'Sadaltager',
  masc_5: 'Fenrir',
  fem_1: 'Autonoe',
  fem_2: 'Aoede',
  fem_3: 'Despina',
  fem_4: 'Zephyr',
};

// Estilo por evento (vai em `speech_metadata.style`, NÃO é lido em voz alta). Sem marca de gênero, para servir
// às vozes masculinas e femininas.
const STYLE = {
  truco:
    'gritando muito alto, com empolgação e provocação, como quem bate a carta na mesa num truco',
  seis: 'gritando com deboche e provocação, de quem está ganhando a mão',
  oito: 'gritando com mais força ainda, desafiador e provocador',
  nove: 'gritando alto, eufórico e debochado, esticando as vogais',
  dez: 'gritando forte, quase sem fôlego de tanta empolgação',
  doze: 'gritando no máximo, eufórico e exagerado, a aposta mais alta da mesa',
  quero: 'gritando com confiança e desafio, firme e seco',
  corro: 'frustrado e resmungando, derrota dramática e exagerada',
  mao_especial: 'animado e determinado, falando alto como quem topa o desafio',
  mao_de_ferro: 'tenso e misterioso, de quem joga às cegas, mas ainda falando alto',
  vaza: 'comemorando com alegria, falando alto',
  venceu_jogo: 'comemorando muito, alegre e cheio de energia',
  venceu_serie: 'gritando de alegria, eufórico, festa de campeão',
};

function fail(msg) {
  console.error(`erro: ${msg}`);
  process.exit(1);
}

function readKey() {
  const fromEnv = process.env.GEMINI_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const file = join(root, '.env.geminiAPI.google');
  if (!existsSync(file))
    fail('Defina GEMINI_API_KEY ou crie .env.geminiAPI.google (ignorado pelo Git).');
  const raw = readFileSync(file, 'utf8').trim();
  const m = /^GEMINI_API_KEY\s*=\s*(.+)$/m.exec(raw);
  const key = (m ? m[1] : raw.split(/\r?\n/)[0]).trim().replace(/^["']|["']$/g, '');
  if (!/^[A-Za-z0-9_-]{20,}$/.test(key))
    fail('Conteúdo de .env.geminiAPI.google não parece uma chave de API.');
  return key;
}

function args() {
  const a = process.argv.slice(2);
  const out = { voices: [], only: null, force: false, list: false, max: 95 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--list') out.list = true;
    else if (a[i] === '--force') out.force = true;
    else if (a[i] === '--voice') out.voices.push(a[++i]);
    else if (a[i] === '--only') out.only = a[++i];
    else if (a[i] === '--max') out.max = Number(a[++i]);
    else fail(`argumento desconhecido: ${a[i]}`);
  }
  if (!Number.isInteger(out.max) || out.max < 1) fail('--max precisa ser um inteiro >= 1');
  return out;
}

function collectTakes(catalog) {
  const takes = [];
  for (const [event, list] of Object.entries(catalog.voiceEvents)) {
    if (!Object.hasOwn(STYLE, event)) fail(`evento sem estilo no script: ${event}`);
    for (const t of list) takes.push({ id: t.id, text: t.text, event });
  }
  return takes;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Chama a API. Devolve o WAV (Buffer), ou 'DAILY' se bateu no limite diário. */
async function synthesize(key, voice, text, style) {
  const body = {
    model: MODEL,
    input: [
      {
        type: 'user_input',
        content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style }] }],
      },
    ],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice }] },
  };
  for (let attempt = 0; attempt < 6; attempt++) {
    let res, txt;
    try {
      res = await fetch(API, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });
      txt = await res.text();
    } catch {
      await sleep(3000);
      continue;
    }
    if (res.status === 429) {
      if (/per day/i.test(txt)) return 'DAILY';
      await sleep(10000);
      continue;
    }
    if (!res.ok) fail(`HTTP ${res.status}: ${txt.replace(/\s+/g, ' ').slice(0, 300)}`);
    const audio = (JSON.parse(txt).steps ?? [])
      .filter((s) => s.type === 'model_output')
      .flatMap((s) => s.content ?? [])
      .filter((c) => c.type === 'audio')
      .at(-1);
    if (!audio?.data) fail('resposta sem áudio');
    return Buffer.from(audio.data, 'base64');
  }
  fail('muitas tentativas sem sucesso');
}

/** WAV bruto -> m4a mono: apara silêncio das pontas, normaliza o volume. */
function encode(rawWav, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  const trim = 'silenceremove=start_periods=1:start_threshold=-50dB';
  const af = `${trim},areverse,${trim},areverse,loudnorm=I=-16:TP=-1.5`;
  const r = spawnSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-i',
      rawWav,
      '-af',
      af,
      '-ac',
      '1',
      '-ar',
      '24000',
      '-c:a',
      'aac',
      '-b:a',
      '48k',
      '-map_metadata',
      '-1',
      dest,
    ],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) fail(`ffmpeg falhou em ${dest}`);
}

const isPlaceholder = (file) => statSync(file).size <= PLACEHOLDER_MAX_BYTES;

async function main() {
  const opt = args();
  const catalog = JSON.parse(
    readFileSync(join(root, 'packages/avatar/src/audioCatalog.json'), 'utf8'),
  );
  const takes = collectTakes(catalog);
  if (opt.only && !takes.some((t) => t.id === opt.only))
    fail(`take desconhecido em --only: ${opt.only}`);
  const voices = opt.voices.length > 0 ? opt.voices : Object.keys(VOICE_MAP);
  for (const v of voices) if (!Object.hasOwn(VOICE_MAP, v)) fail(`voz desconhecida: ${v}`);

  const plan = [];
  for (const v of voices) {
    for (const t of takes) {
      if (opt.only && t.id !== opt.only) continue;
      if (!NAME_RE.test(v) || !NAME_RE.test(t.id)) fail(`id inválido: ${v}/${t.id}`);
      const raw = join(root, '.audio-work', v, `${t.id}.wav`);
      const dest = join(root, 'assets/audio/voices', v, `${t.id}.m4a`);
      const hasFinal = existsSync(dest) && !isPlaceholder(dest);
      plan.push({ v, t, raw, dest, hasRaw: existsSync(raw), done: hasFinal && !opt.force });
    }
  }
  const todoApi = plan.filter((p) => !p.done && !p.hasRaw);
  console.log(
    `plano: ${plan.length} takes | prontos: ${plan.filter((p) => p.done).length} | só converter: ${plan.filter((p) => !p.done && p.hasRaw).length} | chamar API: ${todoApi.length}`,
  );
  if (opt.list) {
    for (const v of voices) {
      const mine = plan.filter((p) => p.v === v);
      console.log(
        `${v} (${VOICE_MAP[v]}): ${mine.filter((p) => p.done).length}/${mine.length} prontos`,
      );
    }
    return;
  }

  let key = null;
  let calls = 0;
  for (const p of plan) {
    if (p.done) continue;
    if (!p.hasRaw) {
      if (calls >= opt.max) {
        console.log(
          `limite de --max ${opt.max} pedidos nesta rodada; rode de novo para continuar.`,
        );
        process.exit(2);
      }
      key ??= readKey();
      const wav = await synthesize(key, VOICE_MAP[p.v], p.t.text, STYLE[p.t.event]);
      if (wav === 'DAILY') {
        console.log(
          'limite DIÁRIO da conta atingido; progresso salvo. Rode de novo amanhã (ou suba o nível no AI Studio).',
        );
        process.exit(2);
      }
      mkdirSync(dirname(p.raw), { recursive: true });
      writeFileSync(p.raw, wav);
      calls++;
      await sleep(GAP_MS);
    }
    encode(p.raw, p.dest);
    console.log(`ok ${p.v}/${p.t.id} (${statSync(p.dest).size} B)`);
  }
  console.log('concluído.');
}

main();

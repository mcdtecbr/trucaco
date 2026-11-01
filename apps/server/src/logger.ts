/**
 * Logger estruturado mínimo (uma linha JSON por evento). Regras do projeto: nunca registrar token,
 * carta de jogador nem conteúdo de chat privado em nível info. Quem chama passa só metadados
 * (assento, código de erro, contadores), nunca a carta.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Readonly<Record<string, string | number | boolean | null>>;
export type LogSink = (level: LogLevel, msg: string, fields: LogFields) => void;

const defaultSink: LogSink = (level, msg, fields) => {
  // `debug` só fora de produção (sem variável de ambiente nova).
  if (level === 'debug' && process.env.NODE_ENV === 'production') return;
  const line = JSON.stringify({ level, msg, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
};

let sink: LogSink = defaultSink;

/** Troca o destino dos logs (testes silenciam ou capturam). Devolve a função que restaura o padrão. */
export function setLogSink(next: LogSink): () => void {
  sink = next;
  return () => {
    sink = defaultSink;
  };
}

/** Nomes de campo que nunca saem em log (token, hash, cabeçalho de auth, cookie, segredo, corpo de /auth). */
const SENSITIVE_KEY =
  /token|authorization|cookie|secret|password|passwd|hash|jwt|bearer|credential|body/i;
/**
 * Valor com cara de JWT (`eyJ...`.`...`.`...`), de Bearer ou de refresh token (32 bytes em base64url =
 * exatamente 43 caracteres): redigido mesmo em campo de nome inocente.
 */
const SENSITIVE_VALUE =
  /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*|Bearer\s+\S+|(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/;
/** Mesmos padrões, global, para trocar o trecho dentro de um texto livre (`msg`). */
const SENSITIVE_VALUE_GLOBAL = new RegExp(SENSITIVE_VALUE.source, 'g');
export const REDACTED = '[REDACTED]';

/** Defesa em profundidade: o logger redige campos sensíveis mesmo que um chamador os passe por engano. */
export function redact(fields: LogFields): LogFields {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] =
      SENSITIVE_KEY.test(key) || (typeof value === 'string' && SENSITIVE_VALUE.test(value))
        ? REDACTED
        : value;
  }
  return out;
}

const emit =
  (level: LogLevel) =>
  (msg: string, fields: LogFields = {}): void =>
    sink(level, msg.replace(SENSITIVE_VALUE_GLOBAL, REDACTED), redact(fields));

export const log = {
  debug: emit('debug'),
  info: emit('info'),
  warn: emit('warn'),
  error: emit('error'),
};

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

export const log = {
  debug: (msg: string, fields: LogFields = {}): void => sink('debug', msg, fields),
  info: (msg: string, fields: LogFields = {}): void => sink('info', msg, fields),
  warn: (msg: string, fields: LogFields = {}): void => sink('warn', msg, fields),
  error: (msg: string, fields: LogFields = {}): void => sink('error', msg, fields),
};

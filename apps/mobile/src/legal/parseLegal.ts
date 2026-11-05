export type LegalBlock =
  | { kind: 'h1' | 'h2' | 'h3'; text: string }
  | { kind: 'p'; text: string }
  /** `marker`: "•" ou o número original ("2."); `level`: 0 para o primeiro nível de lista. */
  | { kind: 'li'; text: string; marker: string; level: number };

/** Remove marcação inline: negrito, itálico, código e links (`[texto](url)` vira `texto (url)`). */
export function stripInline(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

/**
 * Markdown mínimo para blocos de texto (títulos, itens, parágrafos). Saída só vira `<Text>`: nunca HTML.
 * Tags HTML e comentários são descartados como texto cru, sem interpretar.
 */
export function parseLegal(md: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  let para: string[] = [];
  let indents: number[] = []; // pilha de recuos das listas abertas
  const flush = (): void => {
    if (para.length > 0) blocks.push({ kind: 'p', text: stripInline(para.join(' ')) });
    para = [];
  };
  for (const raw of md.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const head = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item === null && !/^\s/.test(line) && line.trim() !== '') indents = [];
    if (line.trim() === '' || /^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      flush();
    } else if (head !== null) {
      flush();
      const level = Math.min((head[1] ?? '#').length, 3);
      blocks.push({ kind: `h${level}` as 'h1' | 'h2' | 'h3', text: stripInline(head[2] ?? '') });
    } else if (item !== null) {
      flush();
      const indent = [...(item[1] ?? '')].reduce((n, c) => n + (c === ' ' ? 1 : 4), 0);
      while (indents.length > 0 && (indents[indents.length - 1] ?? 0) > indent) indents.pop();
      if (indents.length === 0 || (indents[indents.length - 1] ?? 0) < indent) indents.push(indent);
      const mark = item[2] ?? '-';
      blocks.push({
        kind: 'li',
        text: stripInline(item[3] ?? ''),
        marker: /^\d/.test(mark) ? mark : '•',
        level: Math.min(indents.length - 1, 3),
      });
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return blocks.filter((b) => b.text !== '');
}

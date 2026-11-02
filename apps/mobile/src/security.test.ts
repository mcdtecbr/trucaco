import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.includes('Server')
      ? [p]
      : [];
  });
}

const root = resolve(import.meta.dirname, '..');
const sources = [...files(join(root, 'src')), ...files(join(root, 'app'))];

describe('higiene do código de UI', () => {
  it('há arquivos para varrer', () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it('sem HTML injetado, console.* nem fetch cru', () => {
    const bad: string[] = [];
    for (const f of sources) {
      const text = readFileSync(f, 'utf8');
      const rel = relative(root, f);
      if (/dangerouslySetInnerHTML|innerHTML\s*=|WebView/.test(text)) bad.push(`${rel}: html`);
      if (/\bconsole\.(log|info|debug|warn|error)\b/.test(text)) bad.push(`${rel}: console`);
      // fetch cru só na camada de rede
      if (/\bfetch\(/.test(text) && !rel.startsWith('src/net/')) bad.push(`${rel}: fetch`);
    }
    expect(bad).toEqual([]);
  });

  it('as telas não importam @trucaco/rules nem @colyseus/core', () => {
    const bad = sources.filter((f) =>
      /from '(@trucaco\/rules|@colyseus\/core)'/.test(readFileSync(f, 'utf8')),
    );
    expect(bad).toEqual([]);
  });
});

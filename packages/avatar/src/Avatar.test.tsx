import { renderToStaticMarkup } from 'react-dom/server';
import { Animated } from 'react-native';
import { describe, expect, it } from 'vitest';
import {
  AVATAR_PART_COUNTS,
  AVATAR_PART_KEYS,
  DEFAULT_AVATAR_PARTS,
  SIGNAL_IDS,
  type AvatarParts,
  type AvatarPartKey,
} from '@trucaco/protocol';
import { Avatar, pickRenderer } from './Avatar';
import { AvatarFallback } from './AvatarFallback';

function fallbackHtml(parts: AvatarParts, activeId: (typeof SIGNAL_IDS)[number] | null = null) {
  return renderToStaticMarkup(
    <AvatarFallback
      parts={parts}
      size={64}
      activeId={activeId}
      progress={new Animated.Value(0.5)}
      breathe={new Animated.Value(0)}
      blink={new Animated.Value(0)}
      highlight={false}
      accessibilityLabel="Avatar"
      testID="av"
    />,
  );
}

describe('render estático', () => {
  it('renderiza com rótulo genérico e testID', () => {
    const html = renderToStaticMarkup(<Avatar parts={DEFAULT_AVATAR_PARTS} testID="av" />);
    expect(html).toContain('aria-label="Avatar"');
    expect(html).toContain('data-testid="av"');
    const custom = renderToStaticMarkup(
      <Avatar parts={DEFAULT_AVATAR_PARTS} accessibilityLabel="Jogador 2" />,
    );
    expect(custom).toContain('aria-label="Jogador 2"');
  });

  it('cada variante de cada parte gera desenho distinto (exceto onde a parte não aparece)', () => {
    for (const key of AVATAR_PART_KEYS) {
      const seen = new Set<string>();
      for (let i = 0; i < AVATAR_PART_COUNTS[key]; i++) {
        seen.add(fallbackHtml({ ...DEFAULT_AVATAR_PARTS, [key]: i }));
      }
      expect(seen.size, key).toBe(AVATAR_PART_COUNTS[key]);
    }
  });

  it('combinações extremas e pseudoaleatórias renderizam sem quebrar', () => {
    let seed = 12345;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const combos: AvatarParts[] = [];
    const max = Object.fromEntries(
      AVATAR_PART_KEYS.map((k) => [k, AVATAR_PART_COUNTS[k] - 1]),
    ) as unknown as AvatarParts;
    combos.push(DEFAULT_AVATAR_PARTS, max);
    for (let i = 0; i < 150; i++) {
      combos.push(
        Object.fromEntries(
          AVATAR_PART_KEYS.map((k: AvatarPartKey) => [k, next(AVATAR_PART_COUNTS[k])]),
        ) as unknown as AvatarParts,
      );
    }
    for (const parts of combos) {
      expect(() => renderToStaticMarkup(<Avatar parts={parts} />)).not.toThrow();
    }
  });

  it('parts inválido cai em DEFAULT_AVATAR_PARTS', () => {
    const expected = renderToStaticMarkup(<Avatar parts={DEFAULT_AVATAR_PARTS} testID="a" />);
    for (const bad of [
      { ...DEFAULT_AVATAR_PARTS, hair: 99 },
      { ...DEFAULT_AVATAR_PARTS, skin: -1 },
      { ...DEFAULT_AVATAR_PARTS, eyes: 1.5 },
      { ...DEFAULT_AVATAR_PARTS, extra: 1 },
      {},
      null,
      'texto',
    ]) {
      const html = renderToStaticMarkup(
        <Avatar parts={bad as unknown as AvatarParts} testID="a" />,
      );
      expect(html).toBe(expected);
    }
  });

  it('os 12 sinais renderizam em pose e marcam o sinal ativo', () => {
    const idle = fallbackHtml(DEFAULT_AVATAR_PARTS);
    const htmls = new Set<string>();
    for (const id of SIGNAL_IDS) {
      const html = fallbackHtml(DEFAULT_AVATAR_PARTS, id);
      expect(html).toContain(`data-testid="av-signal-${id}"`);
      expect(html).not.toBe(idle);
      htmls.add(html);
    }
    expect(htmls.size).toBe(SIGNAL_IDS.length);
    expect(idle).not.toContain('av-signal-');
  });

  it('pickRenderer só conhece o vetorial por enquanto', () => {
    expect(pickRenderer()).toBe('fallback');
    expect(pickRenderer('fallback')).toBe('fallback');
  });
});

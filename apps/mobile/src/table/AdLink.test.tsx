// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdLink } from './AdLink';
import { ScoreAd } from './ScoreAd';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  const r = root;
  if (r !== null) act(() => r.unmount());
  root = null;
  host.remove();
});

function render(node: React.ReactElement): void {
  const r = createRoot(host);
  root = r;
  act(() => r.render(node));
}
const q = (id: string): HTMLElement | null => host.querySelector(`[data-testid="${id}"]`);
const click = (el: HTMLElement): void =>
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });

describe('AdLink', () => {
  it('com https: é um link com rótulo e o clique chama o abridor injetável com a URL', () => {
    const open = vi.fn();
    render(
      <AdLink
        ad={{ kind: 'placeholder', href: 'https://exemplo.com/x', label: 'Loja X' }}
        style={{ width: 10, height: 10 }}
        onOpen={open}
        testID="l"
      />,
    );
    const el = q('l') as HTMLElement;
    expect(el.getAttribute('aria-label')).toBe('Publicidade: Loja X');
    expect(el.getAttribute('role')).toBe('link');
    click(el);
    expect(open).toHaveBeenCalledWith('https://exemplo.com/x');
  });

  it('sem href ou com esquema inseguro: nada é renderizado, nada captura toque', () => {
    for (const href of [undefined, 'http://exemplo.com', 'javascript:alert(1)']) {
      render(
        <AdLink
          ad={{ kind: 'placeholder', ...(href !== undefined ? { href } : {}) }}
          style={{}}
          testID="l"
        />,
      );
      expect(q('l')).toBeNull();
      act(() => root?.unmount());
      root = null;
    }
  });
});

describe('ScoreAd clicável', () => {
  it('com href: link "Publicidade: ..." e clique abre; sem href: decorativa e sem link', () => {
    const open = vi.fn();
    render(
      <ScoreAd
        ad={{ kind: 'placeholder', href: 'https://exemplo.com', label: 'Loja X' }}
        onOpen={open}
      />,
    );
    const link = q('score-ad-link') as HTMLElement;
    expect(link.getAttribute('aria-label')).toBe('Publicidade: Loja X');
    expect(q('score-ad')?.getAttribute('aria-hidden')).not.toBe('true');
    click(link);
    expect(open).toHaveBeenCalledTimes(1);
    act(() => root?.unmount());
    root = null;
    render(<ScoreAd ad={{ kind: 'placeholder', href: 'http://inseguro.com' }} onOpen={open} />);
    expect(q('score-ad-link')).toBeNull();
    expect(q('score-ad')?.getAttribute('aria-hidden')).toBe('true');
  });
});

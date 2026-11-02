import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AvatarPlaceholder, asAvatarStatus, initialOf, statusText } from './AvatarPlaceholder';
import { ChatText, truncateText } from './ChatText';
import { LiveRegion } from './LiveRegion';
import { Vira } from './Vira';
import { layoutModeFor } from './layout';
import { screenPosition } from './position';

describe('layoutModeFor', () => {
  it('celular abaixo de 900 px, largo a partir de 900', () => {
    expect(layoutModeFor(390)).toBe('phone');
    expect(layoutModeFor(899)).toBe('phone');
    expect(layoutModeFor(900)).toBe('wide');
    expect(layoutModeFor(1280)).toBe('wide');
  });
});

describe('screenPosition', () => {
  it('eu embaixo, parceiro em cima, próximo à direita', () => {
    expect(screenPosition(1, 1)).toBe('self');
    expect(screenPosition(1, 3)).toBe('partner');
    expect(screenPosition(3, 0)).toBe('right');
    expect(screenPosition(0, 3)).toBe('left');
    expect(() => screenPosition(0, 1, 6)).toThrow(RangeError);
  });
});

describe('AvatarPlaceholder', () => {
  it('inicial, status e rótulo falado', () => {
    expect(initialOf('zé')).toBe('Z');
    expect(initialOf('😀x')).toBe('😀');
    expect(initialOf('  ')).toBe('?');
    expect(asAvatarStatus('away')).toBe('away');
    expect(asAvatarStatus('lixo')).toBe('empty');
    expect(statusText('bot')).toBe('bot');
    const html = renderToStaticMarkup(
      <AvatarPlaceholder
        nickname="bia"
        status="away"
        caption="sua vez"
        side="theirs"
        active
        layout="column"
      />,
    );
    expect(html).toContain('aria-label="bia, ausente, sua vez"');
    expect(html).toContain('>B<');
  });

  it('vaga e sem status', () => {
    expect(renderToStaticMarkup(<AvatarPlaceholder nickname="" status="empty" />)).toContain(
      'aria-label="Vaga livre"',
    );
    expect(
      renderToStaticMarkup(<AvatarPlaceholder nickname="bia" caption="Conectado" />),
    ).toContain('aria-label="bia, Conectado"');
  });

  it('apelido hostil fica escapado', () => {
    const html = renderToStaticMarkup(
      <AvatarPlaceholder nickname={'<script>x</script>'} status="bot" />,
    );
    expect(html).not.toContain('<script>');
  });
});

describe('ChatText', () => {
  it('trunca por code points sem quebrar emoji e escapa HTML', () => {
    expect(truncateText('abcdef', 4)).toBe('abc…');
    expect(truncateText('abc', 4)).toBe('abc');
    expect(truncateText('😀😀😀', 2)).toBe('😀…');
    const html = renderToStaticMarkup(<ChatText author="Ana" text={'<b onclick=1>oi</b>'} />);
    expect(html).not.toContain('<b ');
    expect(html).toContain('&lt;b');
    expect(html).toContain('Ana disse:');
  });
});

describe('Vira', () => {
  it('mostra a vira; sem vira (mineiro) não renderiza; manilha só se vier pronta', () => {
    const html = renderToStaticMarkup(<Vira viraRank="Q" viraSuit="copas" />);
    expect(html).toContain('Vira: dama de copas');
    expect(html).not.toContain('Manilha');
    expect(renderToStaticMarkup(<Vira viraRank="" viraSuit="" />)).toBe('');
    expect(renderToStaticMarkup(<Vira viraRank="Q" viraSuit="copas" manilhaLabel="K" />)).toContain(
      'Manilha: K',
    );
  });
});

describe('LiveRegion', () => {
  it('região polite com a mensagem; alterna espaço para repetir frase', () => {
    const a = renderToStaticMarkup(<LiveRegion message="Oi" nonce={0} />);
    expect(a).toContain('aria-live="polite"');
    expect(a).toContain('role="status"');
    expect(a).toContain('>Oi<');
    expect(renderToStaticMarkup(<LiveRegion message="Oi" nonce={1} />)).toContain('Oi ');
    expect(renderToStaticMarkup(<LiveRegion message="" />)).not.toContain('Oi');
  });
});

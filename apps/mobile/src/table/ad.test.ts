import { describe, expect, it } from 'vitest';
import { adAccessibilityLabel, safeAdUrl } from './ad';

describe('safeAdUrl', () => {
  it('aceita https e normaliza', () => {
    expect(safeAdUrl('https://exemplo.com.br/promo')).toBe('https://exemplo.com.br/promo');
    expect(safeAdUrl('  https://exemplo.com ')).toBe('https://exemplo.com/');
  });

  it.each([
    'http://exemplo.com',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://exemplo.com',
    '//exemplo.com',
    '/relativo',
    'não é url',
    'https://user:senha@exemplo.com',
    '',
  ])('recusa %s', (href) => {
    expect(safeAdUrl(href)).toBeNull();
  });

  it('sem href: null', () => {
    expect(safeAdUrl(undefined)).toBeNull();
  });
});

describe('adAccessibilityLabel', () => {
  it('usa o rótulo informado ou o genérico', () => {
    expect(adAccessibilityLabel({ kind: 'placeholder', label: 'Loja X' })).toBe(
      'Publicidade: Loja X',
    );
    expect(adAccessibilityLabel({ kind: 'placeholder' })).toBe('Publicidade');
  });
});

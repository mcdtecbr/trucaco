import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BetButtons } from './BetButtons';
import { betButtons } from './bets';

describe('betButtons', () => {
  it('só ações de aposta, na ordem fixa, sem duplicar e ignorando cartas e lixo', () => {
    const b = betButtons([
      'play:3paus',
      'run',
      'bet',
      'bet',
      'accept',
      'xyz',
      'specialRun',
      'specialPlay',
    ]);
    expect(b.map((x) => x.id)).toEqual(['specialPlay', 'specialRun', 'accept', 'bet', 'run']);
  });

  it('sem ações de aposta: lista vazia', () => {
    expect(betButtons(['play:3paus', 'playBlind:0'])).toEqual([]);
    expect(betButtons([])).toEqual([]);
  });

  it('rótulo do valor vem do contexto (Paulista 3, Mineiro 4) e não é inferido', () => {
    expect(betButtons(['bet'], { nextValue: 3 })[0]).toMatchObject({
      label: 'Truco!',
      detail: 'vale 3',
    });
    expect(betButtons(['bet'], { nextValue: 4 })[0]?.detail).toBe('vale 4');
    expect(betButtons(['bet'])[0]?.detail).toBeUndefined();
  });

  it('Paulista: truco aceito, próximo valor 6 vira "Seis!"; Mineiro: 4 truco, 6 seis, 8 oito', () => {
    const b = (v: number) => betButtons(['bet'], { nextValue: v })[0];
    expect(b(6)).toMatchObject({
      label: 'Seis!',
      detail: 'vale 6',
      accessibilityLabel: 'Seis, vale 6',
    });
    expect(b(9)?.label).toBe('Nove!');
    expect(b(12)?.label).toBe('Doze!');
    expect(b(3)?.label).toBe('Truco!');
    expect(b(4)?.label).toBe('Truco!');
    expect(b(8)).toMatchObject({ label: 'Oito!', accessibilityLabel: 'Oito, vale 8' });
    expect(b(10)?.label).toBe('Dez!');
    expect(betButtons(['bet'], { raising: true, nextValue: 6 })[0]?.label).toBe('Seis!');
    expect(betButtons(['bet'], { nextValue: 7 })[0]?.label).toBe('Truco!');
  });

  it('aumentar com grito do valor (seis, oito, dez, doze)', () => {
    const r = (v: number) => betButtons(['bet'], { raising: true, nextValue: v })[0];
    expect(r(6)?.accessibilityLabel).toBe('Seis, vale 6');
    expect(r(8)?.accessibilityLabel).toBe('Oito, vale 8');
    expect(r(12)?.accessibilityLabel).toBe('Doze, vale 12');
    expect(r(6)?.label).toBe('Seis!');
    expect(betButtons(['bet'], { raising: true })[0]?.accessibilityLabel).toBe('Aumentar');
  });

  it('aceitar mostra o valor pendente; correr e mão de onze têm rótulos distintos', () => {
    expect(betButtons(['accept'], { pendingValue: 6 })[0]?.accessibilityLabel).toBe(
      'Aceitar, vale 6',
    );
    expect(betButtons(['accept'])[0]?.accessibilityLabel).toBe('Aceitar');
    expect(betButtons(['run'])[0]?.tone).toBe('danger');
    expect(betButtons(['specialPlay'])[0]?.label).toBe('Jogar a mão');
    expect(betButtons(['specialRun'])[0]?.label).toBe('Correr da mão');
  });
});

describe('BetButtons', () => {
  it('renderiza botões acessíveis com o valor e nada quando não há ação', () => {
    const html = renderToStaticMarkup(
      <BetButtons
        legalActions={['accept', 'bet', 'run']}
        raising
        nextValue={6}
        pendingValue={3}
        onPress={vi.fn()}
      />,
    );
    expect(html).toContain('role="toolbar"');
    expect(html.match(/role="button"/g)).toHaveLength(3);
    expect(html).toContain('aria-label="Aceitar, vale 3"');
    expect(html).toContain('aria-label="Seis, vale 6"');
    expect(
      renderToStaticMarkup(<BetButtons legalActions={['play:3paus']} onPress={vi.fn()} />),
    ).toBe('');
  });

  it('busy desabilita todos', () => {
    const html = renderToStaticMarkup(
      <BetButtons legalActions={['bet', 'run']} busy onPress={vi.fn()} />,
    );
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(2);
  });
});

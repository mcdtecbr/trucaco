import { PROTOCOL_VERSION } from '@trucaco/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HomeScreen } from './HomeScreen';

describe('HomeScreen', () => {
  it('mostra título e versão do protocolo', () => {
    const html = renderToStaticMarkup(<HomeScreen />);
    expect(html).toContain('Trucaco');
    expect(html).toContain(`Protocolo v${PROTOCOL_VERSION}`);
    expect(html).toContain('partner');
    expect(html).toContain('trig_wink');
  });
});

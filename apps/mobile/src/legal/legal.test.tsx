import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LegalLinks } from '../screens/LegalLinks';
import { LegalView } from '../screens/LegalView';
import { LoginView } from '../screens/LoginView';
import { SettingsView } from '../screens/SettingsView';
import { PRIVACY_MD, TERMS_MD } from './generated/legalText';
import { parseLegal, stripInline } from './parseLegal';

const noop = (): void => undefined;

describe('parseLegal', () => {
  it('converte títulos, itens e parágrafos; sem marcação nem HTML interpretado', () => {
    const blocks = parseLegal(
      '# Termos\n\nTexto **forte** com [link](https://x.y).\ncontinua aqui.\n\n- item um\n- item `dois`\n\n## Seção\n<script>alert(1)</script>',
    );
    expect(blocks).toEqual([
      { kind: 'h1', text: 'Termos' },
      { kind: 'p', text: 'Texto forte com link (https://x.y). continua aqui.' },
      { kind: 'li', text: 'item um', marker: '•', level: 0 },
      { kind: 'li', text: 'item dois', marker: '•', level: 0 },
      { kind: 'h2', text: 'Seção' },
      { kind: 'p', text: '<script>alert(1)</script>' },
    ]);
    expect(stripInline('*ênfase* simples')).toBe('ênfase simples');
  });
});

describe('listas', () => {
  it('preserva números e o nível das sublistas', () => {
    const b = parseLegal(
      '1. um\n2. dois\n   - sub a\n   - sub b\n     - fundo\n3. três\n\n# Fim\n- novo',
    );
    expect(b.map((x) => (x.kind === 'li' ? `${x.marker}${x.level}${x.text}` : x.kind))).toEqual([
      '1.0um',
      '2.0dois',
      '•1sub a',
      '•1sub b',
      '•2fundo',
      '3.0três',
      'h1',
      '•0novo',
    ]);
  });
});

describe('LegalView', () => {
  it('remove o h1 igual ao título em qualquer posição, com o texto real', () => {
    const html = renderToStaticMarkup(
      <LegalView title="Política de Privacidade" markdown={PRIVACY_MD} testID="p" onBack={noop} />,
    );
    expect(html.match(/Política de Privacidade/g)).toHaveLength(1);
    expect(html).toContain('RASCUNHO');
  });

  it('renderiza só texto: HTML do documento sai escapado', () => {
    const html = renderToStaticMarkup(
      <LegalView title="Termos de uso" markdown={'# T\n<b>x</b>'} testID="legal-x" onBack={noop} />,
    );
    expect(html).toContain('data-testid="legal-x"');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('Voltar');
  });

  it('os textos embutidos existem e renderizam (conteúdo livre)', () => {
    expect(TERMS_MD.length).toBeGreaterThan(0);
    expect(PRIVACY_MD.length).toBeGreaterThan(0);
    const html = renderToStaticMarkup(
      <LegalView title="Política de Privacidade" markdown={PRIVACY_MD} testID="p" onBack={noop} />,
    );
    expect(html).toContain('Política de Privacidade');
  });
});

describe('links legais', () => {
  it('LegalLinks tem os dois botões acessíveis', () => {
    const html = renderToStaticMarkup(<LegalLinks onTerms={noop} onPrivacy={noop} />);
    expect(html).toContain('aria-label="Termos de uso"');
    expect(html).toContain('aria-label="Política de Privacidade"');
  });

  it('aparecem em Configurações e na entrada', () => {
    const legal = { onTerms: noop, onPrivacy: noop };
    const settings = renderToStaticMarkup(
      <SettingsView
        nickname="Zé"
        draft=""
        busy={false}
        error={null}
        saved={false}
        appVersion="1"
        legal={legal}
        on={{ draft: noop, save: noop, logout: noop, back: noop, avatar: noop }}
      />,
    );
    expect(settings).toContain('data-testid="link-terms"');
    expect(settings).toContain('data-testid="link-privacy"');
    const login = renderToStaticMarkup(
      <LoginView
        nickname={null}
        legal={legal}
        on={{ guest: noop }}
        social={{ providers: [], busy: false, error: null, onPress: noop } as never}
      />,
    );
    expect(login).toContain('data-testid="link-terms"');
  });
});

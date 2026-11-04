import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SPEECH_BUBBLE_MAX, SPEECH_BUBBLE_MS, SpeechBubble } from './SpeechBubble';

describe('SpeechBubble', () => {
  it('mostra a legenda como texto (nunca HTML) com rótulo falado', () => {
    const html = renderToStaticMarkup(
      <SpeechBubble author="Bia" text="<img src=x onerror=1>TRUCO!" testID="speech-1" />,
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('Bia gritou');
    expect(html).toContain('speech-1');
  });

  it('trunca legenda longa e dura 2 s', () => {
    const html = renderToStaticMarkup(<SpeechBubble author="Bia" text={'x'.repeat(200)} />);
    expect(html).toContain('…');
    expect(html).not.toContain('x'.repeat(SPEECH_BUBBLE_MAX + 1));
    expect(SPEECH_BUBBLE_MS).toBe(2000);
  });
});

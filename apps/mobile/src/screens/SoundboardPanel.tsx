/**
 * Painel de efeitos engraçados (soundboard): 8 botões, um toque envia `sfx { sfxId }`. O servidor valida,
 * aplica 1 efeito a cada 5 s por jogador e retransmite aos 4 (inclusive a mim: o som toca ao RECEBER).
 * Aqui só espelhamos o cooldown (botões desligados com contagem); o servidor é a autoridade.
 * O botão e o painel ficam na linha de baixo, junto dos sinais, e abrem para baixo: não cobrem cartas.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SOUNDBOARD_SFX } from '@trucaco/avatar';
import { SFX_COOLDOWN_MS } from '@trucaco/protocol';
import type { SfxId } from '@trucaco/protocol';
import { MIN_TOUCH, colors, fontSize, fontWeight, radius, spacing } from '@trucaco/ui';

export interface SoundboardPanelProps {
  /** Sem conexão ativa: nada é enviado. */
  connected: boolean;
  /** Envia o efeito; `false` = recusado (sem sala). */
  onSend(id: SfxId): boolean;
  /** Os efeitos engraçados estão silenciados neste aparelho: o aviso explica por que não vai ouvir. */
  silenced?: boolean;
}

export function SoundboardPanel({ connected, onSend, silenced = false }: SoundboardPanelProps) {
  const [open, setOpen] = useState(false);
  /** Segundos que faltam do cooldown (0 = livre). */
  const [left, setLeft] = useState(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = (): void => {
    if (tick.current !== null) clearInterval(tick.current);
    tick.current = null;
  };
  useEffect(() => stop, []);

  const send = useCallback(
    (id: SfxId): void => {
      if (!connected || left > 0) return;
      if (!onSend(id)) return;
      setOpen(false);
      let remaining = Math.ceil(SFX_COOLDOWN_MS / 1000);
      setLeft(remaining);
      stop();
      tick.current = setInterval(() => {
        remaining -= 1;
        setLeft(remaining);
        if (remaining <= 0) stop();
      }, 1000);
    },
    [connected, left, onSend],
  );

  const cooling = left > 0;
  const blocked = !connected || cooling;
  return (
    <View testID="soundboard-panel" style={styles.root}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          cooling
            ? `Efeitos, aguarde ${left} segundos`
            : open
              ? 'Fechar efeitos engraçados'
              : 'Abrir efeitos engraçados'
        }
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        onPress={() => setOpen((o) => !o)}
        style={[styles.toggle, cooling && styles.off]}
        testID="soundboard-toggle"
      >
        <Text style={styles.toggleText}>{cooling ? `Efeitos (${left}s)` : 'Efeitos'}</Text>
      </Pressable>
      {open ? (
        <View style={styles.grid} testID="soundboard-grid">
          <Text style={styles.hint}>
            {silenced
              ? 'Você silenciou os efeitos engraçados neste aparelho: não vai ouvi-los, mas a mesa ouve.'
              : 'Toque para enviar. Todos na mesa ouvem. Um efeito a cada 5 segundos.'}
          </Text>
          <View style={styles.items}>
            {SOUNDBOARD_SFX.map((s) => (
              <Pressable
                key={s.id}
                accessibilityRole="button"
                accessibilityLabel={`Efeito: ${s.label}`}
                accessibilityState={{ disabled: blocked }}
                aria-disabled={blocked}
                disabled={blocked}
                onPress={() => send(s.id)}
                style={({ pressed }) => [
                  styles.item,
                  pressed && styles.itemHeld,
                  blocked && styles.off,
                ]}
                testID={`sfx-${s.id}`}
              >
                <Text style={styles.icon}>{s.icon}</Text>
                <Text style={styles.itemText}>{s.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm, alignItems: 'stretch' },
  toggle: {
    minHeight: MIN_TOUCH,
    minWidth: MIN_TOUCH,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toggleText: { color: colors.text, fontSize: fontSize.small, fontWeight: fontWeight.bold },
  grid: {
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  hint: { color: colors.textMuted, fontSize: fontSize.small, textAlign: 'center' },
  items: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  item: {
    minHeight: MIN_TOUCH,
    minWidth: 120,
    flexGrow: 1,
    flexBasis: '22%',
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
  },
  itemHeld: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  icon: { fontSize: fontSize.large },
  itemText: {
    color: colors.text,
    fontSize: fontSize.small,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
  },
  off: { opacity: 0.5 },
});

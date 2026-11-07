/**
 * Painel de efeitos engraçados (soundboard): 8 botões, um toque envia `sfx { sfxId }`. O servidor valida,
 * aplica 1 efeito a cada 5 s por jogador e retransmite aos 4 (inclusive a mim: o som toca ao RECEBER).
 * Aqui só espelhamos o cooldown (botões desligados com contagem); o servidor é a autoridade.
 * Na mesa o botão fica na dock, ao lado de "Sinais", e a grade abre numa camada acima da dock: não cobre
 * a mão nem os botões de aposta.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
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

export interface SoundboardPanelState {
  readonly open: boolean;
  readonly setOpen: (next: boolean | ((o: boolean) => boolean)) => void;
  /** Segundos que faltam do cooldown (0 = livre). */
  readonly left: number;
  readonly cooling: boolean;
  readonly blocked: boolean;
  readonly send: (id: SfxId) => void;
}

/**
 * Estado do painel de efeitos (aberto, cooldown, envio), separado da apresentação para o botão ficar na
 * dock da mesa e a grade abrir numa camada sobre o pano.
 */
export function useSoundboardPanel({
  connected,
  onSend,
}: Pick<SoundboardPanelProps, 'connected' | 'onSend'>): SoundboardPanelState {
  const [open, setOpen] = useState(false);
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
  return { open, setOpen, left, cooling, blocked: !connected || cooling, send };
}

/** Botão que abre e fecha o painel. `style` troca o visual (ex.: botão grande da dock). */
export function SoundboardToggle({
  panel,
  style,
}: {
  panel: SoundboardPanelState;
  style?: StyleProp<ViewStyle>;
}) {
  const { open, cooling, left } = panel;
  return (
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
      onPress={() => panel.setOpen((o) => !o)}
      style={[styles.toggle, style, cooling && styles.off]}
      testID="soundboard-toggle"
    >
      <Text style={styles.toggleText}>{cooling ? `Efeitos (${left}s)` : 'Efeitos'}</Text>
    </Pressable>
  );
}

/** Grade dos 8 efeitos. */
export function SoundboardGrid({
  panel,
  silenced = false,
  maxHeight,
}: {
  panel: SoundboardPanelState;
  silenced?: boolean;
  /** Ativa a rolagem (grade em camada sobre o pano: não passa da barra do placar). */
  maxHeight?: number;
}) {
  const { blocked, send } = panel;
  const items = (
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
          style={({ pressed }) => [styles.item, pressed && styles.itemHeld, blocked && styles.off]}
          testID={`sfx-${s.id}`}
        >
          <Text style={styles.icon}>{s.icon}</Text>
          <Text style={styles.itemText}>{s.label}</Text>
        </Pressable>
      ))}
    </View>
  );
  return (
    <View style={styles.grid} testID="soundboard-grid">
      <Text style={styles.hint}>
        {silenced
          ? 'Você silenciou os efeitos engraçados neste aparelho: não vai ouvi-los, mas a mesa ouve.'
          : 'Toque para enviar. Todos na mesa ouvem. Um efeito a cada 5 segundos.'}
      </Text>
      {maxHeight !== undefined ? (
        <ScrollView style={{ maxHeight }} nestedScrollEnabled>
          {items}
        </ScrollView>
      ) : (
        items
      )}
    </View>
  );
}

/** Painel completo (botão + grade em linha). Na mesa o botão fica na dock e a grade numa camada. */
export function SoundboardPanel({ connected, onSend, silenced = false }: SoundboardPanelProps) {
  const panel = useSoundboardPanel({ connected, onSend });
  return (
    <View testID="soundboard-panel" style={styles.root}>
      <SoundboardToggle panel={panel} />
      {panel.open ? <SoundboardGrid panel={panel} silenced={silenced} /> : null}
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
  toggleText: {
    color: colors.text,
    fontSize: fontSize.small,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
  },
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
    minWidth: 100,
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

/**
 * Painel de sinais: 16 botões (um por sinal do catálogo), enviados com UM toque (o painel já precisa
 * ser aberto antes, e o cooldown de 3 s evita rajada). O sinal é público: os 4 da mesa veem,
 * inclusive adversários. O cooldown de 3 s é do servidor; aqui só é espelhado (botões desligados).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { SIGNALS } from '@trucaco/avatar';
import { SIGNAL_COOLDOWN_MS } from '@trucaco/protocol';
import type { SignalId } from '@trucaco/protocol';
import { MIN_TOUCH, colors, fontSize, fontWeight, radius, spacing } from '@trucaco/ui';

export interface SignalPanelProps {
  /** Sem conexão ativa: nada é enviado. */
  connected: boolean;
  /** Envia o sinal; `false` = recusado (sem sala). */
  onSend(id: SignalId): boolean;
  /**
   * Significado combinado com o parceiro, por sinal. Só a minha dupla o tem (o servidor não o manda a
   * mais ninguém); vazio ou omitido = nada combinado, e o painel fica como antes.
   */
  codes?: Readonly<Partial<Record<SignalId, string>>>;
}

const SEND_HINT = 'Toque para enviar. Todos na mesa veem o sinal.';

export interface SignalPanelState {
  readonly open: boolean;
  readonly setOpen: (next: boolean | ((o: boolean) => boolean)) => void;
  readonly cooling: boolean;
  readonly blocked: boolean;
  readonly send: (id: SignalId) => void;
}

/**
 * Estado do painel de sinais (aberto, cooldown, envio). Separado da apresentação para o botão ficar na
 * dock da mesa e a grade abrir numa camada sobre o pano (um filho fora dos limites do pai não recebe
 * toque no Android).
 */
export function useSignalPanel({
  connected,
  onSend,
}: Pick<SignalPanelProps, 'connected' | 'onSend'>): SignalPanelState {
  const [open, setOpen] = useState(false);
  const [cooling, setCooling] = useState(false);
  const coolTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (coolTimer.current !== null) clearTimeout(coolTimer.current);
    },
    [],
  );

  const send = useCallback(
    (id: SignalId): void => {
      if (!connected || cooling) return;
      if (!onSend(id)) return;
      setCooling(true);
      setOpen(false);
      if (coolTimer.current !== null) clearTimeout(coolTimer.current);
      coolTimer.current = setTimeout(() => {
        coolTimer.current = null;
        setCooling(false);
      }, SIGNAL_COOLDOWN_MS);
    },
    [connected, cooling, onSend],
  );

  return { open, setOpen, cooling, blocked: !connected || cooling, send };
}

/** Botão que abre e fecha o painel. `style` troca o visual (ex.: botão grande da dock). */
export function SignalToggle({
  panel,
  style,
}: {
  panel: SignalPanelState;
  style?: StyleProp<ViewStyle>;
}) {
  const { open, cooling } = panel;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={open ? 'Fechar sinais' : 'Abrir sinais'}
      accessibilityState={{ expanded: open }}
      aria-expanded={open}
      onPress={() => panel.setOpen((o) => !o)}
      style={[styles.toggle, style, cooling && styles.off]}
      testID="signal-toggle"
    >
      <Text style={styles.toggleText}>{cooling ? 'Sinais (aguarde)' : 'Sinais'}</Text>
    </Pressable>
  );
}

/** Grade dos 16 sinais. `maxHeight` ativa a rolagem (grade em camada sobre o pano). */
export function SignalGrid({
  panel,
  codes,
  maxHeight,
}: {
  panel: SignalPanelState;
  codes?: SignalPanelProps['codes'];
  maxHeight?: number;
}) {
  const { blocked, send } = panel;
  const items = (
    <View style={styles.items}>
      {SIGNALS.map((s) => {
        const meaning = codes?.[s.id];
        return (
          <Pressable
            key={s.id}
            accessibilityRole="button"
            accessibilityLabel={meaning !== undefined ? `${s.name}, combinado: ${meaning}` : s.name}
            accessibilityHint={SEND_HINT}
            accessibilityActions={[{ name: 'activate', label: `Enviar ${s.name}` }]}
            onAccessibilityAction={(e) => {
              if (e.nativeEvent.actionName === 'activate') send(s.id);
            }}
            aria-disabled={blocked}
            disabled={blocked}
            onPress={() => send(s.id)}
            style={({ pressed }) => [
              styles.item,
              pressed && styles.itemHeld,
              blocked && styles.off,
            ]}
            testID={`signal-${s.id}`}
          >
            <Text style={styles.itemText}>{s.name}</Text>
            {meaning !== undefined ? (
              <Text style={styles.itemMeaning} testID={`signal-meaning-${s.id}`}>
                {meaning}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
  return (
    <View style={styles.grid} testID="signal-grid">
      <Text style={styles.hint}>Toque em um sinal para enviar. Todos na mesa veem.</Text>
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

export function SignalPanel({ connected, onSend, codes }: SignalPanelProps) {
  const panel = useSignalPanel({ connected, onSend });
  return (
    <View testID="signal-panel" style={styles.root}>
      <SignalToggle panel={panel} />
      {panel.open ? <SignalGrid panel={panel} {...(codes !== undefined ? { codes } : {})} /> : null}
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
    minWidth: 100,
    flexGrow: 1,
    flexBasis: '30%',
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
  },
  itemHeld: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  itemText: {
    color: colors.text,
    fontSize: fontSize.small,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
  },
  itemMeaning: { color: colors.textMuted, fontSize: fontSize.caption, textAlign: 'center' },
  off: { opacity: 0.5 },
});

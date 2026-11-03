/**
 * Painel de sinais: 16 botões (um por sinal do catálogo), enviados ao SEGURAR o botão por 400 ms (um
 * toque rápido não envia, para ninguém sinalizar sem querer). O sinal é público: os 4 da mesa veem,
 * inclusive adversários. O cooldown de 3 s é do servidor; aqui só é espelhado (botões desligados).
 * Leitor de tela: a ação de acessibilidade "activate" (e o clique sintético do web) envia direto,
 * já que segurar não é possível por ali.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SIGNALS } from '@trucaco/avatar';
import { SIGNAL_COOLDOWN_MS } from '@trucaco/protocol';
import type { SignalId } from '@trucaco/protocol';
import { MIN_TOUCH, colors, fontSize, fontWeight, radius, spacing } from '@trucaco/ui';

/** Tempo de pressão para enviar. */
export const SIGNAL_HOLD_MS = 400;

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

const HOLD_HINT = 'Segure por meio segundo para enviar. Todos na mesa veem o sinal.';

export function SignalPanel({ connected, onSend, codes }: SignalPanelProps) {
  const [open, setOpen] = useState(false);
  const [cooling, setCooling] = useState(false);
  const coolTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Houve `onPressIn` neste gesto (toque/clique real); sem ele o `onPress` é ativação assistiva. */
  const touched = useRef(false);

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

  const blocked = !connected || cooling;
  return (
    <View testID="signal-panel" style={styles.root}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? 'Fechar sinais' : 'Abrir sinais'}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        onPress={() => setOpen((o) => !o)}
        style={[styles.toggle, cooling && styles.off]}
        testID="signal-toggle"
      >
        <Text style={styles.toggleText}>{cooling ? 'Sinais (aguarde)' : 'Sinais'}</Text>
      </Pressable>
      {open ? (
        <View style={styles.grid} testID="signal-grid">
          <Text style={styles.hint}>Segure um sinal para enviar. Todos na mesa veem.</Text>
          <View style={styles.items}>
            {SIGNALS.map((s) => {
              const meaning = codes?.[s.id];
              return (
                <Pressable
                  key={s.id}
                  accessibilityRole="button"
                  accessibilityLabel={
                    meaning !== undefined ? `${s.name}, combinado: ${meaning}` : s.name
                  }
                  accessibilityHint={HOLD_HINT}
                  accessibilityActions={[{ name: 'activate', label: `Enviar ${s.name}` }]}
                  onAccessibilityAction={(e) => {
                    if (e.nativeEvent.actionName === 'activate') send(s.id);
                  }}
                  aria-disabled={blocked}
                  disabled={blocked}
                  delayLongPress={SIGNAL_HOLD_MS}
                  onPressIn={() => {
                    touched.current = true;
                  }}
                  onPressOut={() => {
                    // `onPress` pode vir logo depois do `onPressOut` no mesmo gesto: limpa só depois.
                    setTimeout(() => {
                      touched.current = false;
                    }, 0);
                  }}
                  onLongPress={() => {
                    touched.current = false;
                    send(s.id);
                  }}
                  onPress={() => {
                    // Toque rápido não envia. Clique sem `onPressIn` = ativação do leitor de tela.
                    if (!touched.current) send(s.id);
                  }}
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
    minWidth: 140,
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

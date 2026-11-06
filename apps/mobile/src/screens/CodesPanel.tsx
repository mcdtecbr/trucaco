/**
 * Painel "Combinar sinais" (apresentação pura): os 16 sinais do catálogo, cada um com a ESCOLHA do
 * significado (lista fixa em `codeMeanings.ts`; um significado vale para um sinal só, "Nada" repete). Abre na sala de espera (a "preparação") e na mesa. O combinado
 * é privado da dupla: o servidor só o envia aos dois assentos. Todo texto vai como `<Text>` (nunca HTML).
 * Combinado antigo em texto livre aparece como "Personalizado: ..." até ser trocado.
 */
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SIGNALS } from '@trucaco/avatar';
import type { SignalId } from '@trucaco/protocol';
import { MIN_TOUCH, colors, fontSize, fontWeight, radius, spacing } from '@trucaco/ui';
import { Button } from '../ui/Button';
import { customText, meaningText, optionsFor, selectedMeaning } from './codeMeanings';

export const GUEST_CODES_NOTE = 'Como convidado, seu combinado some ao sair da conta.';
export const NO_PARTNER_NOTE =
  'Seu parceiro ainda não sentou. O combinado só vale quando ele chegar.';
export const CODES_PRIVACY_NOTE =
  'Só você e seu parceiro veem o que combinaram. Os adversários veem o sinal, mas não o significado.';

export interface CodesPanelProps {
  /** Combinado atual da dupla (vem do servidor). */
  codes: Readonly<Partial<Record<SignalId, string>>>;
  /** Apelido do parceiro humano sentado, ou null (ainda não sentou, saiu ou é bot). */
  partnerName: string | null;
  connected: boolean;
  /** Mostra o aviso de que o combinado do convidado some ao sair da conta. */
  guest: boolean;
  /** Texto pt-BR do último erro, ou null. */
  errorText: string | null;
  on: {
    /** Envia o significado (vazio apaga). `false` = recusado antes de sair. */
    save(id: SignalId, meaning: string): boolean;
    close(): void;
  };
}

const PENDING_TIMEOUT_MS = 2000;

function CodeRow({
  id,
  name,
  codes,
  canEdit,
  locked,
  onPick,
}: {
  id: SignalId;
  name: string;
  codes: Readonly<Partial<Record<SignalId, string>>>;
  canEdit: boolean;
  locked: boolean;
  onPick(id: SignalId, meaning: string): void;
}) {
  const saved = codes[id] ?? '';
  const current = selectedMeaning(saved);
  const custom = customText(saved);
  const options = optionsFor(id, codes);
  const disabled = !canEdit || locked;
  return (
    <View style={styles.row} testID={`code-row-${id}`}>
      <Text style={styles.rowTitle}>{name}</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={`Significado de ${name}`}
        style={styles.options}
      >
        {custom !== null ? (
          <View
            accessible
            accessibilityRole="radio"
            accessibilityState={{ checked: true, disabled: true }}
            accessibilityLabel={`Personalizado: ${custom}, escolhido`}
            style={[styles.option, styles.optionOn]}
            testID={`code-custom-${id}`}
          >
            <Text style={styles.optionText}>{`Personalizado: ${custom}`}</Text>
          </View>
        ) : null}
        {options.map((m) => {
          const checked = current !== null && current.id === m.id;
          const text = meaningText(m);
          return (
            <Pressable
              key={m.id}
              accessibilityRole="radio"
              accessibilityState={{ checked, disabled }}
              accessibilityLabel={text}
              aria-checked={checked}
              aria-disabled={disabled}
              disabled={disabled}
              onPress={() => {
                if (!checked) onPick(id, m.label);
              }}
              style={[styles.option, checked && styles.optionOn, disabled && styles.optionOff]}
              testID={`code-option-${id}-${m.id}`}
            >
              <Text style={styles.optionText}>{text}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function CodesPanel(p: CodesPanelProps) {
  const canEdit = p.connected && p.partnerName !== null;
  // Enviado e ainda sem eco do servidor: bloqueia nova escolha (o servidor limita 1 edição por segundo).
  const [pending, setPending] = useState(false);
  useEffect(() => {
    setPending(false);
  }, [p.codes]);
  useEffect(() => {
    if (!pending) return undefined;
    const t = setTimeout(() => setPending(false), PENDING_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [pending]);
  const pick = (id: SignalId, meaning: string): void => {
    if (p.on.save(id, meaning)) setPending(true);
  };
  return (
    <View style={styles.panel} testID="codes-panel" accessibilityViewIsModal>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          Combinar sinais
        </Text>
        <Button label="Fechar" variant="secondary" onPress={p.on.close} testID="codes-close" />
      </View>
      <ScrollView contentContainerStyle={styles.content} testID="codes-list">
        <Text style={styles.hint} testID="codes-privacy">
          {CODES_PRIVACY_NOTE}
        </Text>
        {p.partnerName !== null ? (
          <Text style={styles.hint} testID="codes-partner">{`Parceiro: ${p.partnerName}`}</Text>
        ) : (
          <Text style={styles.warn} testID="codes-no-partner">
            {NO_PARTNER_NOTE}
          </Text>
        )}
        {p.guest ? (
          <Text style={styles.hint} testID="codes-guest">
            {GUEST_CODES_NOTE}
          </Text>
        ) : null}
        {p.errorText !== null ? (
          <Text style={styles.error} accessibilityRole="alert" testID="codes-error">
            {p.errorText}
          </Text>
        ) : null}
        {SIGNALS.map((s) => (
          <CodeRow
            key={s.id}
            id={s.id}
            name={s.name}
            codes={p.codes}
            canEdit={canEdit}
            locked={pending}
            onPick={pick}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    padding: spacing.md,
    gap: spacing.sm,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text, fontSize: fontSize.large, fontWeight: fontWeight.heavy },
  content: { gap: spacing.md, paddingBottom: spacing.lg },
  hint: { color: colors.textMuted, fontSize: fontSize.small },
  warn: { color: colors.primary, fontSize: fontSize.small, fontWeight: fontWeight.bold },
  error: { color: colors.danger, fontSize: fontSize.small },
  row: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  rowTitle: { color: colors.text, fontSize: fontSize.body, fontWeight: fontWeight.bold },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  option: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionOn: { backgroundColor: colors.surfaceAlt, borderColor: colors.primary, borderWidth: 2 },
  optionOff: { opacity: 0.55 },
  optionText: { color: colors.text, fontSize: fontSize.small },
});

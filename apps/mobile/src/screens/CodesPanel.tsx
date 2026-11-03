/**
 * Painel "Combinar sinais" (apresentação pura): os 15 sinais do catálogo, cada um com um campo para o
 * significado combinado com o parceiro. Abre na sala de espera (a "preparação") e na mesa. O combinado
 * é privado da dupla: o servidor só o envia aos dois assentos. Todo texto vai como `<Text>`/`TextInput`
 * (nunca HTML). O significado tradicional do catálogo é só sugestão (placeholder), nunca valor salvo.
 */
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SIGNALS } from '@trucaco/avatar';
import { PARTNER_CODE_MAX_LENGTH } from '@trucaco/protocol';
import type { SignalId } from '@trucaco/protocol';
import { colors, fontSize, fontWeight, radius, spacing } from '@trucaco/ui';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';

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

/** O servidor guarda o texto em NFC e sem bordas: compara na mesma forma. */
const clean = (s: string): string => s.normalize('NFC').trim();
const PENDING_TIMEOUT_MS = 2000;

const chars = (s: string): number => Array.from(s).length;

function CodeRow({
  id,
  name,
  suggestion,
  saved,
  canEdit,
  onSave,
}: {
  id: SignalId;
  name: string;
  suggestion: string;
  saved: string;
  canEdit: boolean;
  onSave(id: SignalId, meaning: string): boolean;
}) {
  // `undefined` = sem edição em curso: o campo mostra o que o servidor tem (inclusive a edição do parceiro).
  const [draft, setDraft] = useState<string | undefined>(undefined);
  // Enviado e ainda sem eco do servidor: bloqueia novo envio (evita RATE_LIMITED de toque duplo).
  const [pending, setPending] = useState(false);
  useEffect(() => {
    // O servidor refletiu o que digitei (ou o parceiro chegou ao mesmo texto): volta a seguir o servidor.
    if (draft !== undefined && clean(draft) === saved) setDraft(undefined);
  }, [draft, saved]);
  useEffect(() => {
    setPending(false);
  }, [saved]);
  useEffect(() => {
    if (!pending) return undefined;
    const t = setTimeout(() => setPending(false), PENDING_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [pending]);
  const value = draft ?? saved;
  const dirty = draft !== undefined && clean(draft) !== saved;
  const erasing = dirty && clean(draft) === '';
  const save = () => {
    if (draft === undefined || !canEdit || pending) return;
    if (onSave(id, draft)) setPending(true);
  };
  return (
    <View style={styles.row} testID={`code-row-${id}`}>
      <TextField
        label={name}
        value={value}
        onChangeText={setDraft}
        placeholder={`Ex.: ${suggestion}`}
        maxLength={PARTNER_CODE_MAX_LENGTH}
        autoCapitalize="sentences"
        disabled={!canEdit}
        onSubmit={() => {
          if (dirty) save();
        }}
        testID={`code-input-${id}`}
      />
      <View style={styles.rowFoot}>
        <Text
          style={styles.count}
          accessibilityLabel={`${chars(value)} de ${PARTNER_CODE_MAX_LENGTH} caracteres`}
          testID={`code-count-${id}`}
        >
          {`${chars(value)}/${PARTNER_CODE_MAX_LENGTH}`}
        </Text>
        <Button
          label={erasing ? 'Apagar' : 'Salvar'}
          variant="secondary"
          disabled={!canEdit || !dirty || pending}
          hint={`Salva o significado de ${name} para você e seu parceiro`}
          onPress={save}
          testID={`code-save-${id}`}
        />
      </View>
    </View>
  );
}

export function CodesPanel(p: CodesPanelProps) {
  const canEdit = p.connected && p.partnerName !== null;
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
            suggestion={s.meaning}
            saved={p.codes[s.id] ?? ''}
            canEdit={canEdit}
            onSave={p.on.save}
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
  rowFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { color: colors.textMuted, fontSize: fontSize.caption },
});

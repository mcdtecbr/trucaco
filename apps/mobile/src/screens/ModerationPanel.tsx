import { REPORT_TEXT_MAX_LENGTH } from '@trucaco/protocol';
import type { ReportReason } from '@trucaco/protocol';
import { Button } from '../ui/Button';
import { ChoiceGroup } from '../ui/Choice';
import { TextField } from '../ui/TextField';
import { Body, Card, ErrorText, Heading } from '../ui/Typography';
import { REPORT_REASON_OPTIONS } from '../profile/history';

export interface ModerationTarget {
  readonly userId: string;
  readonly nickname: string;
  /** Partida em que jogaram juntos (o servidor valida). */
  readonly matchId: string;
}

export interface ModerationState {
  readonly mode: 'block' | 'report';
  readonly target: ModerationTarget;
  readonly reason: ReportReason | null;
  readonly text: string;
  readonly busy: boolean;
  readonly error: string | null;
  /** Mensagem de sucesso: o painel mostra só ela e o botão de fechar. */
  readonly done: string | null;
}

export const BLOCK_NOTE =
  'O bloqueio vale na fila pública e nas próximas mesas. Não afeta a partida em andamento.';
export const REPORT_NOTE =
  'A denúncia é enviada à moderação. Vale para partidas em que vocês jogaram juntos.';

export interface ModerationPanelProps {
  state: ModerationState;
  on: {
    reason(r: ReportReason): void;
    text(t: string): void;
    confirm(): void;
    cancel(): void;
  };
}

/** Confirmação de bloquear ou denunciar. Só texto; nada é interpretado como HTML. */
export function ModerationPanel({ state, on }: ModerationPanelProps) {
  const { mode, target } = state;
  const heading =
    mode === 'block' ? `Bloquear ${target.nickname}?` : `Denunciar ${target.nickname}`;
  if (state.done !== null) {
    return (
      <Card>
        <Body testID="moderation-done">{state.done}</Body>
        <Button label="Fechar" variant="secondary" onPress={on.cancel} testID="moderation-close" />
      </Card>
    );
  }
  const confirmLabel = mode === 'block' ? `Bloquear ${target.nickname}` : 'Enviar denúncia';
  return (
    <Card>
      <Heading>{heading}</Heading>
      <Body muted>{mode === 'block' ? BLOCK_NOTE : REPORT_NOTE}</Body>
      {mode === 'report' ? (
        <>
          <ChoiceGroup
            label="Motivo"
            options={REPORT_REASON_OPTIONS}
            value={state.reason ?? ('' as ReportReason)}
            onChange={on.reason}
            disabled={state.busy}
            testID="report-reason"
          />
          <TextField
            label={`Detalhes (opcional, até ${REPORT_TEXT_MAX_LENGTH} caracteres)`}
            value={state.text}
            onChangeText={on.text}
            maxLength={REPORT_TEXT_MAX_LENGTH}
            disabled={state.busy}
            testID="report-text"
          />
        </>
      ) : null}
      {state.error !== null ? <ErrorText testID="moderation-error">{state.error}</ErrorText> : null}
      <Button
        label={state.busy ? 'Enviando…' : confirmLabel}
        onPress={on.confirm}
        disabled={state.busy || (mode === 'report' && state.reason === null)}
        testID="moderation-confirm"
      />
      <Button
        label="Cancelar"
        variant="secondary"
        onPress={on.cancel}
        disabled={state.busy}
        testID="moderation-cancel"
      />
    </Card>
  );
}

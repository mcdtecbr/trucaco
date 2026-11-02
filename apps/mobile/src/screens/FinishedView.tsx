import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { Body, Card, Title } from '../ui/Typography';

export interface FinishedViewProps {
  /** Placar final em texto, se o estado trouxe (ex.: "Nós 12 × 8 Eles"). */
  summary: string | null;
  onLeave(): void;
}

/**
 * Fim da partida (3H1: placeholder). Extensão no 3H2: resultado da série, vencedor, "jogar de novo".
 */
export function FinishedView({ summary, onLeave }: FinishedViewProps) {
  return (
    <Screen testID="table-finished">
      <Title>Partida encerrada</Title>
      <Card>
        <Body>A partida terminou.</Body>
        {summary !== null ? <Body muted>{summary}</Body> : null}
      </Card>
      <Button label="Voltar ao início" onPress={onLeave} testID="leave-table" />
    </Screen>
  );
}

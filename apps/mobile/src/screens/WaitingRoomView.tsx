import { StyleSheet, Text, View } from 'react-native';
import { errorMessage } from '../i18n/errors';
import { formatCodeDisplay } from '../lobby/codeInput';
import type { LobbySeat, RoomConnection } from '../store/roomStore';
import { AvatarPlaceholder, colors, fontSize, spacing } from '@trucaco/ui';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { Body, Card, ErrorText, Heading, Notice, Title } from '../ui/Typography';

export const TABLE_SEATS = 4;

export interface WaitingRoomViewProps {
  roomCode: string;
  seats: readonly LobbySeat[];
  mySeat: number;
  connection: RoomConnection;
  errorCode: string | null;
  shareLabel: string;
  shareDoneText: string;
  shareFailedText: string;
  shareFeedback: 'idle' | 'done' | 'failed';
  on: { share(): void; leave(): void };
}

/** Texto do status de um assento (vem do estado do servidor; nunca HTML). */
export function seatCaption(seat: LobbySeat | undefined, isMe: boolean): string {
  if (seat === undefined || seat.status === 'empty') return 'Aguardando jogador…';
  const base =
    seat.status === 'away' ? 'Ausente' : seat.status === 'bot' || seat.isBot ? 'Bot' : 'Conectado';
  return isMe ? `${base} (você)` : base;
}

export function WaitingRoomView(p: WaitingRoomViewProps) {
  const seated = p.seats.filter((s) => s.status !== 'empty').length;
  const bySeat = new Map(p.seats.map((s) => [s.seat, s]));
  return (
    <Screen testID="waiting-room">
      <Title>Sala de espera</Title>

      <Card>
        <Body muted>Código da mesa</Body>
        <Text
          accessibilityLabel={`Código da mesa: ${p.roomCode.split('').join(' ')}`}
          selectable
          style={styles.code}
          testID="room-code"
        >
          {formatCodeDisplay(p.roomCode)}
        </Text>
        <Button
          label={p.shareLabel}
          variant="secondary"
          onPress={p.on.share}
          disabled={p.roomCode === ''}
          testID="share-code"
        />
        {p.shareFeedback === 'done' ? <Body testID="share-done">{p.shareDoneText}</Body> : null}
        {p.shareFeedback === 'failed' ? <ErrorText>{p.shareFailedText}</ErrorText> : null}
      </Card>

      {p.connection === 'reconnecting' ? (
        <Notice testID="room-reconnecting">Reconectando…</Notice>
      ) : null}
      {p.connection === 'closed' ? (
        <ErrorText testID="room-closed">{errorMessage(p.errorCode ?? 'ROOM_NOT_FOUND')}</ErrorText>
      ) : null}

      <Card>
        <Heading>{`Jogadores (${seated} de ${TABLE_SEATS})`}</Heading>
        <Text accessibilityLiveRegion="polite" style={styles.count} testID="seated-count">
          {seated}
        </Text>
        {Array.from({ length: TABLE_SEATS }, (_, i) => {
          const seat = bySeat.get(i);
          const empty = seat === undefined || seat.status === 'empty';
          return (
            <View key={i} testID={`seat-${i}`} style={styles.seat}>
              <AvatarPlaceholder
                nickname={empty ? '—' : seat.nickname}
                caption={seatCaption(seat, i === p.mySeat)}
              />
            </View>
          );
        })}
        <Body muted>A partida começa quando os 4 lugares estiverem ocupados.</Body>
      </Card>

      <Button label="Sair da mesa" variant="secondary" onPress={p.on.leave} testID="leave-table" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: {
    color: colors.primary,
    fontSize: fontSize.code,
    fontWeight: '800',
    letterSpacing: 4,
    textAlign: 'center',
  },
  count: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  seat: { paddingVertical: spacing.xs },
});

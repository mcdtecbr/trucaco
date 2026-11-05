import { StyleSheet, Text, View } from 'react-native';
import { errorMessage } from '../i18n/errors';
import { formatCodeDisplay } from '../lobby/codeInput';
import type { LobbySeat, RoomConnection } from '../store/roomStore';
import { AvatarPlaceholder, colors, fontSize, spacing } from '@trucaco/ui';
import { SEAT_AVATAR_SIZE, SeatAvatar } from './SeatAvatar';
import { Button } from '../ui/Button';
import { ChatPanel } from './ChatPanel';
import type { ChatPanelProps } from './ChatPanel';
import { CodesPanel } from './CodesPanel';
import type { CodesPanelProps } from './CodesPanel';
import { Screen } from '../ui/Screen';
import { Body, Card, ErrorText, Heading, Notice, Title } from '../ui/Typography';

export const TABLE_SEATS = 4;

/** Na espera não há sinais (o servidor só os aceita com a partida em andamento). */
const NO_SIGNAL_END = (): void => undefined;

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
  /** Painel de chat (abas Mesa e Dupla) ou null. Omitido = sem chat. */
  chatPanel?: ChatPanelProps | null;
  chatUnreadTotal?: number;
  /** Painel "Combinar sinais" aberto (props prontas) ou null/omitido. */
  codesPanel?: CodesPanelProps | null;
  /** Preferência do sistema de menos movimento (animações ociosas do avatar). */
  reduceMotion?: boolean;
  on: { share(): void; leave(): void; openChat?(): void; openCodes?(): void };
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
  const unread = p.chatUnreadTotal ?? 0;
  return (
    <View style={styles.root}>
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
          <ErrorText testID="room-closed">
            {errorMessage(p.errorCode ?? 'ROOM_NOT_FOUND')}
          </ErrorText>
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
                  {...(seat !== undefined && !empty
                    ? {
                        avatar: (
                          <SeatAvatar
                            seat={i}
                            size={SEAT_AVATAR_SIZE.phone}
                            parts={seat.avatar}
                            signal={null}
                            reduceMotion={p.reduceMotion === true}
                            onSignalEnd={NO_SIGNAL_END}
                          />
                        ),
                      }
                    : {})}
                />
              </View>
            );
          })}
          <Body muted>A partida começa quando os 4 lugares estiverem ocupados.</Body>
        </Card>

        {p.on.openChat !== undefined ? (
          <Button
            label={unread > 0 ? `Chat (${unread})` : 'Chat'}
            variant="secondary"
            onPress={p.on.openChat}
            testID="open-chat"
          />
        ) : null}
        {p.on.openCodes !== undefined && p.mySeat >= 0 ? (
          <Button
            label="Combinar sinais"
            variant="secondary"
            hint="Combine com o seu parceiro o significado de cada sinal. Os adversários não veem."
            onPress={p.on.openCodes}
            testID="open-codes"
          />
        ) : null}
        <Button
          label="Sair da mesa"
          variant="secondary"
          onPress={p.on.leave}
          testID="leave-table"
        />
      </Screen>
      {p.chatPanel !== undefined && p.chatPanel !== null ? <ChatPanel {...p.chatPanel} /> : null}
      {p.codesPanel !== undefined && p.codesPanel !== null ? (
        <CodesPanel {...p.codesPanel} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
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

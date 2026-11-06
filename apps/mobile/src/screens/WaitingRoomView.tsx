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

/** Controles de bots de vaga: só existem para o host de mesa privada (o servidor valida de novo). */
export interface BotControls {
  /** Mensagem pt-BR do último erro de bot (NOT_HOST etc.) ou null. */
  errorText: string | null;
  on: { setBot(seat: number, enabled: boolean): void; fill(): void };
}

export const BOTS_NOT_COUNTED_TEXT = 'Partidas com bots não contam para conquistas nem ranking.';

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
  /** Host de mesa privada: adicionar/remover bots e iniciar com bots. Omitido/null = sem controles. */
  bots?: BotControls | null;
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
  const botSeats = p.seats.filter((s) => s.status === 'bot' || s.isBot).length;
  const humans = seated - botSeats;
  const vacancies = TABLE_SEATS - seated;
  const bots = p.bots ?? null;
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
            const isBotSeat = !empty && (seat.status === 'bot' || seat.isBot);
            return (
              <View key={i} testID={`seat-${i}`} style={styles.seat}>
                <View style={styles.seatInfo}>
                  <AvatarPlaceholder
                    nickname={empty ? '—' : seat.nickname}
                    caption={seatCaption(seat, i === p.mySeat)}
                    {...(seat !== undefined && !empty
                      ? {
                          avatar: (
                            <SeatAvatar
                              seat={i}
                              size={SEAT_AVATAR_SIZE.phone}
                              shape="circle"
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
                {bots !== null && empty ? (
                  <Button
                    label="Adicionar bot"
                    variant="secondary"
                    hint={`Coloca um bot no lugar ${i + 1}`}
                    onPress={() => bots.on.setBot(i, true)}
                    testID={`bot-add-${i}`}
                  />
                ) : null}
                {bots !== null && isBotSeat ? (
                  <Button
                    label="Remover bot"
                    variant="secondary"
                    hint={`Libera o lugar ${i + 1}`}
                    onPress={() => bots.on.setBot(i, false)}
                    testID={`bot-remove-${i}`}
                  />
                ) : null}
              </View>
            );
          })}
          <Body muted>A partida começa quando os 4 lugares estiverem ocupados.</Body>
          {botSeats > 0 ? <Notice testID="bots-notice">{BOTS_NOT_COUNTED_TEXT}</Notice> : null}
          {bots !== null && bots.errorText !== null ? (
            <ErrorText testID="bots-error">{bots.errorText}</ErrorText>
          ) : null}
          {bots !== null ? (
            <Button
              label="Iniciar com bots nas vagas"
              hint="Preenche os lugares livres com bots e começa a partida"
              onPress={bots.on.fill}
              disabled={vacancies < 1 || humans < 1 || p.connection !== 'connected'}
              testID="fill-bots"
            />
          ) : null}
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
  seat: {
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  seatInfo: { flexShrink: 1 },
});

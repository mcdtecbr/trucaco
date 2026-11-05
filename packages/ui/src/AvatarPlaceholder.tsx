import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, fontWeight, radius, spacing, teamColors } from './tokens';

export type AvatarStatus = 'empty' | 'connected' | 'away' | 'bot';

const STATUS_TEXT: Readonly<Record<AvatarStatus, string>> = {
  empty: 'vaga',
  connected: 'online',
  away: 'ausente',
  bot: 'bot',
};

const STATUS_COLOR: Readonly<Record<AvatarStatus, string>> = {
  empty: colors.border,
  connected: colors.success,
  away: colors.primary,
  bot: colors.textMuted,
};

/** Altura da linha do apelido sob o avatar na mesa e espaço até o avatar (px). */
export const SEAT_NAME_H = 16;
export const SEAT_NAME_GAP = 2;

/** Primeira letra do apelido (code point inteiro), ou `?` se vazio. Texto puro. */
export function initialOf(nickname: string): string {
  const first = [...nickname.trim()][0];
  return first === undefined ? '?' : first.toUpperCase();
}

/** Texto de status em pt-BR (também lido pelo leitor de tela). */
export function statusText(status: AvatarStatus): string {
  return STATUS_TEXT[status];
}

/** Converte o `status` do snapshot (string) para o tipo local; valor desconhecido vira `empty`. */
export function asAvatarStatus(x: string): AvatarStatus {
  return x === 'connected' || x === 'away' || x === 'bot' ? x : 'empty';
}

export interface AvatarPlaceholderProps {
  readonly nickname: string;
  /** Sem status: sem indicador (usado fora da mesa). */
  readonly status?: AvatarStatus;
  /** Texto extra (ex.: "sua vez"). */
  readonly caption?: string;
  /** Perspectiva: minha dupla (azul) ou adversária (laranja). Independe do número da dupla. */
  readonly side?: 'mine' | 'theirs';
  /** Destaca quem joga agora. */
  readonly active?: boolean;
  readonly layout?: 'row' | 'column';
  /** Raio do anel do avatar desenhado (px). Omitido = anel redondo; informado = quadrado arredondado. */
  readonly ringRadius?: number;
  /**
   * Apelido numa linha logo abaixo do avatar, fora do quadrado (altura fixa `SEAT_NAME_H`), com o ponto
   * de conexão ao lado do texto. O status só vira texto quando não é "online".
   */
  readonly nameBelow?: boolean;
  /** Largura da linha do apelido (px); omitida = largura do conteúdo. */
  readonly nameWidth?: number;
  /** Espaço entre o avatar e o apelido (px). Padrão `SEAT_NAME_GAP`. */
  readonly nameGap?: number;
  /**
   * Avatar desenhado pelo app (`<Avatar>` de `@trucaco/avatar`; `ui` não depende desse pacote). Quando
   * presente e a vaga não está vazia, substitui o círculo com a inicial; o anel de time e o destaque
   * de "vez" continuam. Vaga vazia mostra sempre o placeholder.
   */
  readonly avatar?: ReactNode;
  readonly testID?: string;
}

/** Círculo com inicial, apelido e status (o avatar Rive entra na Fase 4). Apelido sempre em `<Text>`. */
export function AvatarPlaceholder(p: AvatarPlaceholderProps) {
  const status = p.status;
  const empty = status === 'empty';
  const name = empty ? 'Vaga livre' : p.nickname;
  const column = p.layout === 'column';
  const team = p.side === undefined ? null : teamColors[p.side];
  const parts = [
    name,
    status === undefined || empty ? null : STATUS_TEXT[status],
    p.caption,
  ].filter((x): x is string => x !== null && x !== undefined && x !== '');
  return (
    <View
      accessible
      accessibilityLabel={parts.join(', ')}
      {...(p.testID !== undefined ? { testID: p.testID } : {})}
      style={[styles.wrap, column && styles.column]}
    >
      <View
        style={[
          p.avatar !== undefined && !empty ? styles.ring : styles.circle,
          p.avatar !== undefined && !empty && p.ringRadius !== undefined
            ? { borderRadius: p.ringRadius }
            : null,
          empty && styles.circleEmpty,
          team !== null && !empty && { borderColor: team.main },
          p.active === true && styles.active,
        ]}
      >
        {p.avatar !== undefined && !empty ? (
          p.avatar
        ) : (
          <Text style={styles.initial}>{empty ? '·' : initialOf(p.nickname)}</Text>
        )}
        {p.nameBelow !== true && status !== undefined && !empty ? (
          <View style={[styles.dot, { backgroundColor: STATUS_COLOR[status] }]} />
        ) : null}
      </View>
      {p.nameBelow === true ? (
        <View
          style={[
            styles.nameRow,
            {
              marginTop: p.nameGap ?? SEAT_NAME_GAP,
              ...(p.nameWidth !== undefined ? { width: p.nameWidth } : {}),
            },
          ]}
          pointerEvents="none"
          testID="seat-name"
        >
          {status !== undefined && !empty ? (
            <View style={[styles.nameDot, { backgroundColor: STATUS_COLOR[status] }]} />
          ) : null}
          <Text style={styles.nameText} numberOfLines={1}>
            {[name, status === 'away' || status === 'bot' ? STATUS_TEXT[status] : '']
              .filter((x) => x !== '')
              .join(' · ')}
          </Text>
        </View>
      ) : null}
      <View
        style={[styles.texts, column && styles.textsColumn, p.nameBelow === true && styles.hidden]}
      >
        <Text style={styles.nick} numberOfLines={column ? 2 : 1}>
          {name}
        </Text>
        <Text style={styles.caption} numberOfLines={1}>
          {[status === undefined || empty ? '' : STATUS_TEXT[status], p.caption ?? '']
            .filter((x) => x !== '')
            .join(' · ')}
        </Text>
      </View>
    </View>
  );
}

const SIZE = 48;
const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: SIZE + spacing.sm,
  },
  column: { flexDirection: 'column', gap: spacing.xs, minHeight: 0 },
  circle: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.round,
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Anel do avatar desenhado: o tamanho vem do conteúdo. */
  ring: {
    borderRadius: radius.round,
    borderWidth: 3,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleEmpty: { backgroundColor: colors.surface, borderStyle: 'dashed' },
  active: { borderColor: colors.focus },
  dot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 14,
    height: 14,
    borderRadius: radius.round,
    borderWidth: 2,
    borderColor: colors.background,
  },
  hidden: { display: 'none' },
  nameRow: {
    height: SEAT_NAME_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  nameDot: { width: 8, height: 8, borderRadius: radius.round, flexShrink: 0 },
  nameText: {
    flexShrink: 1,
    color: colors.text,
    fontSize: fontSize.caption,
    lineHeight: SEAT_NAME_H,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
  },
  initial: { color: colors.onPrimary, fontSize: fontSize.large, fontWeight: fontWeight.heavy },
  texts: { flexShrink: 1 },
  textsColumn: { alignItems: 'center', maxWidth: 96 },
  nick: { color: colors.text, fontSize: fontSize.small, fontWeight: fontWeight.bold },
  caption: { color: colors.textMuted, fontSize: fontSize.caption },
});

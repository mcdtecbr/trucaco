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
          styles.circle,
          empty && styles.circleEmpty,
          team !== null && !empty && { borderColor: team.main },
          p.active === true && styles.active,
        ]}
      >
        <Text style={styles.initial}>{empty ? '·' : initialOf(p.nickname)}</Text>
        {status !== undefined && !empty ? (
          <View style={[styles.dot, { backgroundColor: STATUS_COLOR[status] }]} />
        ) : null}
      </View>
      <View style={[styles.texts, column && styles.textsColumn]}>
        <Text style={styles.nick} numberOfLines={1}>
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
  initial: { color: colors.onPrimary, fontSize: fontSize.large, fontWeight: fontWeight.heavy },
  texts: { flexShrink: 1 },
  textsColumn: { alignItems: 'center', maxWidth: 96 },
  nick: { color: colors.text, fontSize: fontSize.small, fontWeight: fontWeight.bold },
  caption: { color: colors.textMuted, fontSize: fontSize.caption },
});

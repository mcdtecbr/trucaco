/**
 * Chat da mesa sempre visível durante a partida (apresentação pura): últimas mensagens e um campo de
 * texto com "Enviar" (Enter envia), sem abrir camada. `corner` (web largo): painel no canto inferior
 * direito com a lista rolável. `compact` (retrato e celular deitado): 1 a 2 mensagens e o campo; o botão
 * de expandir abre o painel completo (`ChatPanel`), com abas e frases rápidas. Todo texto vai por
 * `ChatText` (`<Text>`, nunca HTML). Só o chat da mesa (`scope: 'table'`).
 */
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CHAT_MAX_LENGTH } from '@trucaco/protocol';
import { ChatText, MIN_TOUCH, colors, fontSize, fontWeight, radius, spacing } from '@trucaco/ui';

export interface ChatDockLine {
  readonly id: string;
  readonly author: string;
  readonly text: string;
}

export interface ChatDockProps {
  readonly variant: 'corner' | 'compact';
  /** Mensagens visíveis; omitido = `CHAT_DOCK_LINES[variant]`. */
  readonly maxLines?: number;
  /** Mensagens da mesa já filtradas (silenciados fora), da mais antiga para a mais nova. */
  readonly lines: readonly ChatDockLine[];
  readonly draft: string;
  readonly connected: boolean;
  /** Mensagens novas da mesa (selo no botão de expandir). */
  readonly unread: number;
  readonly errorText: string | null;
  readonly on: {
    setDraft(text: string): void;
    send(): void;
    expand(): void;
  };
}

/** Quantas mensagens cada variante mostra. */
export const CHAT_DOCK_LINES = { corner: 6, compact: 2 } as const;
/** Largura do painel no canto (web largo). */
export const CHAT_DOCK_WIDTH = 280;

export function ChatDock(p: ChatDockProps) {
  const shown = p.lines.slice(-(p.maxLines ?? CHAT_DOCK_LINES[p.variant]));
  const corner = p.variant === 'corner';
  const canSend = p.connected && p.draft.trim() !== '';
  return (
    <View
      style={[styles.box, corner ? styles.boxCorner : styles.boxCompact]}
      testID="chat-dock"
      accessibilityLabel="Chat da mesa"
    >
      <View style={styles.listRow}>
        {corner ? (
          <ScrollView
            style={styles.listCorner}
            contentContainerStyle={styles.listContent}
            testID="chat-dock-list"
          >
            {shown.length === 0 ? (
              <Text style={styles.empty}>Nenhuma mensagem ainda.</Text>
            ) : (
              shown.map((c) => (
                <ChatText
                  key={c.id}
                  author={c.author}
                  text={c.text}
                  testID={`chat-dock-line-${c.id}`}
                />
              ))
            )}
          </ScrollView>
        ) : (
          <View style={styles.listCompact} testID="chat-dock-list">
            {shown.length === 0 ? (
              <Text style={styles.empty} numberOfLines={1}>
                Nenhuma mensagem ainda.
              </Text>
            ) : (
              shown.map((c) => (
                <Text key={c.id} numberOfLines={1} style={styles.compactLine}>
                  <Text style={styles.author}>{c.author}: </Text>
                  {c.text}
                </Text>
              ))
            )}
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            p.unread > 0
              ? `Abrir o chat completo, ${p.unread} mensagens novas`
              : 'Abrir o chat completo'
          }
          onPress={p.on.expand}
          style={styles.expand}
          testID="chat-dock-open"
        >
          <Text style={styles.expandText}>{'⤢'}</Text>
          {p.unread > 0 ? (
            <View style={styles.badge} importantForAccessibility="no-hide-descendants">
              <Text style={styles.badgeText}>{p.unread > 9 ? '9+' : String(p.unread)}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>
      {p.errorText !== null ? (
        <Text style={styles.error} accessibilityRole="alert" testID="chat-dock-error">
          {p.errorText}
        </Text>
      ) : null}
      <View style={styles.inputRow}>
        <TextInput
          accessibilityLabel="Mensagem para a mesa"
          value={p.draft}
          onChangeText={p.on.setDraft}
          onSubmitEditing={p.on.send}
          editable={p.connected}
          maxLength={CHAT_MAX_LENGTH}
          autoCapitalize="sentences"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="send"
          placeholder="Escreva para a mesa"
          placeholderTextColor={colors.textMuted}
          style={[styles.input, !p.connected && styles.disabled]}
          testID="chat-dock-input"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Enviar mensagem"
          aria-disabled={!canSend}
          disabled={!canSend}
          onPress={p.on.send}
          style={[styles.send, !canSend && styles.disabled]}
          testID="chat-dock-send"
        >
          <Text style={styles.sendText}>Enviar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: radius.md,
    padding: spacing.xs,
    gap: spacing.xs,
  },
  boxCorner: { width: CHAT_DOCK_WIDTH },
  boxCompact: { alignSelf: 'stretch', minWidth: 0 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  listCorner: { flex: 1, height: 64 },
  listCompact: { flex: 1, minHeight: 32, justifyContent: 'flex-end' },
  listContent: { gap: 2 },
  compactLine: { color: colors.text, fontSize: fontSize.caption, lineHeight: 16 },
  author: { fontWeight: fontWeight.bold, color: colors.textMuted },
  empty: { color: colors.textMuted, fontSize: fontSize.caption },
  expand: {
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandText: { color: colors.text, fontSize: fontSize.large, fontWeight: fontWeight.bold },
  badge: {
    position: 'absolute',
    top: 2,
    right: 0,
    minWidth: 18,
    height: 18,
    borderRadius: radius.round,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: colors.onPrimary, fontSize: 11, fontWeight: fontWeight.heavy },
  error: { color: colors.danger, fontSize: fontSize.caption },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: MIN_TOUCH,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: fontSize.small,
    paddingHorizontal: spacing.sm,
  },
  send: {
    minHeight: MIN_TOUCH,
    minWidth: MIN_TOUCH + spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { color: colors.onPrimary, fontSize: fontSize.small, fontWeight: fontWeight.heavy },
  disabled: { opacity: 0.5 },
});

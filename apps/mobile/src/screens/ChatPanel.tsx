/**
 * Painel de chat da mesa (apresentação pura). Duas abas separadas: "Mesa" (todos) e "Dupla" (privado
 * com o parceiro). Todo texto vai por `ChatText` (`<Text>`, nunca HTML). O envio passa pela validação
 * do protocol no controlador; aqui só há campo, frases rápidas e lista.
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CHAT_MAX_LENGTH, QUICK_PHRASES } from '@trucaco/protocol';
import type { ChatScope } from '@trucaco/protocol';
import { ChatText, MIN_TOUCH, colors, fontSize, fontWeight, radius, spacing } from '@trucaco/ui';
import type { ChatEntry } from '../table/tableStore';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';

export interface ChatPanelProps {
  tab: ChatScope;
  chat: readonly ChatEntry[];
  unread: Readonly<Record<ChatScope, number>>;
  draft: string;
  /** Texto pt-BR do último erro de chat (já traduzido), ou null. */
  errorText: string | null;
  connected: boolean;
  nicknameOf(seat: number): string;
  mySeat: number;
  on: {
    setTab(scope: ChatScope): void;
    setDraft(text: string): void;
    send(): void;
    phrase(id: string): void;
    close(): void;
  };
}

const TABS: readonly { scope: ChatScope; label: string }[] = [
  { scope: 'table', label: 'Mesa' },
  { scope: 'partner', label: 'Dupla' },
];

export function ChatPanel(p: ChatPanelProps) {
  const lines = p.chat.filter((c) => c.scope === p.tab);
  return (
    <View style={styles.panel} testID="chat-panel" accessibilityViewIsModal>
      <View style={styles.header}>
        <View style={styles.tabs} accessibilityRole="tablist">
          {TABS.map((t) => {
            const selected = p.tab === t.scope;
            const n = p.unread[t.scope];
            return (
              <Pressable
                key={t.scope}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={n > 0 ? `${t.label}, ${n} novas` : t.label}
                onPress={() => p.on.setTab(t.scope)}
                style={[styles.tab, selected && styles.tabOn]}
                testID={`chat-tab-${t.scope}`}
              >
                <Text style={styles.tabText}>{n > 0 ? `${t.label} (${n})` : t.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Button label="Fechar" variant="secondary" onPress={p.on.close} testID="chat-close" />
      </View>
      {p.tab === 'partner' ? (
        <Text style={styles.hint}>Só a sua dupla vê esta conversa.</Text>
      ) : null}
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} testID="chat-list">
        {lines.length === 0 ? (
          <Text style={styles.empty}>Nenhuma mensagem ainda.</Text>
        ) : (
          lines.map((c) => (
            <ChatText
              key={c.id}
              author={
                c.seat === p.mySeat ? 'Você' : p.nicknameOf(c.seat) || `Jogador ${c.seat + 1}`
              }
              text={c.text}
              testID={`chat-line-${c.id}`}
            />
          ))
        )}
      </ScrollView>
      <ScrollView
        horizontal
        contentContainerStyle={styles.phrases}
        accessibilityLabel="Frases rápidas"
      >
        {QUICK_PHRASES.map((q) => (
          <Pressable
            key={q.id}
            accessibilityRole="button"
            accessibilityLabel={q.label}
            aria-disabled={!p.connected}
            disabled={!p.connected}
            onPress={() => p.on.phrase(q.id)}
            style={styles.phrase}
            testID={`chat-phrase-${q.id}`}
          >
            <Text style={styles.phraseText}>{q.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {p.errorText !== null ? (
        <Text style={styles.error} accessibilityRole="alert" testID="chat-error">
          {p.errorText}
        </Text>
      ) : null}
      <TextField
        label={p.tab === 'partner' ? 'Mensagem para a dupla' : 'Mensagem para a mesa'}
        value={p.draft}
        onChangeText={p.on.setDraft}
        maxLength={CHAT_MAX_LENGTH}
        autoCapitalize="sentences"
        onSubmit={p.on.send}
        disabled={!p.connected}
        testID="chat-input"
      />
      <Button
        label="Enviar"
        onPress={p.on.send}
        disabled={!p.connected || p.draft.trim() === ''}
        testID="chat-send"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '75%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    borderTopWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tabs: { flexDirection: 'row', gap: spacing.sm },
  tab: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabOn: { backgroundColor: colors.surfaceAlt, borderColor: colors.primary },
  tabText: { color: colors.text, fontSize: fontSize.small, fontWeight: fontWeight.bold },
  hint: { color: colors.textMuted, fontSize: fontSize.caption },
  list: { minHeight: 80, maxHeight: 220 },
  listContent: { gap: spacing.xs },
  empty: { color: colors.textMuted, fontSize: fontSize.small },
  phrases: { gap: spacing.sm },
  phrase: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  phraseText: { color: colors.text, fontSize: fontSize.small },
  error: { color: colors.danger, fontSize: fontSize.small },
});

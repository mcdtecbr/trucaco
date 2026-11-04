/**
 * Criador de avatar (apresentação pura): uma variante por parte, pré-visualização ao vivo e salvar.
 * Os rótulos das variantes vêm de `PART_VARIANT_NAMES` (a mesma ordem dos índices gravados). Estado e
 * rede ficam no container (`AvatarEditorScreen`).
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar, PART_VARIANT_NAMES } from '@trucaco/avatar';
import { AVATAR_PART_COUNTS, HAIR_WITHOUT_HAT, isHatAllowed } from '@trucaco/protocol';
import type { AvatarPartKey, AvatarParts, VoiceId } from '@trucaco/protocol';
import { MIN_TOUCH, colors, fontSize, radius, spacing } from '@trucaco/ui';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { voiceOf } from './avatarEditorState';
import { VoicePicker } from './VoicePicker';
import { Body, Card, ErrorText, Heading, Title } from '../ui/Typography';

/** Lado da pré-visualização (px). */
export const PREVIEW_SIZE = 128;

/** Nome de cada parte em pt-BR (o nome das variantes é `PART_VARIANT_NAMES`). */
export const PART_TITLES: Readonly<Record<AvatarPartKey, string>> = {
  face_shape: 'Formato do rosto',
  skin: 'Pele',
  hair: 'Cabelo',
  eyes: 'Olhos',
  mouth: 'Boca',
  outfit: 'Roupa',
  accessory: 'Acessório',
  bg_color: 'Fundo',
  hair_color: 'Cor do cabelo',
  eye_color: 'Cor dos olhos',
  outfit_color: 'Cor da roupa',
  brows: 'Sobrancelhas',
  nose: 'Nariz',
  beard: 'Barba',
  hat: 'Chapéu',
};

/** Ordem de exibição no editor: cada cor logo depois da sua forma (a ordem do contrato é outra). */
export const EDITOR_PART_ORDER: readonly AvatarPartKey[] = [
  'face_shape',
  'skin',
  'hair',
  'hair_color',
  'beard',
  'hat',
  'eyes',
  'eye_color',
  'brows',
  'nose',
  'mouth',
  'outfit',
  'outfit_color',
  'accessory',
  'bg_color',
];

/** Dica mostrada junto do chapéu quando o cabelo escolhido não combina com chapéu. */
export const HAT_BLOCKED_HINT = 'Este cabelo não combina com chapéu';

/**
 * Escolha de uma opção no editor, com a regra cabelo/chapéu (`HAIR_WITHOUT_HAT`): escolher um desses cabelos
 * zera o chapéu, e escolher chapéu com um deles já ativo não muda nada.
 */
export function applyPick(cur: AvatarParts, key: AvatarPartKey, index: number): AvatarParts {
  if (key === 'hat' && !isHatAllowed(cur.hair, index)) return cur;
  if (key === 'hair' && HAIR_WITHOUT_HAT.includes(index)) return { ...cur, hair: index, hat: 0 };
  return { ...cur, [key]: index };
}

/** Texto da variante `index` da parte `key` (cai em "Opção N" se o catálogo do avatar for menor). */
export function variantLabel(key: AvatarPartKey, index: number): string {
  const name = PART_VARIANT_NAMES[key][index];
  const text = name ?? `opção ${index + 1}`;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

export interface AvatarEditorViewProps {
  /** Carregando o avatar atual (`GET /me`). */
  loading: boolean;
  /** Texto de erro do carregamento (a tela oferece "Tentar de novo"). */
  loadError: string | null;
  parts: AvatarParts;
  /** Há mudança ainda não salva. */
  dirty: boolean;
  busy: boolean;
  /** Texto de erro do salvamento. */
  error: string | null;
  saved: boolean;
  reduceMotion: boolean;
  /** Resultado do último "Ouvir" (ex.: "Som desligado."). */
  voiceNote?: string | null;
  on: {
    pick(key: AvatarPartKey, index: number): void;
    /** Escolhe a voz. Omitido = o editor não mostra o seletor de voz. */
    voice?(id: VoiceId): void;
    /** Toca a amostra da voz (o container checa som e arquivo). */
    preview?(id: VoiceId): void;
    save(): void;
    reload(): void;
    back(): void;
  };
}

function PartPicker({
  partKey,
  value,
  disabled,
  onPick,
  blocked,
  hint,
}: {
  partKey: AvatarPartKey;
  value: number;
  disabled: boolean;
  onPick(key: AvatarPartKey, index: number): void;
  /** Opções que não podem ser escolhidas agora (ficam desabilitadas). */
  blocked?: (index: number) => boolean;
  hint?: string | undefined;
}) {
  const count = AVATAR_PART_COUNTS[partKey];
  const title = PART_TITLES[partKey];
  return (
    <Card>
      <Heading>{title}</Heading>
      <View accessibilityRole="radiogroup" accessibilityLabel={title} style={styles.options}>
        {Array.from({ length: count }, (_, i) => {
          const checked = i === value;
          const label = variantLabel(partKey, i);
          const off = disabled || blocked?.(i) === true;
          return (
            <Pressable
              key={i}
              accessibilityRole="radio"
              accessibilityLabel={`${title}: ${label}`}
              aria-checked={checked}
              accessibilityState={{ checked, disabled: off }}
              aria-disabled={off}
              disabled={off}
              onPress={() => onPick(partKey, i)}
              style={[styles.option, checked && styles.optionChecked, off && styles.off]}
              testID={`avatar-part-${partKey}-${i}`}
            >
              <Text style={[styles.optionText, checked && styles.optionTextChecked]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      {hint !== undefined ? <Body testID={`avatar-part-${partKey}-hint`}>{hint}</Body> : null}
    </Card>
  );
}

export function AvatarEditorView(p: AvatarEditorViewProps) {
  if (p.loading || p.loadError !== null) {
    return (
      <Screen testID="avatar-editor">
        <Title>Seu avatar</Title>
        {p.loading ? (
          <Body testID="avatar-loading">Carregando seu avatar…</Body>
        ) : (
          <>
            <ErrorText testID="avatar-load-error">{p.loadError}</ErrorText>
            <Button label="Tentar de novo" onPress={p.on.reload} testID="avatar-reload" />
          </>
        )}
        <Button label="Voltar" variant="secondary" onPress={p.on.back} testID="avatar-back" />
      </Screen>
    );
  }
  return (
    <Screen testID="avatar-editor">
      <Title>Seu avatar</Title>
      <View style={styles.preview}>
        <Avatar
          parts={p.parts}
          size={PREVIEW_SIZE}
          reduceMotion={p.reduceMotion}
          accessibilityLabel="Pré-visualização do seu avatar"
          testID="avatar-preview"
        />
      </View>
      {EDITOR_PART_ORDER.map((key) => (
        <PartPicker
          key={key}
          partKey={key}
          value={p.parts[key]}
          disabled={p.busy}
          onPick={p.on.pick}
          {...(key === 'hat' && !isHatAllowed(p.parts.hair, 1)
            ? { blocked: (i: number) => i !== 0, hint: HAT_BLOCKED_HINT }
            : {})}
        />
      ))}
      {p.on.voice !== undefined && p.on.preview !== undefined ? (
        <VoicePicker
          value={voiceOf(p.parts)}
          disabled={p.busy}
          note={p.voiceNote}
          onPick={p.on.voice}
          onPreview={p.on.preview}
        />
      ) : null}
      {p.error !== null ? <ErrorText testID="avatar-error">{p.error}</ErrorText> : null}
      {p.saved && !p.dirty ? <Body testID="avatar-saved">Avatar salvo.</Body> : null}
      <Button
        label={p.busy ? 'Salvando…' : 'Salvar avatar'}
        onPress={p.on.save}
        disabled={p.busy || !p.dirty}
        testID="avatar-save"
      />
      <Button label="Voltar" variant="secondary" onPress={p.on.back} testID="avatar-back" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { alignItems: 'center', paddingVertical: spacing.sm },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  option: {
    minHeight: MIN_TOUCH,
    minWidth: MIN_TOUCH,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionChecked: { backgroundColor: colors.surfaceAlt, borderColor: colors.primary },
  optionText: { color: colors.text, fontSize: fontSize.small },
  optionTextChecked: { fontWeight: '700' },
  off: { opacity: 0.5 },
});

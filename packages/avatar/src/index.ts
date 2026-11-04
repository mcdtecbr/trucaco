export {
  SIGNALS,
  SIGNAL_TRIGGERS,
  MAX_SIGNAL_DURATION_MS,
  signalInfo,
  signalTrigger,
  type SignalInfo,
} from './signals';
export {
  PART_VARIANT_NAMES,
  SKIN_COLORS,
  HAIR_COLORS,
  EYE_COLORS,
  type SkinColor,
  OUTFIT_COLORS,
  BG_COLORS,
  safeIndex,
} from './parts';
export { RIVE_CONTRACT, RIVE_IDLE_STATES, RIVE_INPUT_DOCS, RIVE_MAX_BYTES } from './riveContract';
export { Avatar, pickRenderer, DEFAULT_AVATAR_SIZE } from './Avatar';
export type { AvatarProps, AvatarRendererId } from './Avatar';
export { AvatarFallback, type AvatarFallbackProps } from './AvatarFallback';
export {
  useSignalAnimation,
  useIdleAnimation,
  runSignal,
  REDUCED_MOTION_HIGHLIGHT_MS,
} from './useSignalAnimation';

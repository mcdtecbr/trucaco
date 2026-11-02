export type ShareOutcome = 'done' | 'dismissed' | 'failed';

/** Resultado de `Share.share` do React Native (`sharedAction` | `dismissedAction`). */
export function outcomeFromShareAction(action: string | undefined): ShareOutcome {
  if (action === 'sharedAction') return 'done';
  if (action === 'dismissedAction') return 'dismissed';
  return 'failed';
}

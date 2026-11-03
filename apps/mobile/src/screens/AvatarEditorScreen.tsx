import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_AVATAR_PARTS } from '@trucaco/protocol';
import type { AvatarPartKey, AvatarParts } from '@trucaco/protocol';
import { messageForError } from '../i18n/errors';
import { useReduceMotion } from '../platform/useReduceMotion';
import { getApp } from '../services/app';
import { initialAvatar, samePartsAs } from './avatarEditorState';
import { AvatarEditorView } from './AvatarEditorView';

export function AvatarEditorScreen() {
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState<AvatarParts>(DEFAULT_AVATAR_PARTS);
  const [parts, setParts] = useState<AvatarParts>(DEFAULT_AVATAR_PARTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const me = await getApp().session.api.me();
      if (!alive.current) return;
      const current = initialAvatar(me.avatar);
      setSaved(current);
      setParts(current);
    } catch (e) {
      if (alive.current) setLoadError(messageForError(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (): Promise<void> => {
    if (busy) return;
    setError(null);
    setJustSaved(false);
    setBusy(true);
    try {
      const res = await getApp().session.api.updateAvatar({ ...parts });
      if (!alive.current) return;
      const next = initialAvatar(res.avatar);
      setSaved(next);
      setParts(next);
      setJustSaved(true);
    } catch (e) {
      if (alive.current) setError(messageForError(e)); // 400 INVALID_AVATAR, rede, 401...
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <AvatarEditorView
      loading={loading}
      loadError={loadError}
      parts={parts}
      dirty={!samePartsAs(parts, saved)}
      busy={busy}
      error={error}
      saved={justSaved}
      reduceMotion={reduceMotion}
      on={{
        pick: (key: AvatarPartKey, index: number) => {
          setParts((cur) => ({ ...cur, [key]: index }));
          setJustSaved(false);
          setError(null);
        },
        save: () => void save(),
        reload: () => void load(),
        back: () => (router.canGoBack() ? router.back() : router.replace('/home')),
      }}
    />
  );
}

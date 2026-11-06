import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BlockedUser } from '@trucaco/protocol';
import { useAudioPrefs } from '../audio/useAudioPrefs';
import { messageForError } from '../i18n/errors';
import { errorMessage } from '../i18n/errors';
import { performLogout } from '../lobby/logout';
import { checkNickname } from '../lobby/nickname';
import { getApp } from '../services/app';
import { lobbyStore } from '../store/lobbyStore';
import {
  selectNickname,
  selectProvider,
  sessionStore,
  useSessionStore,
} from '../store/sessionStore';
import { SettingsView } from './SettingsView';
import { useSocialAuth } from './useSocialAuth';

export function SettingsScreen() {
  const router = useRouter();
  const audio = getApp().audio;
  const audioPrefs = useAudioPrefs(audio);
  const nickname = useSessionStore(selectNickname);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const provider = useSessionStore(selectProvider);
  const alive = useRef(true);
  const userId = useSessionStore((st) => st.user?.id ?? null);
  const epoch = useRef(0);
  const social = useSocialAuth('link', () => undefined);
  const [blocksState, setBlocksState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [blocks, setBlocks] = useState<readonly BlockedUser[]>([]);
  const [blocksError, setBlocksError] = useState<string | null>(null);
  const [unblocking, setUnblocking] = useState<string | null>(null);
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const loadBlocks = useCallback(async (): Promise<void> => {
    const my = epoch.current;
    setBlocksState('loading');
    setBlocksError(null);
    try {
      const res = await getApp().session.api.blocks();
      if (!alive.current || my !== epoch.current) return;
      setBlocks(res.blocks);
      setBlocksState('ready');
    } catch (e) {
      if (!alive.current || my !== epoch.current) return;
      setBlocksError(messageForError(e));
      setBlocksState('error');
    }
  }, []);

  // Troca de usuário: a lista de bloqueados do anterior não pode ficar na tela.
  useEffect(() => {
    epoch.current += 1;
    setBlocks([]);
    setUnblocking(null);
    void loadBlocks();
  }, [loadBlocks, userId]);

  const unblock = async (userId: string): Promise<void> => {
    if (unblocking !== null) return;
    setUnblocking(userId);
    setBlocksError(null);
    try {
      await getApp().session.api.unblock(userId);
      if (alive.current) setBlocks((cur) => cur.filter((b) => b.userId !== userId));
    } catch (e) {
      if (alive.current) setBlocksError(messageForError(e));
    } finally {
      if (alive.current) setUnblocking(null);
    }
  };

  /** Apagar conta: sai da fila (melhor esforço), apaga no servidor e só então limpa o estado local. */
  const deleteAccount = async (): Promise<void> => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    const app = getApp();
    sessionStore.getState().beginLogout(); // o signedOut que vem é intencional, não "sessão perdida"
    try {
      try {
        await app.session.api.leaveQueue();
      } catch {
        // Melhor esforço.
      }
      await app.session.deleteAccount();
      lobbyStore.getState().reset();
      router.replace('/');
    } catch (e) {
      sessionStore.setState({ loggingOut: false });
      if (alive.current) setDeleteError(messageForError(e));
    } finally {
      if (alive.current) setDeleting(false);
    }
  };

  const save = async (): Promise<void> => {
    if (busy) return;
    setSaved(false);
    const checked = checkNickname(draft);
    if (!checked.ok) {
      setError(errorMessage('INVALID_NICKNAME_LOCAL'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await getApp().session.setNickname(checked.nickname);
      setDraft('');
      setSaved(true);
    } catch (e) {
      setError(messageForError(e)); // 409 NICKNAME_TAKEN, 400 INVALID_NICKNAME, rede...
    } finally {
      setBusy(false);
    }
  };

  const logout = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const app = getApp();
    try {
      await performLogout({
        beginLogout: () => sessionStore.getState().beginLogout(),
        leaveQueue: () => app.session.api.leaveQueue(),
        logout: () => app.session.logout(),
        resetLobby: () => lobbyStore.getState().reset(),
      });
    } finally {
      setBusy(false);
      router.replace('/');
    }
  };

  const version =
    typeof Constants.expoConfig?.version === 'string' ? Constants.expoConfig.version : '0.0.0';

  return (
    <SettingsView
      nickname={nickname}
      draft={draft}
      busy={busy}
      error={error}
      saved={saved}
      appVersion={version}
      sound={{ prefs: audioPrefs, onChange: (patch) => audio.setPrefs(patch) }}
      legal={{ onTerms: () => router.push('/terms'), onPrivacy: () => router.push('/privacy') }}
      account={{
        provider,
        blocks: { state: blocksState, items: blocks, error: blocksError, busyId: unblocking },
        deletion: { step: deleteStep, busy: deleting, error: deleteError },
        social,
        on: {
          achievements: () => router.push('/achievements'),
          missions: () => router.push('/missions'),
          login: () => router.push('/login'),
          profile: () => router.push('/profile'),
          unblock: (id) => void unblock(id),
          retryBlocks: () => void loadBlocks(),
          deleteStart: () => {
            setDeleteError(null);
            setDeleteStep(1);
          },
          deleteContinue: () => setDeleteStep(2),
          deleteCancel: () => {
            setDeleteError(null);
            setDeleteStep(0);
          },
          deleteConfirm: () => void deleteAccount(),
        },
      }}
      on={{
        draft: (t) => {
          setDraft(t);
          setSaved(false);
        },
        save: () => void save(),
        logout: () => void logout(),
        avatar: () => router.push('/avatar'),
        back: () => (router.canGoBack() ? router.back() : router.replace('/home')),
      }}
    />
  );
}

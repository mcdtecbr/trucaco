import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { messageForError } from '../i18n/errors';
import { errorMessage } from '../i18n/errors';
import { performLogout } from '../lobby/logout';
import { checkNickname } from '../lobby/nickname';
import { getApp } from '../services/app';
import { lobbyStore } from '../store/lobbyStore';
import { selectNickname, sessionStore, useSessionStore } from '../store/sessionStore';
import { SettingsView } from './SettingsView';

export function SettingsScreen() {
  const router = useRouter();
  const nickname = useSessionStore(selectNickname);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
      on={{
        draft: (t) => {
          setDraft(t);
          setSaved(false);
        },
        save: () => void save(),
        logout: () => void logout(),
        back: () => (router.canGoBack() ? router.back() : router.replace('/home')),
      }}
    />
  );
}

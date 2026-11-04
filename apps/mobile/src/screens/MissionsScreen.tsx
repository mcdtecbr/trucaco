import { useRouter } from 'expo-router';
import { getApp } from '../services/app';
import { useSessionStore } from '../store/sessionStore';
import { MissionsView } from './MissionsView';
import { useRemote } from './useRemote';

export function MissionsScreen() {
  const router = useRouter();
  const userId = useSessionStore((s) => s.user?.id ?? '');
  const r = useRemote(async () => (await getApp().session.api.myMissions()).missions, userId);
  return (
    <MissionsView
      state={r.state}
      error={r.error}
      items={r.data ?? []}
      on={{
        retry: r.reload,
        back: () => (router.canGoBack() ? router.back() : router.replace('/home')),
      }}
    />
  );
}

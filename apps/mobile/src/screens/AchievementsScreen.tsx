import { useRouter } from 'expo-router';
import { getApp } from '../services/app';
import { useSessionStore } from '../store/sessionStore';
import { AchievementsView } from './AchievementsView';
import { useRemote } from './useRemote';

export function AchievementsScreen() {
  const router = useRouter();
  const userId = useSessionStore((s) => s.user?.id ?? '');
  const r = useRemote(
    async () => (await getApp().session.api.myAchievements()).achievements,
    userId,
  );
  return (
    <AchievementsView
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

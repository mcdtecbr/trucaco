import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { selectNickname, useSessionStore } from '../store/sessionStore';
import { LoginView } from './LoginView';
import { useSocialAuth } from './useSocialAuth';

export function LoginScreen() {
  const router = useRouter();
  const nickname = useSessionStore(selectNickname);
  const goHome = useCallback(() => router.replace('/home'), [router]);
  const social = useSocialAuth('login', goHome);
  return <LoginView nickname={nickname} social={social} on={{ guest: goHome }} />;
}

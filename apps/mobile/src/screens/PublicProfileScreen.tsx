import { DEFAULT_AVATAR_PARTS, isUuid } from '@trucaco/protocol';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { errorMessage } from '../i18n/errors';
import { useReduceMotion } from '../platform/useReduceMotion';
import { getApp } from '../services/app';
import { PublicProfileView } from './PublicProfileView';
import { useRemote } from './useRemote';

export function PublicProfileScreen() {
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' && isUuid(params.id) ? params.id : null;
  const r = useRemote(async () => {
    if (id === null) throw new Error('id inválido');
    return getApp().session.api.publicProfile(id);
  }, id ?? '');
  const p = r.data;
  const back = (): void => (router.canGoBack() ? router.back() : router.replace('/home'));
  return (
    <PublicProfileView
      state={id === null ? 'error' : r.state}
      error={id === null ? errorMessage('USER_NOT_FOUND') : r.error}
      profile={
        p === null
          ? null
          : {
              nickname: p.nickname,
              avatar: p.avatar ?? DEFAULT_AVATAR_PARTS,
              achievements: p.achievements,
              stats: p.stats,
            }
      }
      reduceMotion={reduceMotion}
      on={{ retry: r.reload, back }}
    />
  );
}

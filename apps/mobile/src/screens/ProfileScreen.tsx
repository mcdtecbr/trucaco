import { useRouter } from 'expo-router';
import { DEFAULT_AVATAR_PARTS } from '@trucaco/protocol';
import type { AvatarParts, MatchSummaryResponse, ReportReason, UserStats } from '@trucaco/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { messageForError } from '../i18n/errors';
import { toHistoryRow } from '../profile/history';
import type { HistoryRow } from '../profile/history';
import { openModeration, submitModeration } from '../profile/moderation';
import { useReduceMotion } from '../platform/useReduceMotion';
import { getApp } from '../services/app';
import { selectNickname, selectProvider, useSessionStore } from '../store/sessionStore';
import type { ModerationState } from './ModerationPanel';
import { ProfileView } from './ProfileView';
import type { LoadState } from './ProfileView';

const PAGE_SIZE = 20;

export function ProfileScreen() {
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const nickname = useSessionStore(selectNickname);
  const provider = useSessionStore(selectProvider);
  const userId = useSessionStore((s) => s.user?.id ?? null);
  const alive = useRef(true);

  const [meState, setMeState] = useState<LoadState>('loading');
  const [meError, setMeError] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<AvatarParts | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);

  const [histState, setHistState] = useState<LoadState>('loading');
  const [histError, setHistError] = useState<string | null>(null);
  const [matches, setMatches] = useState<readonly MatchSummaryResponse[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moderation, setModeration] = useState<ModerationState | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const loadMe = useCallback(async (): Promise<void> => {
    setMeState('loading');
    setMeError(null);
    try {
      const me = await getApp().session.api.me();
      if (!alive.current) return;
      setAvatar(me.avatar ?? DEFAULT_AVATAR_PARTS);
      setStats(me.stats);
      setMeState('ready');
    } catch (e) {
      if (!alive.current) return;
      setMeError(messageForError(e));
      setMeState('error');
    }
  }, []);

  const loadPage = useCallback(async (after: string | null): Promise<void> => {
    const first = after === null;
    if (first) setHistState('loading');
    else setLoadingMore(true);
    setHistError(null);
    try {
      const page = await getApp().session.api.matches(after ?? undefined, PAGE_SIZE);
      if (!alive.current) return;
      setMatches((cur) => {
        if (first) return page.items;
        const seen = new Set(cur.map((m) => m.id));
        return [...cur, ...page.items.filter((m) => !seen.has(m.id))];
      });
      setCursor(page.nextCursor);
      setHistState('ready');
    } catch (e) {
      if (!alive.current) return;
      setHistError(messageForError(e));
      // Falha ao carregar mais mantém a lista já mostrada e o botão para tentar de novo.
      if (first) setHistState('error');
    } finally {
      if (alive.current) setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void loadMe();
    void loadPage(null);
  }, [loadMe, loadPage]);

  const rows: readonly HistoryRow[] =
    userId === null ? [] : matches.map((m) => toHistoryRow(m, userId));

  const confirm = async (): Promise<void> => {
    if (moderation === null || moderation.busy) return;
    setModeration({ ...moderation, busy: true, error: null });
    const next = await submitModeration({ ...moderation, busy: false }, getApp().session.api);
    if (alive.current) setModeration(next);
  };

  return (
    <ProfileView
      nickname={nickname}
      provider={provider}
      avatar={avatar}
      reduceMotion={reduceMotion}
      me={{ state: meState, error: meError, stats }}
      history={{
        state: histState,
        rows,
        hasMore: cursor !== null,
        loadingMore,
        error: histError,
      }}
      moderation={moderation}
      on={{
        back: () => (router.canGoBack() ? router.back() : router.replace('/home')),
        retryMe: () => void loadMe(),
        retryHistory: () => void loadPage(null),
        loadMore: () => {
          if (cursor !== null && !loadingMore) void loadPage(cursor);
        },
        block: (id, name, matchId) =>
          setModeration(openModeration('block', { userId: id, nickname: name, matchId })),
        report: (id, name, matchId) =>
          setModeration(openModeration('report', { userId: id, nickname: name, matchId })),
        moderation: {
          reason: (r: ReportReason) =>
            setModeration((m) => (m === null ? m : { ...m, reason: r, error: null })),
          text: (t) => setModeration((m) => (m === null ? m : { ...m, text: t })),
          confirm: () => void confirm(),
          cancel: () => setModeration(null),
        },
      }}
    />
  );
}

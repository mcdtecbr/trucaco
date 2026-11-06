import { useCallback, useEffect, useRef, useState } from 'react';
import { messageForError } from '../i18n/errors';
import type { LoadState } from './ProfileView';

/** Carrega uma vez (e de novo em `reload`) com estados de carregando, erro traduzido e pronto. */
export function useRemote<T>(
  load: () => Promise<T>,
  key: string = '',
): {
  state: LoadState;
  error: string | null;
  data: T | null;
  reload(): void;
} {
  const alive = useRef(true);
  /** Só a última carga vale: resposta de outro usuário ou de carga anterior é descartada. */
  const seq = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<T | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(async (): Promise<void> => {
    const my = ++seq.current;
    setState('loading');
    setError(null);
    setData(null);
    try {
      const value = await loadRef.current();
      if (!alive.current || my !== seq.current) return;
      setData(value);
      setState('ready');
    } catch (e) {
      if (!alive.current || my !== seq.current) return;
      setError(messageForError(e));
      setState('error');
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run, key]);

  return { state, error, data, reload: () => void run() };
}

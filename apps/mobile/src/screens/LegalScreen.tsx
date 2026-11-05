import { useRouter } from 'expo-router';
import { PRIVACY_MD, TERMS_MD } from '../legal/generated/legalText';
import { LegalView } from './LegalView';

export const LEGAL_DOCS = {
  terms: { title: 'Termos de uso', markdown: TERMS_MD, testID: 'legal-terms' },
  privacy: { title: 'Política de Privacidade', markdown: PRIVACY_MD, testID: 'legal-privacy' },
} as const;

/** Sem login: o jogador lê os termos antes de entrar. Voltar cai na entrada quando não há histórico. */
export function LegalScreen({ doc }: { doc: keyof typeof LEGAL_DOCS }) {
  const router = useRouter();
  const d = LEGAL_DOCS[doc];
  return (
    <LegalView
      title={d.title}
      markdown={d.markdown}
      testID={d.testID}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );
}

export const sadeDeckRoute = '/api/desktop/sade-decks';
export const sadeDeckFinishRoute = '/api/cloud/sade-deck-finish';
export const sadeDeckRenderRoute = '/api/cloud/sade-deck-render';
export const sadeDeckWorkerRoute = '/api/cloud/sade-deck-worker';
export const sadeDeckMaxBytes = 600 * 1024;

export const sadeDeckProviders = ['codex', 'claude-code'] as const;
export type SadeDeckProvider = (typeof sadeDeckProviders)[number];
export const sadeDeckProviderNames: Record<SadeDeckProvider, string> = {
  codex: 'Codex',
  'claude-code': 'Claude Code',
};

export interface SadeDeckAuthorInput {
  instructions: string;
  brief: string;
  schema: string;
}

export interface SadeDeckView {
  id: string;
  prompt: string;
  state: 'research' | 'authoring' | 'retrying' | 'ready' | 'failed';
  createdAt: string;
  title?: string;
  filename?: string;
  sources?: { title: string; url: string }[];
  assignments?: { provider: SadeDeckProvider; assignedAt: number }[];
  worker?: { provider: SadeDeckProvider; sessionId: string; report: string };
  error?: string;
}

export type SadeDeckCommand =
  | { action: 'start'; id: string; prompt: string }
  | { action: 'read' | 'download'; id: string }
  | { action: 'list' };

export interface SadeDeckPresentation {
  title: string;
  slides: { title: string; bullets: string[]; bulletLinks?: string[] }[];
}

export function isSadeDeckRequest(input: string) {
  const text = input
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[“"][^”"]*[”"]/g, '')
    .replace(/https?:\/\/\S+/g, '');
  return (
    /\b(?:pptx?|power\s*point|(?:pitch |slide )?deck|slides?|bo (?:slide|trinh chieu)|bai thuyet trinh)\b/.test(
      text,
    ) &&
    /\b(?:tao|lam|soan|thiet ke|viet|(?:toi|minh|em|team)\s+can\s+(?:mot\s+)?(?:(?:tep|file|bo)\s+)?(?:pptx?|power\s*point|slides?|bai thuyet trinh)|build|make|create|prepare|generate|produce|(?:give|send) me|need|put together)\b/.test(
      text,
    ) &&
    !/^(?:@sade\s+)?(?:how (?:do i|to|can i)|cach (?:tao|lam)|lam sao de (?:tao|lam))\b/i.test(
      text.trim(),
    ) &&
    !/\b(?:(?:dung|chua|khoan|khong can|do not|don.t|hold off)\s+(?:tao|lam|soan|build|make|create|prepare|start)|(?:khong|chua)\s+can\s+(?:mot\s+)?(?:file\s+)?(?:pptx?|power\s*point|slide|bo))\b/.test(
      text,
    ) &&
    !/\b(?:viet|soan|write|draft|compile)\b[^.!?]{0,40}\b(?:paper|latex|luan van|bai bao khoa hoc|research article|bai nghien cuu)\b/.test(
      text,
    )
  );
}

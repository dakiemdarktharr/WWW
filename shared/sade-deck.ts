export const sadeDeckRoute = '/api/desktop/sade-decks';
export const sadeDeckFinishRoute = '/api/cloud/sade-deck-finish';
export const sadeDeckMaxBytes = 600 * 1024;

export interface SadeDeckView {
  id: string;
  prompt: string;
  state: 'research' | 'authoring' | 'retrying' | 'ready' | 'failed';
  createdAt: string;
  title?: string;
  filename?: string;
  sources?: { title: string; url: string }[];
  worker?: { provider: 'codex'; sessionId: string; report: string };
  error?: string;
}

export type SadeDeckCommand =
  | { action: 'start'; id: string; prompt: string }
  | { action: 'read' | 'download'; id: string }
  | { action: 'list' };

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
    /\b(?:tao|lam|soan|thiet ke|viet|build|make|create|prepare|generate|produce|(?:give|send) me|need|put together)\b/.test(
      text,
    ) &&
    !/^(?:@sade\s+)?(?:how (?:do i|to|can i)|cach (?:tao|lam)|lam sao de (?:tao|lam))\b/i.test(
      text.trim(),
    ) &&
    !/\b(?:dung|chua|khoan|khong can|do not|don.t|hold off)\s+(?:tao|lam|soan|build|make|create|prepare|start)\b/.test(
      text,
    ) &&
    !/\b(?:viet|soan|write|draft|compile)\b[^.!?]{0,40}\b(?:paper|latex|luan van|bai bao khoa hoc|research article|bai nghien cuu)\b/.test(
      text,
    )
  );
}

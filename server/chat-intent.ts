import type { Member } from '../shared/types.ts';

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/đ/g, 'd')
    .toLowerCase();

/** Resolve addresses, not names mentioned inside quoted material or code. */
export function chatRecipients(content: string, members: Member[], allowance = false): string[] {
  const text = content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^>.*$/gm, '')
    .trim();
  return members
    .filter((member) => {
      const name = escape(member.name.trim().replace(/\s+/g, '-'));
      return (
        (allowance &&
          new RegExp(
            `(^|[^\\p{L}\\p{N}_])${escape(member.name.trim())}(?=$|[^\\p{L}\\p{N}_])`,
            'iu',
          ).test(text)) ||
        new RegExp(`(^|\\s)@${name}(?=$|[\\s.,:;!?])`, 'iu').test(text) ||
        new RegExp(`^(?:!!\\s*)?${name}(?=$|[\\s,:])|(?:^|[\\s,])${name}[.!?]*$`, 'iu').test(text)
      );
    })
    .map((member) => member.id);
}

export function reserveIntent(content: string, quotaContext: boolean) {
  const text = fold(content).trim();
  if (!quotaContext && !/\b(?:usage|quota|reserve|remaining|con lai|han muc)\b/.test(text))
    return null;
  if (/`|^>|["“”]/m.test(text) || /\b(?:not|never|dont|don't|khong|chua|dung)\b/.test(text))
    return null;
  const explicit =
    /\b(?:i (?:allow|authorize|permit|approve)|you have my permission|(?:toi|minh|tui) (?:cho phep|dong y|cap phep)|cho phep|cap phep|dong y cho)\b/.test(
      text,
    );
  const contextual =
    quotaContext &&
    /\b(?:go ahead|work on it|continue|proceed|tiep tuc|cu lam|lam tiep|duoc phep)\b/.test(text);
  if (!explicit && !contextual) return null;
  if (/\b(?:if|unless|whether|when|once|after|example|quote|neu|khi|vi du)\b|\?/.test(text))
    return null;
  const amounts = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map((match) =>
    Number(match[1].replace(',', '.')),
  );
  const floor = amounts[0] ?? 20;
  if (
    amounts.length > 1 ||
    !Number.isInteger(floor) ||
    floor < 0 ||
    floor >= 50 ||
    /\b(?:used|da dung)\b/.test(text)
  )
    return {
      error:
        'Specify one remaining-usage floor from 0–49%, for example: @Vega I allow you to continue until 37% remaining.',
    };
  const duration =
    /(?:for|trong|hieu luc)\s+(\d+)\s*(hours?|hrs?|h|gio|minutes?|mins?|phut)\b/.exec(text);
  const minutes = duration ? Number(duration[1]) * (/^(?:h|gio)/.test(duration[2]) ? 60 : 1) : 60;
  if (minutes < 1 || minutes > 7 * 24 * 60)
    return { error: 'Choose an allowance lasting between one minute and seven days.' };
  return { floor, minutes };
}

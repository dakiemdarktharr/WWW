import { foldSharedSadeName } from './shared-sade-assignment.ts';

type Style = { kind: 'supplied'; detail: string } | { kind: 'delegated' } | { kind: 'unspecified' };

const frontend = /\b(?:front[ -]?end|ui|giao dien|man hinh)\b|\.(?:tsx|jsx|vue|svelte)\b/i;
const visual =
  /\b(?:visual|style|aesthetic|phong cach|giao dien|palette|font|typeface|typography|layout|theme|spacing|contrast|background|foreground|colou?rs?|minimal(?:ist)?|dark|light|rounded|square|bold|gradient|density|cards?|gutter|monochrome|interactive|responsive|tong mau|bang mau|bo cuc|nen|chu dam|chu nho|vien|bo goc|toi gian|tuong phan|khoang cach|dam|nhat|don sac|man hinh toi|man hinh sang|man hinh nho)\b/;
const styleCue =
  /\b(?:visual|style|aesthetic|phong cach|palette|theme|font|typeface|typography|layout|spacing|contrast|background|colou?rs?|minimal(?:ist)?|dark mode|light mode|rounded|bold|monochrome|teal|white|grey|gray|navy|black|cream|tong mau|bang mau|bo cuc|nen mau|nen xanh|nen toi|nen sang|chu dam|bo goc|toi gian|tuong phan|khoang cach|don sac)\b/;
const delegation =
  /\b(?:(?:de|cho) [\p{L}\p{N}_ -]{1,50} (?:tu chon|tu quyet(?: dinh)?)|(?:let|leave it to) [\p{L}\p{N}_ -]{1,50} (?:(?:to )?(?:choose|decide|pick)|handle (?:it|the look|the style))|[\p{L}\p{N}_-]+'s choice|(?:can|may|should) (?:choose|decide|pick)|tu (?:chon|quyet(?: dinh)?) (?:style|phong cach|giao dien))\b/u;
const namedVisualDirective =
  /^(?:(?:rieng |ve )?(?:phan )?(?:front[ -]?end|ui|giao dien|man hinh|style|phong cach|visual (?:style|design))\b[^,.]{0,40}?\s+(?:dung|ung dung|ap dung|giu|de|lay|use|apply|keep|should (?:use|have)|must (?:use|have)|with)\s+)/;
const standaloneVisualDirective =
  /^(?:please )?(?:start with|use|apply|keep|set|go with|make it|dung|ap dung|giu|chon|lay|bat dau voi|thiet ke theo)\s+/;
const inlineVisualDirective = /(?:,\s*|\s+)(?:with|voi|using|dung|theo)\s+(?=\S)/g;
const tentativeStyle =
  /\b(?:neu|hoac|tuy|co the|hay la|chua chot|chua quyet|hoi (?:lai|tui|toi|minh)|quyet sau|if|or|unless|maybe|tentatively|depending on|ask (?:me|the user|first)|otherwise|don't|do not|khong (?:nen|duoc|can)|dung (?:chon|dung))\b/;

function unquoted(text: string) {
  const withoutPathsOrPossessives = text
    .replace(/\b[\p{L}\p{M}\p{N}_-]+['’]s\b/gu, '')
    .replace(/\x60[\p{L}\p{M}\p{N}_.\/-]+\x60/gu, '');
  return !/["'“”‘’«»\x60]/u.test(withoutPathsOrPossessives);
}

const sentences = (text: string) =>
  text.split(/(?<=[.!?;])\s+|[\r\n]+/u).map((part) => part.trim());

function directStyle(part: string, folded: string, followsFrontend: boolean) {
  const directive =
    namedVisualDirective.exec(folded) ??
    (followsFrontend ? standaloneVisualDirective.exec(folded) : null);
  if (directive) {
    const detail = part.slice(directive[0].length).trim();
    return visual.test(foldSharedSadeName(detail)) ? detail : undefined;
  }
  for (const match of folded.matchAll(inlineVisualDirective)) {
    const end = match.index + match[0].length;
    if (!frontend.test(folded.slice(0, match.index))) continue;
    const detail = part.slice(end).trim();
    if (visual.test(foldSharedSadeName(detail))) return detail;
  }
}

export function groundedHandoffStyle(request: string): Style | undefined {
  if (!request.trim() || request.length > 700 || !unquoted(request)) return;
  const evidence: Style[] = [];
  let followsFrontend = false;
  for (const original of sentences(request)) {
    const part = original.normalize('NFC');
    const folded = foldSharedSadeName(part);
    const relevant = frontend.test(folded) || followsFrontend;
    followsFrontend = frontend.test(folded);
    if (!styleCue.test(folded)) continue;
    if (!relevant || tentativeStyle.test(folded) || folded.length !== part.length) return;
    if (delegation.test(folded)) {
      // A clause with both an assigned chooser and concrete style cues remains ambiguous.
      if (styleCue.test(folded.replace(/\b(?:style|phong cach|visual|aesthetic)\b/g, ''))) return;
      evidence.push({ kind: 'delegated' });
      continue;
    }
    const detail = directStyle(part, folded, relevant && !followsFrontend);
    if (!detail || detail.length > 220) return;
    evidence.push({ kind: 'supplied', detail });
  }
  if (evidence.length > 1) return;
  return evidence[0] ?? { kind: 'unspecified' };
}

const reviewMarker =
  /\b(?:cyber|defensive|privacy|security review|read[ -]only|review|ra soat|phong thu|bao mat|chi doc)\b/;
const reviewAction =
  /\b(?:check|review|audit|look for|test whether|verify|ensure|see whether|inspect|evaluate|check that|kiem tra|ra soat|xem|coi|doi chieu)\b/;
const output =
  /\b(?:errors?|exceptions?|responses?|messages?|outputs?|logs?|stack traces?|thong bao|loi|phan hoi|nhat ky|dau ra)\b/;
const disclosure =
  /\b(?:leak(?:s|ed|age|ing)?|expos(?:e[ds]?|ure|ing)|disclos(?:e[ds]?|ure|ing)|reveal(?:s|ed|ing)?|display(?:s|ed|ing)?|show(?:s|n|ing)?|print(?:s|ed|ing)?|echo(?:es|ed|ing)?|contain(?:s|ed|ing)?|include(?:s|d|ing)?|lo(?:t)?|ro ri|hien|tiet lo|cong khai|in ra)\b/;
const field =
  /\b(?:emails?|e-mail|phone|mobile number|telephone|address(?:es)?|names?|personal (?:information|data)|customer (?:data|ids?|details)|(?:account|order|member|membership|booking|card|student|client|patient|parcel|tracking|ticket|reservation|profile|contact) (?:ids?|numbers?|names?|codes?|identifiers?|details|data|notes?)|dia chi|so dien thoai|so the|ten (?:khach|nguoi|thanh vien|hoc sinh|ben nhan)|(?:ma|so) (?:khach|nguoi|the|don|ve|dat|phieu|ho so|thanh vien|benh nhan)|thong tin ca nhan)\b/;
const ambiguousReview =
  /\b(?:if|unless|maybe|instead|skip|no (?:review|need)|do not (?:check|review|inspect)|ignore|disregard|prompt|instruct|secret|password|token|credentials?|api key|upload|delete|push|deploy|run|execute|terminal|shell|command|exploit|payload|neu|tru khi|thay vi|bo qua|khong (?:can|kiem tra|ra soat)|dung (?:kiem tra|ra soat)|mat khau|tai len|chay lenh)\b/;
const unrelatedScope =
  /\b(?:architecture|contract|cau truc|hop dong|database|co so du lieu|repo(?:sitory)?|project[ -]wide|toan bo|all files|extra files|codebase|test files|fixtures?)\b|\b[\p{L}\p{N}_.-]+[\\/][\p{L}\p{N}_.\\/ -]*\.[\p{L}\p{N}_-]+/u;
const instructionOverride =
  /\b(?:ignore|disregard|override|bo qua) (?:all |any |your (?:current |previous )?|the )?(?:previous |system |developer )?(?:instructions?|rules?|huong dan|quy tac)\b/;

export function groundedHandoffReviewFocus(earlier: string): string | undefined {
  if (
    !earlier.trim() ||
    earlier.length > 900 ||
    instructionOverride.test(foldSharedSadeName(earlier))
  )
    return;
  const matches: string[] = [];
  for (const part of sentences(earlier)) {
    const folded = foldSharedSadeName(part);
    if (!reviewMarker.test(folded)) continue;
    if (ambiguousReview.test(folded) || !unquoted(part)) return;
    if (!reviewAction.test(folded) || !output.test(folded) || !disclosure.test(folded)) continue;
    if (!field.test(folded) || unrelatedScope.test(folded) || part.length > 250) return;
    matches.push(part);
  }
  return matches.length === 1 ? matches[0] : undefined;
}

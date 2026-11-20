import { foldSharedSadeName } from '../server/shared-sade-assignment.ts';

type Role = 'architecture' | 'frontend' | 'backend' | 'codebase';

const roleLabels: Record<Role, RegExp> = {
  architecture:
    /\b(?:architecture|contract|schema|structure|cau truc|kien truc|hop dong|quy uoc)\b/,
  frontend: /\b(?:front[- ]?end|ui|interface|screen|view|giao dien|man hinh)\b/,
  backend: /\b(?:back[- ]?end|api|server(?: handler)?|handler|ham xu ly|xu ly phia may chu)\b/,
  codebase: /\b(?:codebase|tests?|test suite|bo test|kiem thu)\b/,
};

const roles = Object.keys(roleLabels) as Role[];
const fileToken =
  /(?<![\p{L}\p{M}\p{N}_.:@/\\-])(?:[\p{L}\p{N}_.-]+\/)*[\p{L}\p{N}_-][\p{L}\p{M}\p{N}_.-]*\.[\p{L}\p{M}\p{N}_-]+(?![\p{L}\p{M}\p{N}_/\\-])/gu;
const testPath = /(?:^|\/)(?:tests?|__tests__|specs?)\/|\.(?:test|spec)\.[^/]+$/i;
const separator = /[\r\n,;!?]|\.(?=\s)/u;
const sentenceBreak = /[\r\n]|[.!?](?=\s)/u;
const unsupported =
  /\b(?:maybe|possibly|tentative|if|unless|instead of|hoac|neu|co the|thay vi|du phong)\b/;
const referenceOnly =
  /\b(?:ignore|skip|never|unchanged|(?:do|does|did|must|should) not|don't|read[- ]only|reference only|for reference|template only|using|based on|according to|giu nguyen|dung (?:sua|viet|dung)|khong (?:can |duoc )?(?:sua|dung|viet)|bo qua|chi (?:doc|xem)|tham (?:khao|chieu)|doi chieu|dua (?:theo|vao|tren))\b/;
const instructionsFromReference =
  /\b(?:ignore|please|assign|run|open|overwrite|execute|edit|deploy|push|upload|delete|forward|use|giao|nho|chay|sua|xoa|day len)\b/;
const afterFileNotice =
  /^[ \t`),:–—-]*(?:or|hoac|for reference|as a template|reference only|(?:chi |de )?tham (?:khao|chieu)|do not (?:edit|write|use)|dung (?:sua|viet|dung)|khong (?:duoc )?(?:sua|viet|dung)|giu nguyen)\b/u;

function labeledRole(text: string) {
  const labels = roles.filter((role) => roleLabels[role].test(text));
  if (
    labels.length === 2 &&
    /\b(?:front[- ]?end|back[- ]?end|giao dien|api) (?:tests?|test suite|bo test)\b/.test(text)
  )
    return 'codebase' as const;
  return labels.length === 1 ? labels[0] : undefined;
}

/** Limit automatic file selection to unambiguous role labels beside a mentioned path. */
export function groundedHandoffFiles(
  current: string,
  earlier: string,
  candidates: readonly string[],
): Partial<Record<Role, string>> {
  const byRole = new Map<Role, Set<string>>();
  const excluded = new Set<string>();
  for (const [source, advisory] of [
    [current, false],
    [earlier, true],
  ] as const) {
    let previousEnd = 0;
    for (const match of source.matchAll(fileToken)) {
      const path = match[0];
      const after = source.slice(match.index + path.length);
      const before = source.slice(previousEnd, match.index).split(separator).at(-1) || '';
      previousEnd = match.index + path.length;
      const prefix = foldSharedSadeName(before.trim());
      const suffix = foldSharedSadeName(after);
      if (referenceOnly.test(prefix) || unsupported.test(prefix) || afterFileNotice.test(suffix)) {
        excluded.add(path);
        continue;
      }
      if (prefix.length > 160) continue;
      if (advisory) {
        const sentence = source.slice(0, match.index).split(sentenceBreak).at(-1) ?? '';
        if (instructionsFromReference.test(foldSharedSadeName(sentence.replace(fileToken, ''))))
          continue;
      }
      const trailingLabel = /^[\s`]*(?:[:=–—]|\()\s*([^;,.!?\r\n)]{1,40})/u.exec(suffix)?.[1] ?? '';
      const leftRole = labeledRole(prefix);
      const rightRole = labeledRole(trailingLabel);
      if (leftRole && rightRole && leftRole !== rightRole) continue;
      const role = leftRole ?? rightRole;
      if (!role || (role !== 'codebase' && testPath.test(path))) continue;
      const paths = byRole.get(role) ?? new Set<string>();
      paths.add(path);
      byRole.set(role, paths);
    }
  }

  const result: Partial<Record<Role, string>> = {};
  for (const [role, paths] of byRole) {
    if (paths.size !== 1) continue;
    const [path] = paths;
    if (excluded.has(path) || !candidates.includes(path)) continue;
    if (roles.some((other) => other !== role && byRole.get(other)?.has(path))) continue;
    result[role] = path;
  }
  return result;
}

import type { SharedGroup } from '../shared/collaboration.ts';
import { isPrivateCredentialPath } from './checkpoint.ts';
import { normalizeScope } from './security.ts';

export type SharedSadeAssignmentCandidate = {
  ownerId: string;
  ownerName: string;
  teammateId: string;
  sharingId: string;
};

export type SharedSadeReadAssignment = {
  scope: string;
  harnessName: string;
  ownerQualifier: string;
  candidates: SharedSadeAssignmentCandidate[];
};

const qualifiedRead =
  /^(?:(?:nhờ|nho)(?: (?:đúng|dung))? )?(?<harness>[\p{L}\p{N}][\p{L}\p{M}\p{N}_ -]*?) (?:của|cua) (?<owner>[\p{L}\p{N}][\p{L}\p{M}\p{N}_ -]*?) (?:đọc|doc|xem) (?<file>`?(?:[\p{L}\p{N}_-][\p{L}\p{M}\p{N}_.-]*\/)*[\p{L}\p{N}_-][\p{L}\p{M}\p{N}_.-]*\.[\p{L}\p{M}\p{N}_-]+`?)(?<tail>.*)$/iu;
const readEnding =
  /^(?: (?:nha|nhe|voi|giup (?:minh|toi|tui)))?[.!]?(?:[ ,]+(?:chi (?:doc|xem)(?: thoi)?(?:, dung sua(?: gi)?)?|dung sua(?: gi)?)[.!]?)?$/;
const explainEnding = /^ (?:roi|va) (?:giai thich|tom tat)((?: [\p{L}\p{M}\p{N}]+)*)(.*)$/u;
const otherAction =
  /\b(?:neu|khi|hoac|nhung|thay vi|tru khi|sau do|truoc khi|roi|va|giao|nho|chuyen|doc|xem|sua|xoa|ghi|them|tao|lam|khong)\b/;

export const foldSharedSadeName = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();

function matchesName(input: string, published: string) {
  const name = input.normalize('NFC').toLowerCase();
  const current = published.normalize('NFC').toLowerCase();
  return (
    name === current || (name === foldSharedSadeName(name) && name === foldSharedSadeName(current))
  );
}

function hasReadEnding(tail: string) {
  const text = foldSharedSadeName(tail);
  if (readEnding.test(text)) return true;
  const explanation = explainEnding.exec(text);
  return Boolean(
    explanation && !otherAction.test(explanation[1]) && readEnding.test(explanation[2]),
  );
}

/** Recognize a direct read of one named file. Match published identities before filtering grants. */
export function resolveSharedSadeReadAssignment(
  message: string,
  requesterId: string,
  group: Pick<SharedGroup, 'people' | 'teammates'>,
): SharedSadeReadAssignment | undefined {
  const input = message.trim();
  if (input.length > 500 || /[\r\n"'“”‘’«»<>]/u.test(input)) return;
  const match = qualifiedRead.exec(input)?.groups;
  if (!match || !hasReadEnding(match.tail)) return;
  const { harness: harnessName, owner: ownerQualifier } = match;
  if (match.file.startsWith('`') !== match.file.endsWith('`')) return;
  const scope = match.file.replace(/^`|`$/g, '');
  try {
    if (normalizeScope(scope) !== scope || isPrivateCredentialPath(scope)) return;
  } catch {
    return;
  }

  const people = group.people.filter((person) => person.state === 'active');
  const published = group.teammates.filter(
    (member) =>
      matchesName(harnessName, member.name) &&
      people.some((person) => person.id === member.ownerId),
  );
  if (!published.length) return;
  const qualifier = foldSharedSadeName(ownerQualifier);
  const owners = people.filter((person) => {
    if (qualifier === 'toi' || qualifier === 'tui' || qualifier === 'minh')
      return person.id === requesterId;
    if (qualifier === 'ban' || qualifier === 'ong') return person.id !== requesterId;
    return matchesName(ownerQualifier, person.name);
  });
  if (!owners.length) return;
  const candidates = published.flatMap((member) => {
    const owner = owners.find((person) => person.id === member.ownerId);
    return owner
      ? [
          {
            ownerId: owner.id,
            ownerName: owner.name,
            teammateId: member.localId,
            sharingId: member.sharingId ?? member.localId,
          },
        ]
      : [];
  });
  return { scope, harnessName, ownerQualifier, candidates };
}

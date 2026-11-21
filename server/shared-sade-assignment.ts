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
  /^(?:(?:nhờ|nho)(?: (?:đúng|dung))? )?(?<harness>[\p{L}\p{N}][\p{L}\p{M}\p{N}_ -]*?) (?:của|cua) (?<owner>[\p{L}\p{N}][\p{L}\p{M}\p{N}_ -]*?) (?:đọc|doc|xem) (?:(?:đúng|dung) )?(?:(?:tệp|tep|file) )?(?<file>`?(?:[\p{L}\p{N}_-][\p{L}\p{M}\p{N}_.-]*\/)*[\p{L}\p{N}_-][\p{L}\p{M}\p{N}_.-]*\.[\p{L}\p{M}\p{N}_-]+`?)(?<tail>.*)$/iu;
const readEnding =
  /^(?: (?:nha|nhe|voi|giup (?:minh|toi|tui)))?[.!]?(?:[ ,]+(?:chi (?:doc|xem)(?: thoi)?(?:, dung sua(?: gi)?)?|dung sua(?: gi)?)[.!]?)?$/;
const explainEnding =
  /^ (?:roi|va) (?:giai thich|tom tat|bao(?: lai)?)((?: [\p{L}\p{M}\p{N}]+)*)(.*)$/u;
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

type PublicationOwner = string | { relative: 'requester' | 'other' | 'any' };

/** Match active group publications without assuming anything about grants. */
export function resolveSharedSadePublishedCandidates(
  harnessName: string,
  owner: PublicationOwner,
  requesterId: string,
  group: Pick<SharedGroup, 'people' | 'teammates'>,
): SharedSadeAssignmentCandidate[] | undefined {
  const people = group.people.filter((person) => person.state === 'active');
  const published = group.teammates.filter(
    (member) =>
      matchesName(harnessName, member.name) &&
      people.some((person) => person.id === member.ownerId),
  );
  if (!published.length) return;
  const owners = people.filter((person) =>
    typeof owner === 'string'
      ? matchesName(owner, person.name)
      : owner.relative === 'any' ||
        (person.id === requesterId) === (owner.relative === 'requester'),
  );
  if (!owners.length) return;
  return published.flatMap((member) => {
    const person = owners.find(({ id }) => id === member.ownerId);
    return person
      ? [
          {
            ownerId: person.id,
            ownerName: person.name,
            teammateId: member.localId,
            sharingId: member.sharingId ?? member.localId,
          },
        ]
      : [];
  });
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

  const qualifier = foldSharedSadeName(ownerQualifier);
  const namesOwner = group.people.some(
    ({ name, state }) =>
      state === 'active' && name.normalize('NFC') === ownerQualifier.normalize('NFC'),
  );
  const owner: PublicationOwner = namesOwner
    ? ownerQualifier
    : ['toi', 'tui', 'minh'].includes(qualifier)
      ? { relative: 'requester' }
      : ['ban', 'ong'].includes(qualifier)
        ? { relative: 'other' }
        : ownerQualifier;
  const candidates = resolveSharedSadePublishedCandidates(harnessName, owner, requesterId, group);
  if (!candidates) return;
  return { scope, harnessName, ownerQualifier, candidates };
}

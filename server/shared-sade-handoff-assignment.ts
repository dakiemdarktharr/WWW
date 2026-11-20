import type { SharedGroup } from '../shared/collaboration.ts';
import { isPrivateCredentialPath } from './checkpoint.ts';
import { normalizeScope } from './security.ts';
import {
  foldSharedSadeName,
  resolveSharedSadePublishedCandidates,
  type SharedSadeAssignmentCandidate,
} from './shared-sade-assignment.ts';

export type SharedSadeHandoffBinding = {
  harnessName: string;
  ownerQualifier: string;
  candidates: SharedSadeAssignmentCandidate[];
  scope?: string;
};

export type SharedSadeHandoffAssignment = {
  producer: SharedSadeHandoffBinding;
  receiver: SharedSadeHandoffBinding;
};

const name = String.raw`[\p{L}\p{N}][\p{L}\p{M}\p{N}_ -]{0,99}?`;
const viActor = String.raw`(?<harness>${name}) (?:của|cua) (?<owner>${name})`;
const enActor = String.raw`(?:(?<relative>my|your) |(?<owner>${name})['’]s )(?<harness>${name})`;
const viProducer = new RegExp(
  String.raw`^(?:[eê] )?(?<command>(?:(?:tôi|toi|tui|mình|minh|xin) )?(?:nhờ|nho|giao|cho) )?${viActor} (?:làm|lam|viết|viet|ghi|chốt|chot|dựng|dung|tạo|tao|soạn|soan|chuẩn bị|chuan bi) (?<work>.+)$`,
  'iu',
);
const viReceiver = new RegExp(
  String.raw`^(?:thì |thi )?(?:(?:(?:ông|ong|bạn|ban) )?(?:đưa cho|dua cho|chuyển cho|chuyen cho|chuyển sang|chuyen sang|bàn giao cho|ban giao cho|giao(?: cho)?|cho) (?:đúng |dung )?)?${viActor} (?:(?:lấy|lay) (?:bản|ban|hợp đồng|hop dong|quy ước|quy uoc|cấu trúc|cau truc) (?:đó|do) (?:để |de )?)?(?:làm|lam|dựng|dung|sửa|sua|viết|viet|triển khai|trien khai) (?<work>.+)$`,
  'iu',
);
const enProducer = new RegExp(
  String.raw`^(?:please )?(?:ask|have|let|get|assign) ${enActor} (?:to )?(?:write|draft|design|prepare|build|create|set up) (?<work>.+)$`,
  'iu',
);
const enReceiver = new RegExp(
  String.raw`^(?:(?:then )?(?:hand(?: it)? off to|send(?: it)? to|pass(?: it)? to|give(?: it)? to|ask|have|let) )?${enActor} (?:(?:to )?use (?:it|the contract) to |to )?(?:implement|build|write|make|work on) (?<work>.+)$`,
  'iu',
);
const viTransfer =
  /(?:[.!?;] +(?:có|co) (?:quy ước|quy uoc|hợp đồng|hop dong|cấu trúc|cau truc|bản đó|ban do) (?:rồi|roi) |,? +(rồi|roi|sau đó|sau do) )/giu;
const enTransfer = /(?:,? +then |[.!?;] +after (?:it|the contract) is ready,? +)/giu;
const sentenceEnd = /[.!?;](?:\s|$)/u;
const noTransfer =
  /\b(?:chi bao tin|chi thong bao|chi la (?:vi du|trich dan)|khong (?:can |duoc )?(?:giao|nho|chuyen|lam)|dung (?:giao|nho|chuyen|lam)|neu|tru khi|du phong|thay vi|if|unless|instead of|in case|fallback|backup|do not (?:assign|start|send)|status only|nothing to do|for information only)\b/;
const conflictingClause = /\b(?:khong|hoac|hay la|not|never|or)\b/;
const architecture =
  /\b(?:cau truc|kien truc|hop dong|quy uoc|contract|architecture|structure|schema)\b/;
const frontend = /\b(?:frontend|front end|giao dien|man|ui|interface|screen|view)\b/;
const frontFile = /\.(?:jsx|tsx|vue|svelte|html|css)$/i;
const fileToken =
  /(?<=^|[\s`(,])(?:[\p{L}\p{M}\p{N}_.-]+\/)*[\p{L}\p{M}\p{N}_.-]+\.[\p{L}\p{M}\p{N}_-]+(?=$|[\s`),;.!?])/gu;

function exactScope(work: string): string | null | undefined {
  if (/\\|(?:^|[\s`])(?:[a-z]:)?\/|:\/\//iu.test(work)) return null;
  const paths = [...new Set(work.match(fileToken))];
  if (paths.length !== 1) return paths.length ? null : undefined;
  const [file] = paths;
  try {
    if (normalizeScope(file) === file && !isPrivateCredentialPath(file)) return file;
  } catch {
    // Invalid current-message paths must not become unscoped assignments.
  }
  return null;
}

function binding(
  match: Record<string, string>,
  scope: string | undefined,
  requesterId: string,
  group: Pick<SharedGroup, 'people' | 'teammates'>,
  language: 'vi' | 'en',
): SharedSadeHandoffBinding | undefined {
  const harnessName = match.harness;
  const ownerQualifier = match.relative || match.owner;
  const qualifier = foldSharedSadeName(ownerQualifier);
  const requester =
    language === 'vi'
      ? ['toi', 'tui', 'minh'].includes(qualifier)
      : qualifier === 'my' && Boolean(match.relative);
  const other =
    language === 'vi'
      ? ['ban', 'ong'].includes(qualifier)
      : qualifier === 'your' && Boolean(match.relative);
  const owner = requester
    ? { relative: 'requester' as const }
    : other
      ? { relative: 'other' as const }
      : ownerQualifier;
  const candidates = resolveSharedSadePublishedCandidates(harnessName, owner, requesterId, group);
  return candidates && { harnessName, ownerQualifier, candidates, ...(scope ? { scope } : {}) };
}

/** Recognize a current-message architecture/contract → frontend assignment to published actors. */
export function resolveSharedSadeHandoffAssignment(
  message: string,
  requesterId: string,
  group: Pick<SharedGroup, 'people' | 'teammates'>,
): SharedSadeHandoffAssignment | undefined {
  const input = message.trim();
  if (input.length > 700) return;
  // Only allow backticks for exact paths and apostrophes for English possessives.
  const quotes = input
    .replace(/(?<=\p{L})['’]s(?= )/giu, 's')
    .replace(/`([^`]+)`/gu, (token, file: string) => (exactScope(file) === file ? file : token));
  if (/[\r\n"'`“”‘’«»<>]/u.test(quotes) || noTransfer.test(foldSharedSadeName(input))) return;

  for (const [transfer, firstClause, secondClause, language] of [
    [viTransfer, viProducer, viReceiver, 'vi'],
    [enTransfer, enProducer, enReceiver, 'en'],
  ] as const) {
    for (const separator of input.matchAll(transfer)) {
      const first = firstClause.exec(input.slice(0, separator.index).trim())?.groups;
      const second = secondClause.exec(
        input
          .slice(separator.index + separator[0].length)
          .split(sentenceEnd, 1)[0]
          .trim(),
      )?.groups;
      if (!first || !second) continue;
      const firstWork = foldSharedSadeName(first.work);
      const secondWork = foldSharedSadeName(second.work);
      if (
        !architecture.test(firstWork) ||
        (language === 'vi' && !first.command && !/\btruoc\b/.test(firstWork)) ||
        conflictingClause.test(firstWork) ||
        conflictingClause.test(secondWork)
      )
        continue;
      const firstScope = exactScope(first.work);
      const secondScope = exactScope(second.work);
      if (firstScope === null || secondScope === null) continue;
      if (!frontend.test(secondWork) && !(secondScope && frontFile.test(secondScope))) continue;
      if (firstScope && secondScope?.toLowerCase() === firstScope.toLowerCase()) continue;
      const producer = binding(first, firstScope, requesterId, group, language);
      const receiver = binding(second, secondScope, requesterId, group, language);
      if (!producer || !receiver) continue;
      if (
        producer.candidates.some((first) =>
          receiver.candidates.some(
            (second) => first.ownerId === second.ownerId && first.sharingId === second.sharingId,
          ),
        )
      )
        continue;
      return { producer, receiver };
    }
  }
}

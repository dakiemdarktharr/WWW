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
  deliverables?: SharedSadeHandoffDeliverables;
};

export type SharedSadeHandoffDeliverables = {
  backend: { scope?: string };
  codebase: { scope?: string };
  defensiveReview: true;
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
  String.raw`^(?:(?:then )?(?:hand(?: it)? off to|send(?: it)? to|pass(?: it)? to|give(?: it)? to|ask|have|let) )?${enActor} (?:(?:to )?use (?:it|the contract) to |to )?(?:implements?|builds?|writes?|makes?|works? on) (?<work>.+)$`,
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
const frontend = /\b(?:frontend|front[ -]end|giao dien|man|ui|interface|screen|view)\b/;
const frontFile = /\.(?:jsx|tsx|vue|svelte|html|css)$/i;
const fileToken =
  /(?<=^|[\s`(,])(?:[\p{L}\p{M}\p{N}_.-]+\/)*[\p{L}\p{M}\p{N}_.-]+\.[\p{L}\p{M}\p{N}_-]+(?=$|[\s`),;.!?])/gu;
const referenceBefore =
  /\b(?:dua (?:theo|vao|tren)|theo|tham (?:chieu|khao)|doi chieu (?:voi|theo)|lay mau tu|based on|using|from(?! scratch\b)|refer(?:ring)? to|compare (?:to|with)|according to)\b/;
const referenceAfter =
  /^(?:chi )?(?:de (?:tham chieu|tham khao|doi chieu)|lam mau|as (?:a )?(?:reference|template)|for reference)\b/;
const correction =
  /\b(?:chot lai|doi lai|dinh chinh|thay bang|actually|correction|change of plan)\b/;
const assignmentAction = /\b(?:giao|nho|chuyen|assign|reassign|give|have)\b/;
const editAction = /\b(?:lam|viet|handles?|implements?|builds?|writes?)\b/;
const handoffRole =
  'frontend|front end|front-end|giao dien|architecture|kien truc|cau truc|contract|hop dong|quy uoc';
const reassignment = new RegExp(
  `\\b(?:(?:${handoffRole}) (?:gio |se )?(?:giao(?: cho)?|chuyen(?: cho| sang)?|goes to|will go to|will be handled by)|(?:giao|chuyen|assign|reassign) (?:lai |the )?(?:${handoffRole}) (?:cho|sang|to))\\b`,
);
const keepPath =
  /\b(?:giu nguyen|khong (?:duoc )?(?:sua|ghi|dung vao)|do not (?:edit|change|write)|leave .+ unchanged|for reference only)\b/;
const supportRoles =
  'backend|back[ -]end|api|codebase|bo test|tests?|kiem thu|cyber|defensive review|ra soat';
const negatedSupport = new RegExp(
  `\\b(?:(?:dung|bo qua|chot lai,? bo|khong (?:can|phai|duoc)|do not|skip|omit|drop|without|no) (?:(?:lam|viet|them|giao|implement|write|add|do|run) )?(?:${supportRoles})|(?:${supportRoles})(?: thi)? (?:khong can|bo qua|is out of scope|is not needed))\\b`,
);
const removeSupport =
  /\bbỏ (?:backend|api|codebase|bộ test|tests?|kiểm thử|cyber|defensive review|rà soát)/iu;
const inlineRole = new RegExp(
  `^(?:frontend|front[ -]end|giao dien|ui|ra soat (?:bao mat )?phong thu|${supportRoles})$`,
);
const backendRole = /\b(?:backend|back[ -]end|api)\b/;
const codebaseRole = /\b(?:codebase|bo test|tests?|kiem thu)\b/;
const testFile = /(?:^|\/)(?:tests?|__tests__|specs?)\/|\.(?:test|spec)\.[^/]+$/i;
const implementationFile = /\.(?:[cm]?[jt]s|py|go|rs|rb|php|java|kt|cs)$/i;
const delegatedWork =
  /\bsade (?:(?:tu|hay|co the) )?(?:chia|giao|tim nguoi|can assign|should assign|assigns?)\b|^(?:hay |please )?(?:lam|viet|them|build|implement|write|add)\b/;
const pastWork =
  /\b(?:tin (?:nhan )?truoc|ke hoach cu|hom qua|da lam|already (?:done|assigned)|previous (?:message|plan)|was (?:assigned|done))\b/;
const defensiveRead = /\b(?:chi doc|doc|read[ -]only|read)\b/;
const defensiveAction = /\b(?:ra soat|kiem tra|xem|check|inspect|review|report whether)\b/;
const defensiveConcern =
  /\b(?:phong thu|defensive|lo|lot|hien|expos(?:e[ds]?|ure)|leak(?:s|age)?|disclos(?:e[ds]?|ure))\b/;
const negatedDefensiveAction =
  /\b(?:khong (?:can|nen|phai)|dung|bo qua|do not|no need to|skip|omit) (?:doc|read|ra soat|kiem tra|xem|check|inspect|review|report)\b/;
const bothReviewedFiles =
  /\b(?:hai (?:file|tep)|ca hai|chung|(?:both|those two|the two) (?:source )?files)\b/;
const reviewReadVerb = /\b(?:doc|read(?!-only\b))\b/;
const reviewDesignation = /\b(?:cyber|review|ra soat|bao mat)\b/;
const reviewDirective =
  /^(?:(?:phan|ve phan|please|chi|only|just) )?(?:ra soat|cyber|review|inspect)\b|\b(?:backend|frontend)[ -]only\b/;
const readOnlyReminder = /^(?:(?:that|the|this) )?review (?:is|must be|stays) read[ -]only\b/;
const explicitFilePair =
  /\b(?:hai (?:file|tep)(?: nguon)?(?: do)?|(?:(?:those|the|exactly(?: (?:those|the))?) two|both) (?:source )?files)\b/;
const reviewersOfFilePair = new RegExp(
  `\\b(?:khong viet|did not (?:write|author)) ${explicitFilePair.source}`,
);
const exactFilePair = new RegExp(`^(?:(?:dung|ca) )?${explicitFilePair.source}$`);
const exactReviewRole = new RegExp(
  `^(?:(?:the|phan) )?(?:${frontend.source}|${backendRole.source})$`,
);
const additionalReviewScope =
  /\b(?:cung voi|kem theo|con ca|doc them|them ca|tep khac|file khac|plus|as well as|in addition to|also (?:read|review|check|inspect)|other (?:source )?files)\b/;
const mixedReviewWrites =
  /(?:, *|\b(?:roi|va|sau do|then|and) )(?:hay |please )?(?:sua|chinh sua|viet lai|cap nhat|fix|edit|write|rewrite|change|patch|update|modify)\b/;
const reviewAuthorWrites =
  /\b(?:reviewer|nguoi (?:ra soat|doc)) (?:should|must|will|phai|se|hay) (?:fix|edit|write|patch|update|modify|sua|chinh sua|viet lai|cap nhat)\b/;
const tentativeReview =
  /\b(?:fyi|maybe|perhaps|might (?:ask|review|check)|co the (?:nho|giao)|for your information)\b/;
const cancelReview =
  /\b(?:bo qua (?:viec do|phan do)|dung lam (?:viec do|phan do)|khong can (?:lam |thuc hien )?(?:viec do|phan do|kiem tra nua)|(?:skip|cancel) (?:it|that|the) (?:review|check)|(?:skip it|do not do (?:it|that)|no need to do (?:it|that)))\b/;

function inlineDeliverables(receiverWork: string) {
  const parts = foldSharedSadeName(receiverWork)
    .replace(/ (?:nhe|nha|please|giup minh|giup tui)$/u, '')
    .split(/\s*,\s*(?:(?:va|and) )?|\s+(?:va|and|voi)\s+/u);
  return (
    parts.length === 4 &&
    parts.every((part) => inlineRole.test(part)) &&
    parts.some((part) => frontend.test(part)) &&
    parts.some((part) => backendRole.test(part)) &&
    parts.some((part) => codebaseRole.test(part)) &&
    parts.some((part) => /^(?:cyber|defensive review|ra soat (?:bao mat )?phong thu)$/u.test(part))
  );
}

function exactScope(work: string): string | null | undefined {
  if (/\\|(?:^|[\s`])(?:[a-z]:)?\/|:\/\//iu.test(work)) return null;
  const mentions = [...work.matchAll(fileToken)];
  const paths = [...new Set(mentions.map(([file]) => file))];
  if (paths.length !== 1) return paths.length ? null : undefined;
  const [file] = paths;
  for (const mention of mentions) {
    const before = foldSharedSadeName(work.slice(0, mention.index)).replace(/[\s`(]+$/u, '');
    const after = foldSharedSadeName(work.slice(mention.index + file.length)).replace(
      /^[\s`)]+/u,
      '',
    );
    if (referenceBefore.test(before) || referenceAfter.test(after)) return null;
  }
  try {
    if (normalizeScope(file) === file && !isPrivateCredentialPath(file)) return file;
  } catch {
    // Invalid current-message paths must not become unscoped assignments.
  }
  return null;
}

const reviewTargetVerb = (text: string) => reviewReadVerb.exec(text) ?? defensiveAction.exec(text);

function reviewSubjects(text: string, action = reviewTargetVerb(text)) {
  if (!action) return '';
  return text.slice(action.index + action[0].length).split(defensiveAction, 1)[0];
}

function reviewsBothTargets(text: string) {
  const subjects = reviewSubjects(text);
  const namesFrontend = frontend.test(subjects);
  const namesBackend = backendRole.test(subjects);
  return (
    (namesFrontend && namesBackend) ||
    (!namesFrontend &&
      !namesBackend &&
      frontend.test(text) &&
      backendRole.test(text) &&
      bothReviewedFiles.test(text))
  );
}

function requestsDefensiveReview(text: string) {
  return (
    !pastWork.test(text) &&
    !negatedDefensiveAction.test(text) &&
    reviewsBothTargets(text) &&
    defensiveRead.test(text) &&
    defensiveAction.test(text) &&
    defensiveConcern.test(text) &&
    (/\b(?:giao|nho|de mot nguoi|ask|have|let)\b/.test(text) ||
      /^(?:ra soat|kiem tra|review|inspect)\b/.test(text))
  );
}

function restrictsDefensiveReview(sentence: string, text: string) {
  if (!reviewDesignation.test(text) && !defensiveConcern.test(text)) return false;
  if (negatedDefensiveAction.test(text)) return true;
  if (reviewsBothTargets(text)) return false;
  if (reviewDirective.test(text) && !readOnlyReminder.test(text)) return true;
  const subjects = reviewSubjects(text);
  const namesFrontend = frontend.test(subjects);
  const namesBackend = backendRole.test(subjects);
  if (namesFrontend !== namesBackend) return true;
  const files = reviewSubjects(foldSharedSadeName(sentence)).match(fileToken) ?? [];
  return !namesFrontend && !namesBackend && new Set(files).size === 1;
}

function keepsScope(sentence: string, scopes: (string | undefined)[]) {
  return (
    keepPath.test(foldSharedSadeName(sentence)) &&
    (sentence.match(fileToken) ?? []).some((file) =>
      scopes.some((scope) => scope?.toLowerCase() === file.toLowerCase()),
    )
  );
}

const reviewText = (sentence: string) => foldSharedSadeName(sentence.replace(fileToken, ''));

function boundedHandoffMessage(message: string) {
  const input = message.trim();
  if (input.length > 700) return;
  // Only allow backticks for exact paths and apostrophes for English possessives.
  const quotes = input
    .replace(/(?<=\p{L})['’]s(?= )/giu, 's')
    .replace(/`([^`]+)`/gu, (token, file: string) => (exactScope(file) === file ? file : token));
  if (/[\r\n"'`“”‘’«»<>]/u.test(quotes) || noTransfer.test(foldSharedSadeName(input))) return;
  return input;
}

function onlyFrontendAndBackend(brief: string, text: string) {
  const action = reviewTargetVerb(text);
  if (!action || additionalReviewScope.test(text) || brief.match(fileToken)?.length) return false;
  const subjects = reviewSubjects(text, action);
  if (architecture.test(subjects) || codebaseRole.test(subjects)) return false;
  const preamble = text.slice(0, action.index);
  const targets = subjects
    .trim()
    .replace(/\b(?:de|for|to|and|va|chi|roi|then)$/u, '')
    .trim()
    .replace(/[,.;]$/u, '')
    .trim();
  const only = /^(?:only|just|rieng) | (?:only|thoi)$/gu;
  const scopedTargets = targets.replace(only, '');
  if (exactFilePair.test(scopedTargets) || (!targets && reviewersOfFilePair.test(preamble)))
    return true;
  if (!/\bchi $/.test(preamble) && scopedTargets === targets) return false;
  const roles = scopedTargets.split(/\s*(?:[&/]|\b(?:and|va|voi|lan)\b)\s*/u);
  return roles.length === 2 && roles.every((role) => exactReviewRole.test(role));
}

/** Extract an explicit review brief from the current message of a recognized handoff. */
export function sharedSadeExplicitHandoffReview(
  message: string,
): { brief: string; exactFrontendAndBackend: boolean } | undefined {
  const input = boundedHandoffMessage(message);
  if (!input || tentativeReview.test(foldSharedSadeName(input))) return;
  const sentences = input.split(/(?<=[.!?;])\s+/u).map((sentence) => {
    const brief = sentence.trim();
    return { brief, text: reviewText(brief) };
  });
  const matches = sentences.filter(({ text }) => requestsDefensiveReview(text));
  if (matches.length !== 1) return;
  const [{ brief, text }] = matches;
  if (
    mixedReviewWrites.test(text) ||
    sentences.some(
      (sentence) =>
        cancelReview.test(sentence.text) ||
        reviewAuthorWrites.test(sentence.text) ||
        negatedDefensiveAction.test(sentence.text) ||
        restrictsDefensiveReview(sentence.brief, sentence.text) ||
        (correction.test(sentence.text) &&
          (reviewDesignation.test(sentence.text) || defensiveAction.test(sentence.text))),
    )
  )
    return;

  return { brief, exactFrontendAndBackend: onlyFrontendAndBackend(brief, text) };
}

function supportingDeliverables(
  receiverWork: string,
  tail: string[],
  primaryScopes: (string | undefined)[],
): SharedSadeHandoffDeliverables | undefined {
  if (
    [receiverWork, ...tail].some(
      (sentence) =>
        removeSupport.test(sentence) || negatedSupport.test(foldSharedSadeName(sentence)),
    )
  )
    return;

  const tailText = tail.map(reviewText);
  if (tail.some((sentence, index) => restrictsDefensiveReview(sentence, tailText[index]))) return;
  if (inlineDeliverables(receiverWork)) return { backend: {}, codebase: {}, defensiveReview: true };
  if (!tailText.some(requestsDefensiveReview)) return;
  const backendScopes = new Set<string>();
  const codebaseScopes = new Set<string>();
  let backend = false;
  let codebase = false;
  for (const sentence of tail) {
    const text = reviewText(sentence);
    if (pastWork.test(text) || !delegatedWork.test(text) || defensiveRead.test(text)) continue;
    const scopes = [...sentence.matchAll(fileToken)].flatMap((mention) => {
      const [file] = mention;
      if (primaryScopes.includes(file) || exactScope(file) !== file) return [];
      const before = foldSharedSadeName(sentence.slice(0, mention.index));
      const after = foldSharedSadeName(sentence.slice(mention.index + file.length)).replace(
        /^[\s`)]+/u,
        '',
      );
      return referenceBefore.test(before) || referenceAfter.test(after) ? [] : [file];
    });
    const tests = scopes.filter((file) => testFile.test(file));
    const source = scopes.filter((file) => !testFile.test(file) && implementationFile.test(file));
    if (codebaseRole.test(text) || tests.length) {
      codebase = true;
      tests.forEach((file) => codebaseScopes.add(file));
    }
    // A named backend review can disambiguate a single assigned source paired with tests.
    if (
      backendRole.test(text) ||
      (!frontend.test(text) && source.length === 1 && tests.length > 0)
    ) {
      backend = true;
      source.forEach((file) => backendScopes.add(file));
    }
  }
  if (!backend || !codebase) return;
  const scopes = [...backendScopes, ...codebaseScopes];
  if (tail.some((sentence) => keepsScope(sentence, scopes))) return;
  return {
    backend: backendScopes.size === 1 ? { scope: [...backendScopes][0] } : {},
    codebase: codebaseScopes.size === 1 ? { scope: [...codebaseScopes][0] } : {},
    defensiveReview: true,
  };
}

function revisesHandoff(tail: string[], scopes: (string | undefined)[]) {
  return tail.some((sentence) => {
    const text = foldSharedSadeName(sentence);
    if (reassignment.test(text)) return true;
    if (
      correction.test(text) &&
      (assignmentAction.test(text) ||
        (editAction.test(text) && (architecture.test(text) || frontend.test(text))))
    )
      return true;
    for (const pattern of [viReceiver, enReceiver, viProducer, enProducer]) {
      const work = pattern.exec(sentence.trim())?.groups?.work;
      if (!work) continue;
      const folded = foldSharedSadeName(work);
      if (
        architecture.test(folded) ||
        frontend.test(folded) ||
        frontFile.test(exactScope(work) ?? '')
      )
        return true;
    }
    return keepsScope(sentence, scopes);
  });
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
  const input = boundedHandoffMessage(message);
  if (!input) return;

  for (const [transfer, firstClause, secondClause, language] of [
    [viTransfer, viProducer, viReceiver, 'vi'],
    [enTransfer, enProducer, enReceiver, 'en'],
  ] as const) {
    for (const separator of input.matchAll(transfer)) {
      const first = firstClause.exec(input.slice(0, separator.index).trim())?.groups;
      const [receiverClause, ...tail] = input
        .slice(separator.index + separator[0].length)
        .split(sentenceEnd);
      const second = secondClause.exec(receiverClause.trim())?.groups;
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
      if (revisesHandoff([first.work, second.work, ...tail], [firstScope, secondScope])) continue;
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
      const deliverables = supportingDeliverables(second.work, tail, [firstScope, secondScope]);
      return { producer, receiver, ...(deliverables ? { deliverables } : {}) };
    }
  }
}

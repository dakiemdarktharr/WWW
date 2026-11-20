import type { PlanTask } from '../shared/types.ts';
import type { SharedSadeChoiceQuestion } from '../shared/sade-cloud.ts';
import { isPrivateCredentialPath } from './checkpoint.ts';
import type { SharedDelivery } from './group-sade.ts';
import { normalizeScope, redact } from './security.ts';
import { sharedSadeReferencedFileEvidence } from './shared-sade-choice-route.ts';
import type { SharedSadeCloudResult } from './shared-sade-cloud-planner.ts';
import { requestedSharedVerificationRevision } from './shared-sade-git.ts';
import { foldSharedSadeName } from './shared-sade-assignment.ts';
import { parseTeamPlan } from './workflow-plan.ts';

type Member = SharedDelivery['team'][number];
type Kind = PlanTask['kind'];
type Platform = NonNullable<PlanTask['requiredPlatform']>;
type Route = { actor: string; verb: string; evidence: string; clause: string };

const pathToken =
  /(?<![\p{L}\p{M}\p{N}_.:@/\\-])(?:[\p{L}\p{M}\p{N}_.-]+\/)*(?:[\p{L}\p{M}\p{N}_.-]*\.[\p{L}\p{M}\p{N}_-]+)(?![\p{L}\p{M}\p{N}_/\\-])/gu;
const quote = /["“”‘«»<>]|(?:^|\s)'[^'\r\n]*'(?:\s|$)/u;
const referenceCue =
  /\b(?:(?:file|tep|duong dan|commit|ban va|patch|diff)(?: nay| do| trong tin| tren| ay)|(?:tin|tin nhan) (?:tren|phia tren|nay|do|truoc|duoc (?:tham chieu|tra loi)|(?:toi|minh|tui) (?:(?:dang|vua) )?(?:reply|tra loi))|(?:that|the (?:referenced|mentioned)) (?:file|path|patch|commit|diff)|(?:previous|referenced) (?:message|reply)|(?:file|patch|commit) (?:from )?(?:above|in the reply)|(?:the )?message i(?:['’]m| am) (?:replying|responding) to)\b/;
const approvedLiteral =
  /^(?:(?:ok|okay|yes|duoc)[, ]+)?(?:(?:gio|bay gio|now) )?(?:toi|minh|tui|i|we) (?:(?:(?:da|vua) )?(?:chot|(?:phe )?duyet)|(?:have )?(?:just )?(?:approved|finali[sz]ed)) (?:the )?(?:new )?(?:cau|dong(?: chu)?|nhan|chu|label|line|wording|copy|phrase)(?: moi)?(?: la| is)? ["“][^"”\r\n]{1,120}["”](?: roi| now)?$/u;
const noWrite =
  /\b(?:chi (?:doc|xem|gui nhan xet|gui nhan dinh|bao cao)|giu nguyen|read[ -]only|report only|comments only|leave (?:it|the patch|the files) unchanged|(?:khoi|dung|khong(?: duoc)?|do not|don t|without) (?:sua|chinh|viet|ghi|edit|write|modify|editing|writing|modifying))\b/;
const dangerous =
  /\b(?:push|deploy|publish|merge|upload|release|xoa|delete|xuat ban|dua len|day len|tai len|hop nhanh|send (?:it |this )?to|post to)\b/;
const commitToken =
  /\b(?:commit|revision|sha(?:-1)?|(?:cap nhat|ban va|ban ghi) [^,;.!?\x60]{0,100}? (?:ghi|la)|(?:recorded|recorded as|logged as) (?=\x60))\s*:?\s*\x60?([a-f0-9]{7,40})\b/gi;
const tagToken =
  /\b(?:git )?tag\s*:?\s*\x60?([a-z0-9_](?:[a-z0-9_./-]{0,126}[a-z0-9_-])?)(?=\x60|[\s,;.:!?)]|$)/giu;
const noWork =
  /\b(?:dung bat dau|hay doi|doi (?:tin )?xac nhan|chua (?:bat dau|giao viec)|wait (?:for|until)|hold off|no action|do not start|fyi|chi (?:thong bao|nhac lai))\b/;
const actorPart = "[\\p{L}\\p{M}\\p{N}_ ’'-]{1,120}?";
const verbPart =
  'chạy kiểm thử|chay kiem thu|chạy kiểm tra|chay kiem tra|run (?:the )?(?:tests?|checks?)|rà soát|ra soat|rà Git|ra Git|kiểm tra|kiem tra|kiểm thử|kiem thu|xác minh|xac minh|tóm tắt|tom tat|cập nhật|cap nhat|thực hiện|thuc hien|bổ sung|bo sung|thay thế|thay the|thay(?= (?:đúng|dung) (?:nội dung|noi dung))|đọc|doc|xem|coi|sửa|sua|chỉnh|chinh|viết|viet|tạo|tao|thêm|them|đổi|review|audit|read|inspect|summarize|summarise|check|verify|test|edit|fix|write|create|update|change|replace|add';
const assigned = new RegExp(
  `^(?<actor>${actorPart})(?<!\\b(?:của|cua|bên|ben|of|from))\\s+(?:(?:to|should|will|can)\\s+)?(?:chỉ\\s+|chi\\s+|only\\s+)?(?<verb>${verbPart})(?:\\s+(?<evidence>.+))?$`,
  'iu',
);
const inverse = new RegExp(
  `^(?:chỉ\\s+|chi\\s+|only\\s+)?(?<verb>${verbPart})\\s+(?<evidence>.+?)\\s+(?:using|with|bằng|bang|với|voi)\\s+(?<actor>${actorPart})(?:,\\s*(?<detail>(?:(?:mình|minh|tôi|toi) (?:cần biết|can biet)|(?:i|we) need to know)\\s+.+))?[.!?]*$`,
  'iu',
);
const nominal = new RegExp(
  `^(?<actor>${actorPart})\\s+(?:(?:for|to do|to run|to perform|do|perform)\\s+)?an?\\s+(?:(?<limit>read[ -]only)\\s+)?(?<verb>check|review|audit|inspection)\\s+(?:of|on|for)\\s+(?<evidence>.+)$`,
  'iu',
);
const lookAt = new RegExp(
  `^(?<actor>${actorPart})\\s+(?:(?:to|should|can)\\s+)?(?:(?:take|have)\\s+an?\\s+(?:quick\\s+)?)?look\\s+at\\s+(?<evidence>.+)$`,
  'iu',
);
const gitRead = new RegExp(
  `^(?<actor>${actorPart})\\s+(?<method>(?:dùng|dung|use) Git)\\s+(?<verb>đọc|doc|xem|coi|read|inspect)\\s+(?<evidence>.+)$`,
  'iu',
);
const workOnRead = new RegExp(
  `^(?:(?:put|place)\\s+)?(?<actor>${actorPart})\\s+on\\s+(?:a|the)\\s+(?:read|inspection)\\s+of\\s+(?<evidence>.+)$`,
  'iu',
);
const copyEdit = new RegExp(
  `^(?<actor>${actorPart})\\s+(?:(?:to\\s+)?(?:make|do|perform|for)\\s+|(?=(?:one|a|the)\\s+))(?:(?:one|a|the)\\s+)?(?:(?:small|tiny|narrow|single|scoped)\\s+)?(?:copy|wording|text|label)\\s+(?<verb>edit|change|fix)\\s+(?<evidence>(?:in|to|inside)\\s+.+)$`,
  'iu',
);
const copyEditAssignee = new RegExp(
  `^(?:schedule|assign|delegate|arrange)\\s+(?:one |a |the )?(?:(?:approved|small|single|scoped) )?(?:copy|text|label|wording) (?<verb>edit|change|fix) (?:for|to|with) (?<actor>${actorPart})(?:\\s+(?<evidence>(?:in|inside|trong)\\s+.+))?$`,
  'iu',
);
const addressed = new RegExp(
  `^(?<actor>${actorPart})(?:\\s+(?:nha|nhé|nhe|ơi|oi))?\\s*[,:]\\s*(?:(?:giúp|giup)(?:\\s+(?:tôi|toi|mình|minh|tui))?\\s+|please\\s+)?(?<verb>${verbPart})\\s+(?<evidence>.+)$`,
  'iu',
);
const reviewAssignment = new RegExp(
  `^(?<actors>.+?)\\s+(?:(?:mỗi|moi)\\s+(?:bên|ben|người|nguoi)\\s+(?:(?:một|mot)\\s+(?:lượt|luot)\\s+)?|to\\s+)?(?:review|rà soát|ra soat|audit)\\s+(?<evidence>.+)$`,
  'iu',
);
const authorAssignment = new RegExp(
  `^(?<actor>${actorPart})\\s+(?:đã|da|already)\\s+(?:viết|viet|tạo|tao|làm|lam|sửa|sua|wrote|created|made|fixed|implemented)\\s+`,
  'iu',
);
const platformNames = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
const providerAliases = {
  chatgpt: 'codex',
  codex: 'codex',
  claude: 'claude',
  gemini: 'gemini',
  antigravity: 'antigravity',
  anti: 'antigravity',
};

const fold = (value: string) => foldSharedSadeName(value.normalize('NFC'));
const withoutPaths = (value: string) => fold(value.replace(pathToken, ' '));

function scopes(source: string) {
  const tags = new Set(
    Array.from(source.matchAll(tagToken), (match) => match.index + match[0].lastIndexOf(match[1])),
  );
  const files = [
    ...new Set(
      Array.from(source.matchAll(pathToken))
        .filter((match) => !tags.has(match.index))
        .map(([path]) => path),
    ),
  ];
  try {
    if (
      files.some(
        (path) =>
          path.length > 300 || normalizeScope(path) !== path || isPrivateCredentialPath(path),
      )
    )
      return;
  } catch {
    return;
  }
  return files;
}

function nameEquals(input: string, actual: string) {
  const exact = input.normalize('NFC').toLowerCase();
  return (
    exact === actual.normalize('NFC').toLowerCase() ||
    (exact === fold(exact) && exact === fold(actual))
  );
}

function actorParts(actor: string) {
  const account = /^(?<label>.+?)\s+(?:on|under)\s+(?<owner>.+?)[’']s\s+account$/iu.exec(
    actor,
  )?.groups;
  const uses =
    /^(?<owner>[\p{L}\p{M}\p{N}_-]+(?: [\p{L}\p{M}\p{N}_-]+){0,3})\s+(?:cho|nhờ|nho|dùng|dung)\s+(?<label>[\p{L}\p{M}\p{N} _-]{1,60})$/iu.exec(
      actor,
    )?.groups;
  const possessive = /^(?<owner>.+?)[’']s\s+(?<label>.+)$/iu.exec(actor)?.groups;
  const relative = /^(?<owner>my|your)\s+(?<label>.+)$/iu.exec(actor)?.groups;
  const qualified = /^(?<label>.+?)\s+(?:của|cua|bên|ben|of|from)\s+(?<owner>.+)$/iu.exec(
    actor,
  )?.groups;
  const grouped = /^(?<label>.+?)\s+\((?<owner>[^()]+)\)$/u.exec(actor)?.groups;
  const { owner, label = actor } =
    account ?? possessive ?? relative ?? qualified ?? grouped ?? uses ?? {};
  return { owner, label };
}

function grantsFor(actor: string, team: readonly Member[]) {
  const { owner, label } = actorParts(actor);
  const ownerWord = owner && fold(owner);
  const eligible = team.filter((member) => {
    if (!owner) return true;
    if (/^(?:toi|tui|minh|my)$/.test(ownerWord ?? '')) return member.ownedByRequester;
    if (/^(?:ban|ong|your)$/.test(ownerWord ?? '')) return !member.ownedByRequester;
    return nameEquals(owner, member.owner);
  });
  const named = eligible.filter(({ name }) => nameEquals(label, name));
  if (named.length) return named;
  const alias = fold(label) as keyof typeof providerAliases;
  return Object.hasOwn(providerAliases, alias)
    ? eligible.filter(({ provider }) => provider === providerAliases[alias])
    : [];
}

function requestParts(request: string) {
  const boundaries =
    /\x60[^\x60\r\n]+\x60|"[^"\r\n]+"|“[^”\r\n]+”|(?<end>[.!?;](?:\s+|$)|\r?\n+)/gu;
  const parts: string[] = [];
  let start = 0;
  for (const marker of request.matchAll(boundaries)) {
    if (!marker.groups?.end) continue;
    parts.push(request.slice(start, marker.index).trim());
    start = marker.index + marker[0].length;
  }
  return [...parts, request.slice(start).trim()].filter(Boolean);
}

function stripOpening(clause: string) {
  return clause
    .replace(/^(?:(?:ê|e|hey)[, ]+)?(?:Sade\s*(?:ơi|oi)?[, :]+)?/iu, '')
    .replace(
      /^(?:còn|con|riêng|rieng) (?:ca|việc|viec|vụ|vu|phần|phan) [^,;.!?]{1,45}? (?:thì|thi) (?=(?:nhờ|nho|giao|xin|hãy|hay)\s)/iu,
      '',
    )
    .replace(
      /^(?:for|about|regarding) [^:;,.!?]{1,75},\s+(?=(?:please|could you|can you|would you)\b)/iu,
      '',
    )
    .replace(
      /^[\p{L}\p{M}\p{N}_ -]{1,55}?\s+(?:ơi|oi)[, ]+(?=(?:nhờ|nho|giao|cho|hãy|hay)\s)/iu,
      '',
    )
    .replace(/^(?:(?:bây giờ|bay gio|giờ|gio|now|instead)[, :]+)?/iu, '')
    .replace(
      /^(?:(?:tôi|toi|mình|minh|tui)\s+(?:muốn|muon|cần|can)|(?:i|we)\s+(?:want|need))\s+/iu,
      '',
    )
    .replace(/^(?:ưu tiên|uu tien|prefer)\s+/iu, '')
    .replace(/^(?:tôi|toi|mình|minh|tui|bọn mình|bon minh)\s+(?=(?:nhờ|nho|giao|cho)\s)/iu, '')
    .replace(
      /^(?:(?:xin|phiền|phien|vui lòng|vui long|đề nghị|de nghi|please|can you|could you|can|could)\s+)?(?:(?:nhờ|nho|giao|cho|hãy|hay|ask|have|let|assign|arrange for)\s+)?(?:(?:đúng|dung|riêng|rieng|exactly|specifically)\s+)?/iu,
      '',
    );
}

function routeAt(clause: string): Route | undefined {
  const stripped = stripOpening(clause);
  const matched = (
    nominal.exec(stripped) ??
    lookAt.exec(stripped) ??
    workOnRead.exec(stripped) ??
    gitRead.exec(stripped) ??
    assigned.exec(stripped) ??
    addressed.exec(stripped) ??
    inverse.exec(stripped)
  )?.groups;
  if (!matched) return;
  const verb = matched.verb ? fold(matched.verb) : 'read';
  return {
    actor: matched.actor,
    verb: verb === 'inspection' ? 'read' : verb,
    evidence: [matched.limit, matched.method, matched.evidence, matched.detail]
      .filter(Boolean)
      .join(' '),
    clause,
  };
}

function question(summary: string): SharedSadeCloudResult {
  return { kind: 'question', summary };
}

function grantQuestion(actor: string, matches: readonly Member[], write = false) {
  const label = redact(actor).slice(0, 120);
  if (matches.length > 1) {
    const owners = [...new Set(matches.map(({ owner }) => redact(owner)))];
    const choices = owners.length > 1 ? ` trong số ${owners.join(', ')}` : '';
    return question(`Có nhiều tài khoản ${label}. Bạn muốn chọn chủ tài khoản nào${choices}?`);
  }
  return question(
    `Bạn cần cấp ${write ? 'quyền ghi' : 'quyền đọc'} cho ${label} trong dự án này. Bạn muốn cấp lại quyền hay xác nhận một teammate khác?`,
  );
}

function scopeQuestion(paths: readonly string[] = []) {
  const options =
    paths.length > 1
      ? ` Tệp được nhắc đến gồm ${paths.map((path) => redact(path)).join(', ')}.`
      : '';
  return question(`Bạn muốn Sade dùng đúng đường dẫn tệp nào?${options}`);
}

function scopedTask(
  key: string,
  kind: Kind,
  scope: string[],
  member: Member,
  evidence: string,
  options: {
    platform?: Platform;
    machine?: string;
    backup?: string;
    waitForProviderQuota?: true;
    revision?: string;
    after?: string[];
  } = {},
): PlanTask {
  const { platform, machine, backup, revision, after, waitForProviderQuota } = options;
  const instructions = {
    research: 'Chỉ đọc đúng tệp và trả lời câu hỏi đã nêu.',
    review: 'Rà soát độc lập, trích bằng chứng trong đúng phạm vi và giữ nguyên mọi tệp.',
    code: 'Chỉ thực hiện tác vụ đã yêu cầu trong phạm vi đã nêu.',
    design: 'Chỉ thiết kế trong phạm vi đã nêu.',
  };
  return {
    key,
    title: `${kind === 'review' ? 'Rà soát' : kind === 'research' ? 'Xác minh' : 'Thực hiện'} ${scope[0].slice(0, 94)} (${key})`,
    kind,
    scope,
    description:
      `${instructions[kind]} ${revision ? `Xác minh commit ${revision} trước khi đọc bản vá. Báo lại nếu bản vá chưa được đồng bộ. ` : ''}${redact(evidence).slice(0, 1800)}`.trim(),
    acceptance: `${instructions[kind]}${platform ? ` Dùng đúng môi trường ${platformNames[platform]}.` : ''}`,
    effort: kind === 'code' ? 2 : 1,
    stage: kind === 'review' ? 'Review' : 'Plan',
    dependsOn: after ?? [],
    preferredMemberId: member.id,
    fallbackMemberId: backup,
    ...(backup ? { fallbackOnProviderQuota: true } : {}),
    ...(waitForProviderQuota ? { waitForProviderQuota } : {}),
    requiredPlatform: platform,
    ...(machine ? { requiredPairedMachineName: machine } : {}),
  };
}

function plan(tasks: PlanTask[]): SharedSadeCloudResult {
  return {
    kind: 'plan',
    plan: parseTeamPlan({ summary: 'Giao đúng tác vụ và phạm vi đã xác minh.', tasks }),
  };
}

const quota =
  /\b(?:chi neu|neu|if(?:,? and only if,?)?|when|chi khi|only if|only when)\s+(?<actor>[^,;.!?]{0,100}?)(?:(?:lai )?(?:het|can) (?:luot|quota|han muc)|khong con luot|(?:cham|dat|vuot) (?:gioi han|han muc)(?: su dung)?|(?:runs? |is )?out of (?:provider )?quota|cannot (?:continue|proceed|start) (?:because of|due to) (?:its |their |the )?quota|(?:quota|han muc|luot) (?:dang )?can|(?:quota|limit) (?:runs out|is exhausted)|(?:hits?|reaches?) (?:(?:the|its|their) )?(?:provider )?(?:quota|limit)|(?:has|have) used up (?:its|their|the) (?:quota|limit))\b/;
const keepQuota =
  /^(?:(?:chi lam khi) (?:(?:tai khoan (?:do|nay)|nguoi do) )?con (?:luot|quota)|only (?:run|do this|proceed) (?:if|when) (?:(?:this account|the same account|the primary|the assignee|it|they) (?:has|have) (?:available )?quota|(?:its |their |the )?quota is available))[, ]+(?:(?:va|and) )?(?:dung chuyen nguoi|khong (?:doi|chuyen) nguoi|do not reassign|don['’]t reassign|no substitution)(?: nha| nhe| please)?$/;
const quotaBeforeActor =
  /\b(?:neu|when|if) (?:quota|luot|han muc) (?:cua|of|for) (?<actor>[^,;.!?]{1,100}?) (?:dang can|het|can|runs out|is exhausted)\b/;
const namedQuotaCondition =
  /^(?<actor>[^,;.!?]{1,100}?) ma (?:het|can) (?:luot|quota|han muc)(?=[\s,.!?]|$)/;
const contextualQuotaCondition = /^het (?:luot|quota|han muc)(?= (?:thi|moi)\b)/;
const quotaCondition = (words: string) =>
  quotaBeforeActor.exec(words) ??
  quota.exec(words) ??
  namedQuotaCondition.exec(words) ??
  contextualQuotaCondition.exec(words);

function matchesSingleGrant(actor: string, member: Member, team: readonly Member[]) {
  const byAccount = grantsFor(actor, team);
  if (byAccount.length) return byAccount.length === 1 && byAccount[0].id === member.id;
  return (
    nameEquals(actor, member.owner) &&
    team.filter(({ owner }) => nameEquals(actor, owner)).length === 1
  );
}

function backupFor(
  clause: string,
  primary: Member,
  team: readonly Member[],
  kind: Kind,
  platform?: Platform,
) {
  if (keepQuota.test(fold(clause))) return 'none';
  if (/\bcần (?:quota|lượt|hạn mức)\b/iu.test(clause)) return;
  const plain = fold(clause);
  const condition = quotaCondition(plain);
  if (!condition) return;
  const subject = (condition.groups?.actor ?? '')
    .trim()
    .replace(/(?:'s|’s)(?: (?:account|plan))?$/, '')
    .replace(/^tai khoan (.{1,65}) (?:do|nay|ay)$/u, '$1')
    .replace(/^(?:tai khoan (?!do$|nay$|ay$)|account of )/, '');
  if (
    subject &&
    !/^(?:(?:the )?(?:primary|assignee|requested teammate)|(?:that|this|the same) (?:exact )?account|(?:tai khoan|nguoi) (?:do|nay|ay)|he|she|it|they)$/.test(
      subject,
    ) &&
    !matchesSingleGrant(subject, primary, team)
  )
    return;
  const beforeCondition = clause.slice(0, condition.index).trim();
  const afterCondition = clause.slice(condition.index + condition[0].length).trim();
  const suffixCondition = beforeCondition && !afterCondition;
  const tail = suffixCondition ? beforeCondition : afterCondition;
  if (beforeCondition && !suffixCondition) return;
  const words = fold(tail)
    .replace(/^[, :]+/, '')
    .replace(/^(?:thi(?: moi)?|moi|then)\s+/, '');
  const fallbackMode =
    /\b(?:(?:same|identical|exactly that) (read(?:ing)?|inspect(?:ion)?|check|review)|(?:(?:chuyen (?:nguyen|dung) viec|chi) (doc)|(?:doc|xem) (?:thay )?(?:(?:dung|chinh) )?(?:file|tep) (?:do|nay)))\b/.exec(
      words,
    );
  if (fallbackMode && (fallbackMode[1] === 'review' ? kind !== 'review' : kind !== 'research'))
    return;
  if (
    kind !== 'research' &&
    /\b(?:read[ -]only|only read|doc thay|chi xem|co quyen doc)\b/.test(words)
  )
    return;
  const waitFor =
    /^(?:cu )?(?:cho|doi) (.+?) co lai (?:luot |quota )?(?:roi|moi) (?:doc|xem)(?:,? (?:de )?(?:dung|giu nguyen) (.+?) (?:nhan|giu) (?:viec|task)(?: nay)?)?$/.exec(
      words,
    );
  if (waitFor) {
    const keepNamedOwner = waitFor[2] && nameEquals(waitFor[2], primary.owner);
    if (
      (matchesSingleGrant(waitFor[1], primary, team) ||
        (keepNamedOwner && nameEquals(waitFor[1], primary.name))) &&
      (!waitFor[2] || keepNamedOwner)
    )
      return 'wait';
  }
  const retainedWhileWaiting =
    /^(?:(?:van |cu )?(?:de viec (?:nguyen )?(?:cho|o)|giu (?:viec|nguoi phu trach) la) (.+?),? (?:cho|doi) (?:dung )?(?:tai khoan|nguoi|ban) (?:do|nay|ay) co (?:luot|quota)(?: moi| lai)? roi (?:cho chay tiep|chay tiep|lam(?: tiep)?|tiep tuc|doc(?: tiep)?|xem(?: tiep)?))$/.exec(
      words,
    );
  if (retainedWhileWaiting && matchesSingleGrant(retainedWhileWaiting[1], primary, team))
    return 'wait';
  const waitWithRetainedOwner =
    /^(?:cu )?(?:giu (?:viec|luot) cho|de viec (?:lai )?cho) (.{1,70}?), (?:(?<wait>cho|doi) )?(?:den khi |toi khi )?(?:co lai (?:luot|quota)|co (?:luot|quota)(?: lai| moi)?) roi (?:chay tiep|tiep tuc|doc(?: tiep)?|xem(?: tiep)?)(?:,? (?:khoi|dung|khong) (?:doi|chuyen) (?:ai khac|nguoi(?: khac)?))?$/.exec(
      words,
    );
  if (waitWithRetainedOwner) {
    const [, assignee] = waitWithRetainedOwner;
    if (
      matchesSingleGrant(assignee, primary, team) ||
      (waitWithRetainedOwner.groups?.wait && nameEquals(assignee, primary.name))
    )
      return 'wait';
  }
  const holdUntilReset =
    /^(?:cu )?(?:treo|giu) (?:dung |nguyen )?(?:viec|luot) (?:o|cho) (?:tai khoan )?(.+?) (?:cho|doi) (?:reset|co lai (?:luot|quota)|quota reset)$/.exec(
      words,
    );
  if (holdUntilReset && matchesSingleGrant(holdUntilReset[1], primary, team)) return 'wait';
  const pauseSameAssignee =
    /^(?:(?:tam|cu) )?(?:treo|giu) (?:dung |nguyen )?([^,]+), (?:cho|doi) (?:no|tai khoan (?:do|ay)) co (?:luot|quota)(?: lai| moi)? roi (?:chay|lam|doc|xem|tiep tuc)(?: tiep)?, (?:dung|khong) (?:doi|chuyen) (?:nguoi|ai khac)$/.exec(
      words,
    );
  if (pauseSameAssignee && matchesSingleGrant(pauseSameAssignee[1], primary, team)) return 'wait';
  const keepNamedAccount =
    /^(?:cu )?(?:de|giu) (?:dung |nguyen )?tai khoan (.{1,85}?),? (?:doi|cho) (?:den khi |toi khi )?co (?:luot|quota)(?: lai| moi)? roi (?:doc|xem|kiem tra|chay)(?: tiep| lai)?$/.exec(
      words,
    );
  if (keepNamedAccount && matchesSingleGrant(keepNamedAccount[1], primary, team)) return 'wait';
  const retainNamedUntilReset =
    /^(?:cu )?(?:de (?:nguyen )?(?:viec|luot) (?:o|cho)|giu (?:nguyen )?(?:viec|luot) (?:o|cho)) (?:tai khoan )?(.{1,85}?), (?:doi|cho) (?:quota )?reset roi (?:tiep tuc|doc tiep|xem tiep|chay tiep)(?: nha| nhe)?$/.exec(
      words,
    );
  if (retainNamedUntilReset && matchesSingleGrant(retainNamedUntilReset[1], primary, team))
    return 'wait';
  if (
    /^(?:(?:hay|please) )?(?:cho|doi|wait) (?:den khi|toi khi|khi|until) (?:co luot(?: moi)?|het gioi han|(?:their |the )?(?:quota|limit) (?:resets?|is available))$/.test(
      words,
    ) ||
    /^(?:giu (?:dung|nguyen) (?:nguoi|tai khoan) nay[, ]+)?(?:cho|doi) co (?:luot|quota)(?: moi)? roi (?:tiep tuc|doc|xem)$/.test(
      words,
    )
  )
    return 'wait';
  if (/^(?:hay )?(?:bao (?:lai )?(?:toi|minh|tui)|tell me|ask me|let me know)\b/.test(words)) {
    if (
      /\b(?:giu nguyen|khong (?:doi|thay)|dung (?:doi|thay)|keep (?:the )?(?:assignee|owner)|no substitut|without reassigning)\b/.test(
        words,
      )
    )
      return 'none';
    return;
  }
  if (
    /^(?:(?:de |cho |let |allow )?sade (?:(?:co the|can|may|to) )?(?:tu chon|chon|choose|pick)|(?:(?:toi|minh|tui) )?(?:giao|cho phep) ban tu chon|(?:i|we) (?:authorize|allow) you to (?:choose|pick))\b/.test(
      words,
    )
  ) {
    if (
      /\b(?:sua|chuyen|them|xoa|viet|write|edit|and then|va sau do|any project|du an khac|except|unless|tru khi|ngoai tru|but|nhung|no reassignment|khong giao|dung giao)\b/.test(
        withoutPaths(tail),
      )
    )
      return;
    return 'auto';
  }
  if (
    kind === 'research' &&
    /^(?:cu )?giao (?:cho )?(?:bat ky ai|nguoi nao) (?:dang )?co quyen (?:trong )?(?:du an|workspace) nay (?:doc|xem) thay(?:,? phan con lai (?:cu )?giu nguyen)?$/.test(
      words,
    )
  )
    return 'auto';
  const selected = tail
    .replace(/^[, :]+/u, '')
    .replace(/^(?:thì(?: mới)?|thi(?: moi)?|mới|moi|then)\s+/iu, '')
    .replace(/^(?:hãy|hay|please)\s+/iu, '')
    .replace(/^(?:hãy |hay |please )?(?:dùng|dung|nhờ|nho|cho|use|ask|have|let|switch to)\s+/iu, '')
    .replace(
      /^(?:hand|give|assign|delegate|pass)\s+(?:(?:that|the)\s+(?:same|identical)|exactly\s+that)\s+(?:read(?:ing)?|review|check|task)(?:\s+task)?\s+to\s+/iu,
      '',
    )
    .replace(
      /^(?:chuyển|chuyen)\s+(?:nguyên|nguyen|đúng|dung)\s+(?:việc|viec)\s+(?:đọc|doc)\s+(?:này|nay|đó|do)\s+(?:cho|qua)\s+/iu,
      '',
    )
    .replace(
      /\s+(?:đọc|doc|xem|read|inspect)\s+(?:thay\s+)?(?:đúng\s+|dung\s+|the\s+same\s+)?(?:file|tệp|tep)\s+(?:đó|do|này|nay|above)$/iu,
      '',
    )
    .replace(
      /\s+to (?:do|perform|take over) (?:exactly )?(?:that|the) same (?:read|review|check|task)(?: instead)?$/iu,
      '',
    )
    .replace(
      /\s+(?:for|on) (?:that|the) (?:very )?same (?:read|reading|inspection|check|review)$/iu,
      '',
    )
    .replace(/\s+(?:nhé|nhe|nha|please|instead)$/iu, '')
    .trim();
  const namedBackup =
    /^(?<actor>.+?)\s+(?:(?:should|can|may|will|to)\s+)?(?:take|do|perform|handle)\s+(?:exactly that|(?:(?:the|that)\s+)?(?:(?:very|exact) same|same|identical))\s+(?<work>read|review|check|task)$/iu.exec(
      selected,
    )?.groups ??
    /^(?:give|assign|delegate)\s+(?<actor>.+?)\s+(?:that|the) (?:exact |very )?same (?<work>read|review|check|task)$/iu.exec(
      selected,
    )?.groups;
  const backupWork = namedBackup?.work.toLowerCase();
  if (
    ((backupWork === 'read' || backupWork === 'check') && kind !== 'research') ||
    (backupWork === 'review' && kind !== 'review')
  )
    return;
  const matches = grantsFor(namedBackup?.actor ?? selected, team);
  if (
    matches.length !== 1 ||
    matches[0].id === primary.id ||
    (kind === 'code' && !matches[0].allowWrites) ||
    (platform && matches[0].platform !== platform && matches[0].pairedPlatform !== platform)
  )
    return;
  return matches[0].id;
}

function revisionIn(source: string) {
  return [...new Set(Array.from(fold(source).matchAll(commitToken), ([, id]) => id))];
}

function protectedEnding(text: string) {
  if (
    /^(?:(?:khong|dung) (?:giao|nho|cho) ai (?:sua|chinh|viet|ghi)|(?:do not|don t) (?:assign|authorize) anyone to (?:edit|write|modify))(?: nha| nhe| please)?$/.test(
      text.trim(),
    )
  )
    return true;
  return /^(?:(?:please )?(?:leave|keep|preserve) (?:it|the file|the files|the patch)(?: as (?:it is|is)| unchanged| untouched| alone)|no (?:(?:file|source|repository) )?(?:edits?|changes?)(?: to (?:it|the (?:file|files|patch)))?|(?:khong|dung) (?:sua|chinh|viet|ghi|doi) (?:tep|file|code)(?: nao)?(?: nhe| nha)?|(?:do not|don['’]t|neither (?:teammate |reviewer )?should) (?:edit|write|modify|merge|commit|deploy|reassign)(?: (?:or|and) (?:edit|write|modify|merge|commit|deploy|reassign))*(?: (?:it|the (?:file|files|patch|task)))?)$/u.test(
    text.trim(),
  );
}

const preserveOtherScope =
  /^(?:(?:file|tep|phan|muc|ban|bang|lich|to|danh sach|implementation|logic|code|ma nguon|cai (?:lich|file|tep|ban|phan))\s+[^,;.!?]{1,100}\s+(?:(?:cu )?de nguyen|giu nguyen|van de cu|dung (?:sua|doi)(?: nhe| nha)?)|(?:leave|keep) (?:the )?(?:implementation|other files?|other sections?)(?: [^,;.!?]{1,90})? (?:unchanged|as is)|(?:giu nguyen|de nguyen) (?:phan|muc|to|bang|logic|implementation|cac (?:file|tep) khac)(?: [^,;.!?]{1,90})?|(?:khong|dung) (?:dung(?: den)?|sua|chinh) (?:so|muc|phan|ban|bang|to|tep|file) [^,;.!?]{1,90})$/u;

function preservesOtherScope(words: string) {
  return (
    (preserveOtherScope.test(words.replace(/ (?:nha|nhe|please)$/, '')) ||
      /^(?:giu nguyen|de yen) (?:so|muc|phan|ban|bang|to|component) [^,;.!?]{1,75}(?: va (?:phan|cac muc|cac file) con lai)?$/.test(
        words,
      ) ||
      /^(?:phan|ma nguon|logic|code|implementation) [^,;.!?]{1,75} (?:khong duoc|dung) (?:sua|chinh|doi|edit|change)$/u.test(
        words,
      )) &&
    !conditionalAction.test(words) &&
    !deferred.test(words) &&
    !dangerous.test(words)
  );
}

function detachedReview(parts: string[]) {
  const frame = parts.find((part) => {
    const words = withoutPaths(part);
    return (
      /^(?:i |we )?(?:need|would like|want|please arrange)\s+(?:two|three|2|3)\s+/.test(words) &&
      /\b(?:independent (?:read[ -]only )?reviews|read[ -]only independent reviews)\b/.test(
        words,
      ) &&
      referenceCue.test(words)
    );
  });
  if (!frame) return;
  const assignment = parts
    .map((part) => ({
      part,
      groups:
        /^(?:please\s+)?(?:send|assign|give|delegate)\s+(?<evidence>(?:the |that )?(?:exact )?same\s+(?:revision|commit|patch|diff|files)(?:\s+and\s+both(?:\s+of\s+(?:its|the))?\s+files)?)\s+to\s+(?<actors>.+)$/iu.exec(
          part,
        )?.groups,
    }))
    .filter(({ groups }) => groups);
  if (assignment.length !== 1) return;
  const [{ groups, part }] = assignment;
  if (!groups) return;
  return { actors: groups.actors, evidence: `${frame}. ${groups.evidence}`, frames: [frame, part] };
}

function independentReview(
  parts: string[],
  earlier: string,
  team: readonly Member[],
): SharedSadeCloudResult | undefined {
  const text = parts.join('. ');
  const words = withoutPaths(text);
  const affirmative = parts
    .filter((part) => !protectedEnding(withoutPaths(part)))
    .map(withoutPaths)
    .join('. ');
  if (
    !/\b(?:doc lap|independent(?:ly)?|chu tai khoan khac|different (?:account )?owner)\b/.test(
      words,
    ) ||
    !/\b(?:reviews?|ra soat|audits?)\b/.test(words) ||
    dangerous.test(affirmative)
  )
    return;
  const detached = detachedReview(parts);
  const request =
    detached ??
    parts.map((part) => reviewAssignment.exec(stripOpening(part))?.groups).find(Boolean);
  const writerName = parts
    .map((part) => {
      const writer =
        /^(?<owner>[\p{L}\p{M}\p{N}_ -]{1,70}?)\s+(?:dùng|dung|used|uses)\s+(?<label>[\p{L}\p{M}\p{N}_ -]{1,70}?)\s+(?:viết|viet|wrote|to write|made|sửa|sua)\s+/iu.exec(
          part,
        )?.groups;
      return (
        authorAssignment.exec(part)?.groups?.actor ??
        (writer && `${writer.label} của ${writer.owner}`)
      );
    })
    .find(Boolean);
  const actors = request?.actors.split(/\s*(?:,|\s+(?:và|va|and|&)\s+)\s*/iu) ?? [];
  if (!request || actors.length < 2) {
    // An existing patch with a proposed same-owner reviewer requires a different account.
    const proposed =
      /(?:^|\s)(?:nhờ|nho|ask|have|đề xuất|de xuat|suggest(?:ed)?)\s+([^,.!?]{1,110}?)(?=\s+(?:review|rà soát|ra soat)\b|[,.!?]|$)/iu.exec(
        text,
      )?.[1];
    const proposedName = proposed?.replace(/\s+(?:cũng|cung)\s+(?:của|cua)\s+/iu, ' của ');
    const writer = writerName && grantsFor(writerName, team);
    const matches = proposedName && grantsFor(proposedName.replace(/\s+to\s+review$/iu, ''), team);
    if (
      writer &&
      writer.length === 1 &&
      matches &&
      matches.length === 1 &&
      nameEquals(writer[0].owner, matches[0].owner)
    )
      return question(
        'Bạn muốn chọn reviewer độc lập thuộc chủ tài khoản khác người viết bản vá nào?',
      );
    return;
  }
  const count =
    detached &&
    /\b(?:need|want|like|arrange)\s+(two|three|2|3)\b/.exec(fold(detached.evidence))?.[1];
  if (
    actors.length > 3 ||
    (count && actors.length !== (/^(?:two|2)$/.test(count) ? 2 : 3)) ||
    !referenceCue.test(withoutPaths(request.evidence))
  )
    return;
  if (
    /\b(?:va|roi|then|and|also) (?:nho |giao |hay |please )?(?:sua|viet|tao|chay|edit|write|create|run|delete)\b/.test(
      words,
    )
  )
    return;
  const names = actors.map((actor) => grantsFor(actor, team));
  const unclear = names.findIndex((matches) => matches.length !== 1);
  if (unclear !== -1) return grantQuestion(actors[unclear], names[unclear]);
  const reviewers = names.map(([member]) => member);
  if (
    parts.some((part) => {
      const opening = stripOpening(part);
      if (
        detached?.frames.includes(part) ||
        reviewAssignment.exec(opening)?.groups?.actors === request.actors
      )
        return false;
      const plain = withoutPaths(part);
      if (
        protectedEnding(plain) ||
        /^(?:they|both reviewers|both agents) (?:can|may|should) (?:start|work|review) in parallel(?: and (?:can |should )?report separately)?$/u.test(
          plain,
        )
      )
        return false;
      return (
        !/^(?:hai (?:ben|nguoi|reviewer)|both (?:agents|reviewers|people)|moi (?:ben|nguoi)|each (?:agent|reviewer|person)|chi (?:gui|bao)|giu nguyen|send (?:only|just) (?:comments|findings)|keep (?:it|the patch) unchanged|(?:dung|khong|do not|don t) (?:sua|edit|wait|cho))\b/.test(
          plain,
        ) ||
        /\b(?:roi|sau do|va|thi|then|after that|and) (?:nho |giao |hay |please )?(?:sua|viet|tao|chay|them|xoa|edit|write|create|run|add|delete)\b/.test(
          plain,
        )
      );
    })
  )
    return;
  const referenceScope = scopes(earlier);
  const currentScope = scopes(text);
  const revisions = revisionIn(earlier);
  const currentRevisions = revisionIn(text);
  const exactPatch =
    /\b(?:cung (?:mot )?(?:commit|ban va|patch|diff)|(?:the )?(?:exact )?same (?:commit|revision|patch|diff)|(?:dung |ca |cung )?(?:hai|both|two) (?:(?:of )?(?:its|the) )?(?:tep|file|files|paths))\b/.test(
      words,
    );
  if (
    revisions.length !== 1 ||
    currentRevisions.some((id) => id !== revisions[0]) ||
    !referenceScope?.length ||
    referenceScope.length > 12 ||
    !currentScope ||
    (currentScope.length
      ? currentScope.length !== referenceScope.length ||
        currentScope.some((path) => !referenceScope.includes(path))
      : referenceScope.length > 1 && !exactPatch) ||
    (/\b(?:hai|2|both|two) (?:(?:of )?(?:its|the) )?(?:tep|file|files|paths)\b/.test(words) &&
      referenceScope.length !== 2)
  )
    return question(
      'Bạn hãy xác nhận đúng commit và các đường dẫn trong bản vá cần từng reviewer đọc.',
    );
  const currentAuthor =
    /\b(?:bản vá|ban va|patch|diff)\s+(?:do\s+|của\s+|cua\s+|by\s+|from\s+)?(.+?)\s+(?:trong tin|ở tin|o tin|in the (?:previous|referenced) message|from the (?:previous|referenced) message|above)\b/iu.exec(
      request.evidence,
    )?.[1];
  const referenceAuthor =
    /\b(?:commit|revision|sha(?:-1)?)\s*:?\s*\x60?[a-f0-9]{7,40}\x60?\s+(?:của|cua|do|by|from)\s+(.+?)(?=\s+(?:và|va|and|chỉ|chi|gồm|gom|with|includes)\s|[,;.!?]|$)/iu.exec(
      earlier,
    )?.[1];
  const authors = [writerName, currentAuthor, referenceAuthor].filter((name): name is string =>
    Boolean(name),
  );
  const authorMatches = authors.map((name) => grantsFor(name, team));
  if (
    authorMatches.some((matches) => matches.length !== 1) ||
    new Set(authorMatches.map(([member]) => member.id)).size > 1 ||
    new Set(reviewers.map(({ owner }) => fold(owner))).size !== reviewers.length ||
    authorMatches.some(([author]) =>
      reviewers.some(({ owner }) => fold(owner) === fold(author.owner)),
    )
  )
    return question(
      'Bạn muốn chọn reviewer độc lập thuộc chủ tài khoản khác người viết bản vá và khác nhau nào?',
    );
  return plan(
    reviewers.map((member, index) =>
      scopedTask(`review-${index + 1}`, 'review', referenceScope, member, request.evidence, {
        revision: revisions[0],
      }),
    ),
  );
}

function platformFor(words: string) {
  const targets = [
    ...(/\b(?:macos|macbook|darwin|may mac|mac (?:da|that|cua)|(?:on|tren) (?:the |cai )?mac)\b/.test(
      words,
    ) || /\b(?:on|using) (?:the )?[\p{L}\p{N}_.-]+['’]s (?:paired )?mac\b/u.test(words)
      ? ['darwin' as const]
      : []),
    ...(/\b(?:windows|win32)\b/.test(words) ? ['win32' as const] : []),
    ...(/\b(?:linux|ubuntu|debian)\b/.test(words) ? ['linux' as const] : []),
  ];
  return targets;
}

const writeVerb =
  /^(?:sua|chinh|viet|tao|cap nhat|bo sung|thay the|them|doi|thay|edit|fix|write|create|update|change|replace|add)$/;
const verifyVerb =
  /^(?:chay kiem (?:thu|tra)|run |kiem (?:thu|tra)|xac minh|ra git|check|test|verify)/;
const gitEvidence = /\b(?:commit|lich su git|git history|revision|(?:git )?tag)\b/;
const reviewVerb = /^(?:ra soat|review|audit)$/;
const deferred =
  /\b(?:neu|if|unless|until|otherwise|tru khi|sau khi|after|before|truoc khi|thay vi)\b/;
const pendingWrite =
  /\b(?:only (?:after|once|when|if)|(?:once|when|until|after|before) (?:(?:i|we|you|they|the (?:requester|owner|reviewer|team)) )?(?:(?:have been|have|has|am|are|is|ve) )?(?:approv(?:e[ds]?|al)|confirm(?:s|ed)?|give (?:the )?(?:green light|go[ -]ahead)|sign(?:s|ed)?[ -]off|release approval|reply with approval)|(?:wait|hold off) (?:for|until)|(?:khi nao|chung nao|sau khi|luc nao) (?:(?:minh|toi|tui|ben minh|nguoi gui|chu tai khoan) )?(?:da )?(?:duyet|phe duyet|xac nhan|dong y|bat den xanh|bao chay|bao lam)|(?:doi|cho) (?:minh|toi|tui|phe duyet|duyet|xac nhan)|(?:chi (?:lam|sua|giao)|moi (?:lam|sua|giao)) (?:sau khi|khi da) |(?:i ll|i will|we ll|we will) send (?:the )?go[ -]ahead)\b/;

export function sharedSadeWriteIsWaiting(request: string) {
  return pendingWrite.test(withoutPaths(request).replace(/[’']/g, ' '));
}
const reportWhen =
  /\b(?:bao (?:lai )?(?:(?:toi|minh|tui) )?|cho (?:toi|minh|tui) biet |report (?:back )?|tell me |let me know |explain |check |see |verify )(?:neu|if|whether)\b/;
const readConditionQuestion =
  /\b(?:xem|coi|kiem tra|xac minh) neu (?=[^;.!?]{1,180}\b(?:khong|chua)(?: (?:nha|nhe))?$)/;
const scopedReadQuestion =
  /^(?!\b(?:hay|xin|nho|giao|cho|dung|khong|noi|bao)\b)[^,;.!?]{1,65}\b(?:(?:co|da|con|se) [^,;.!?]{1,100}\b|(?:van con|con|da co) )(?:khong|chua)(?: (?:nha|nhe))?$/;
const conditionalAction =
  /\b(?:thi|hay|then|please|and|va) (?:[\p{L}\p{N}_-]+ ){0,3}(?:sua|chinh|viet|ghi|them|tao|chay|xoa|edit|write|modify|add|create|run|delete)\b/u;
const followUp =
  /^(?:(?:mình|minh|tôi|toi|bọn mình|we|i)\s+)?(?:chỉ cần|chi can|cần biết|can biet|cần xem|can xem|muốn xem|muon xem|chúng tôi cần biết|chung toi can biet|(?:only )?(?:need|want) to (?:know|see|check)|coi thử|coi thu|xem thử|xem thu|giải thích|giai thich|explain|look (?:at|for)|check giúp|check giup|please report|hỏi một câu thôi|hoi mot cau thoi)(?=$|[\s,.:])/iu;
const status =
  /^(?:ben |tren |on |(?:buoi )?hop xong|meeting (?:ended|is over)|lan nay|minh chot|we approved|approved now|[^,.!?]{1,100} da pass|chot lam luon|(?:ua )?(?:minh|toi|tui) (?:da )?(?:day|commit) [^,;]+ roi|(?:cat|khoan|tam dung|bo qua|hold off on|park) (?:viec|phan|the)? ?(?:sua|edit|change) (?:trong tin truoc|in the (?:previous|above) message)(?: nha| nhe| for now)?$)/;

const pairedMention =
  /\b(?:mac(?:os|book)?|may|machine|device) (?:da ghep cap voi|da ghep (?:cap )?cua|cua|thuoc|named|paired with|belonging to|of)\s+([^,.!?]+?)(?=\s+(?:nha|nhe|please)\b|[,.;!?]|$)/;
const pairedPossessive =
  /\b(?:on|using) (?:the )?([\p{L}\p{N}_.-]+)(?:'s|’s) (?:paired )?(?:mac(?:os|book)?|machine|device)\b/u;
const pairedContext =
  /^(?:may |thiet bi |the |[^,]{1,48}'s )?[^,]{1,60}\b(?:la|is|runs) (?:windows|macos|linux|ubuntu)\s+(?:nen|so) (?:dung|use)\s+/;
const gitMissingReport =
  /^(?:chua thay|chua tim thay|if (?:it is )?missing) (?:thi |then )?(?:nhan|bao|tell|report to) (?:minh|toi|tui|me)(?:[, ]+(?:dung|do not) (?:lam lai|commit|sua|reimplement|edit)(?:[, ]+(?:va |and )?(?:dung|do not) (?:lam lai|commit|sua|reimplement|edit))*(?: gi)?)?$/;

function limitsChangesToTest(words: string, file: string) {
  if (!/\.(?:test|spec)\.[a-z0-9]+$/i.test(file)) return false;
  const onlyTest =
    /^(?:chi (?:sua|chinh) (?:dung )?(?:test|bai kiem thu|(?:file|tep) test)(?: (?:do|nay))?|only (?:edit|change) (?:that|this|the) (?:test|test file))$/;
  if (onlyTest.test(words)) return true;
  if (
    /^(?:dung|khong|do not) (?:sua|chinh|edit|modify) (?:the )?(?:code|ma nguon|source|implementation|(?:file|tep) (?:hien thi|source|implementation))(?: [^,;.!?]{1,75})?$/.test(
      words,
    )
  )
    return true;
  const clauses = words.split(/,\s*/u);
  return (
    clauses.length === 2 &&
    ((onlyTest.test(clauses[0]) && preservesOtherScope(clauses[1])) ||
      (preservesOtherScope(clauses[0]) && onlyTest.test(clauses[1])))
  );
}

function scopedTestVerification(edit: string, followup: string) {
  const paths = scopes(edit);
  const extra = scopes(followup);
  if (
    paths?.length !== 1 ||
    !/\.(?:test|spec)\.[a-z0-9]+$/i.test(paths[0]) ||
    !extra ||
    extra.some((file) => file !== paths[0])
  )
    return false;
  const text = fold(followup.replace(paths[0], 'the same test')).replaceAll('`', '');
  return /^(?:(?:them (?:case|ca|test)|sua (?:file|tep|test)|lam) xong (?:thi )?|(?:sau do|roi|then|after (?:the edit|that))[, ]+)?(?:chay|run|rerun)(?: lai)? (?:chinh |dung |rieng |exactly |only )?(?:(?:bai|tep|file) (?:kiem thu|test) (?:do|nay|ay)|(?:the )?same test|this test|that test|test (?:do|nay|ay)) (?:tren|on) (?:linux|ubuntu|debian|windows|macos|mac)(?: (?:giup minh|nha|nhe|please))?$/.test(
    text,
  );
}

function directTask(
  route: Route,
  other: string[],
  earlier: string,
  team: readonly Member[],
  selectedScope?: string,
): PlanTask | SharedSadeCloudResult | undefined {
  const routeWords = withoutPaths(route.evidence);
  const otherWords = other.map(withoutPaths);
  const candidates = grantsFor(route.actor, team);
  const writes = writeVerb.test(route.verb);
  if (candidates.length !== 1) return grantQuestion(route.actor, candidates, writes);
  const [member] = candidates;
  const verification =
    writes && other.filter((part) => scopedTestVerification(route.evidence, part));
  if (verification && verification.length > 1) return scopeQuestion();
  const check = verification ? verification[0] : undefined;
  const targets = platformFor([routeWords, check ? withoutPaths(check) : ''].join(' '));
  if (targets.length > 1)
    return question('Bạn muốn chạy tác vụ trên thiết bị và hệ điều hành nào?');
  const [platform] = targets;
  const kind =
    writes || (verifyVerb.test(route.verb) && (platform || /^(?:chay|run)\b/.test(route.verb)))
      ? 'code'
      : reviewVerb.test(route.verb)
        ? 'review'
        : 'research';
  if (kind === 'code' && [route.clause, ...other].some(sharedSadeWriteIsWaiting))
    return question('Bạn muốn xác nhận điều kiện nào trước khi Sade giao việc sửa?');
  if (kind === 'code' && !member.allowWrites) return grantQuestion(route.actor, candidates, true);
  if (
    platform &&
    member.platform !== platform &&
    (kind !== 'code' || member.pairedPlatform !== platform)
  )
    return question(
      `${redact(route.actor)} cần quyền dùng thiết bị ${platformNames[platform]} trong dự án này. Bạn muốn ghép cặp máy nào?`,
    );
  const machineReferences = [
    routeWords,
    ...otherWords.filter((words) => pairedContext.test(words)),
  ].flatMap(
    (words) => (pairedMention.exec(words)?.[1] ?? pairedPossessive.exec(words)?.[1])?.trim() ?? [],
  );
  if (new Set(machineReferences).size > 1)
    return question('Bạn muốn dùng đúng thiết bị đã ghép cặp nào?');
  const [machineReference] = machineReferences;
  const machine = machineReference && member.pairedMachineName;
  if (machineReference) {
    const system = platform && fold(platformNames[platform]);
    const label = machine && fold(machine);
    if (
      kind !== 'code' ||
      !system ||
      !label ||
      member.pairedPlatform !== platform ||
      ![
        machineReference,
        `mac cua ${machineReference}`,
        `${system} cua ${machineReference}`,
        `${system} of ${machineReference}`,
        `${machineReference}'s ${system}`,
      ].includes(label)
    )
      return question(
        `${redact(route.actor)} cần quyền dùng đúng thiết bị ${platform ? platformNames[platform] : 'đã ghép cặp'} mà bạn chỉ định. Bạn muốn xác nhận máy nào?`,
      );
  }

  const tailParts = other.filter(
    (part) => quotaCondition(fold(part)) || keepQuota.test(fold(part)),
  );
  if (tailParts.length > 1) return;
  const embeddedQuota = quotaCondition(fold(route.evidence));
  if (embeddedQuota && tailParts.length) return;
  const evidence = embeddedQuota
    ? route.evidence.slice(0, embeddedQuota.index).trim()
    : route.evidence;
  const quotaClause = embeddedQuota ? route.evidence.slice(embeddedQuota.index) : tailParts[0];
  const backup = quotaClause ? backupFor(quotaClause, member, team, kind, platform) : undefined;
  if (quotaClause && !backup)
    return question(
      `Nếu ${redact(route.actor)} hết lượt, bạn muốn giữ nguyên người phụ trách hay cho phép một teammate đã được cấp quyền thay thế?`,
    );
  if (machine && backup && backup !== 'none' && backup !== 'wait')
    return question(
      'Thiết bị đã được chỉ định. Bạn muốn giữ nguyên teammate hay cấp quyền cho teammate dự phòng trên đúng thiết bị đó?',
    );

  const active = withoutPaths(evidence);
  let positive = active.replace(
    /\b(?:dung|khong(?: duoc)?|do not|don t|without) (?:sua|chinh|viet|ghi|edit|write|modify|editing|writing|modifying)(?: gi)?\b/g,
    ' ',
  );
  if (kind !== 'code')
    positive = positive.replace(
      /\b(?:ngay|gio|thoi diem) tai len\b|\b(?:roi|va) ghi (?:lai thoi(?=\s*$|[,.!?])|ket luan(?=\s*:))/g,
      ' ',
    );
  const codeAndCheck =
    kind === 'code' &&
    platform &&
    (!/\b(?:chay lai|rerun) (?:dung |chinh |exactly )?(?:bai(?: test)?|test)\b/.test(positive) ||
      /\.(?:test|spec)\.[a-z0-9]+$/i.test(scopes(evidence)?.[0] ?? '')) &&
    /\b(?:roi|va|then|and|xong) (?:kiem(?: tra| thu)?|test|verify|chay(?: lai| (?:test|kiem thu))?|(?:run|rerun)(?: (?:the )?tests?)?)(?: (?:dung |chinh |exactly )?(?:bai(?: test)?|test)(?: (?:do|nay|ay|no|it))?| (?:dung |chinh |exactly )?(?:do|nay|ay|no|it))? (?:tren|on) [^,;.!?]+$/.test(
      positive,
    ) &&
    !/\b(?:push|merge|deploy|xoa|delete|sua|edit|write|publish|them|tao)\b/.test(positive);
  const inlineReport =
    kind !== 'code' &&
    (reportWhen.exec(positive) ??
      (kind === 'research' ? readConditionQuestion.exec(positive) : null));
  if (inlineReport && conditionalAction.test(positive.slice(inlineReport.index)))
    return question('Bạn muốn chỉ đọc và báo kết quả, hay yêu cầu sửa riêng sau khi có kết quả?');
  if (
    dangerous.test(positive) ||
    deferred.test(inlineReport ? positive.slice(0, inlineReport.index) : positive) ||
    (kind === 'code' && noWrite.test(active)) ||
    (!codeAndCheck &&
      /\b(?:roi|va|then|also|and) (?:nho |giao |hay |please )?(?:chay|sua|xoa|ghi|them|tao|run|edit|write|fix|create|delete|review|assign|ask)\b/.test(
        positive,
      ))
  )
    return;

  const current = scopes(evidence);
  const originalPaths = scopes(route.clause);
  if (
    !current ||
    !originalPaths ||
    (originalPaths.some((path) => !current.includes(path)) && !quotaClause)
  )
    return scopeQuestion();
  const referenced = selectedScope
    ? [selectedScope]
    : referenceCue.test(active)
      ? scopes(earlier)
      : [];
  if (!referenced) return scopeQuestion();
  if (
    current.length > 1 ||
    (!current.length && referenced.length !== 1) ||
    (current.length && referenced.length && !referenced.includes(current[0]))
  )
    return scopeQuestion(current.length ? current : referenced);
  const scope = current.length ? current : referenced;
  const asksAboutRead = (words: string) =>
    kind === 'research' &&
    (!gitEvidence.test(active) || /^(?:dung|use) git\b/u.test(active)) &&
    !gitEvidence.test(words) &&
    scopedReadQuestion.test(words) &&
    !conditionalAction.test(words);
  const historicalReadDetail = (clause: string) => {
    if (kind !== 'research' || !gitEvidence.test(active) || !referenceCue.test(active))
      return false;
    const words = withoutPaths(clause);
    const paths = scopes(clause);
    return (
      paths?.every((path) => scope.includes(path)) &&
      /^(?:doc|xem|coi|read|inspect) (?:(?:the |that )?(?:file|tep)(?: (?:do|ay|duoc (?:neu|nhac)|named|mentioned))?) (?:o|trong|tai|at|in|from) (?:the )?(?:commit|revision) (?:do|ay|nay|above) (?:de|to) (?:kiem(?: tra)?|xac minh|check|verify|confirm)\b/u.test(
        words,
      ) &&
      !dangerous.test(words) &&
      !conditionalAction.test(words) &&
      !/\b(?:sua|chinh|viet|edit|modify|write|again|an additional|another)\b/u.test(words)
    );
  };
  if (quotaClause) {
    const quotaScope = scopes(quotaClause);
    if (
      !quotaScope ||
      quotaScope.some((path) => !scope.includes(path)) ||
      dangerous.test(withoutPaths(quotaClause))
    )
      return scopeQuestion();
  }
  if (
    kind !== 'code' &&
    otherWords.some((words) => {
      const report = reportWhen.exec(words);
      return report && conditionalAction.test(words.slice(report.index));
    })
  )
    return question('Bạn muốn chỉ đọc và báo kết quả, hay yêu cầu sửa riêng sau khi có kết quả?');
  if (
    other.some((clause, index) => {
      const words = otherWords[index];
      if (clause === quotaClause || clause === check) return false;
      const extra = scopes(clause);
      if (
        kind === 'code' &&
        extra?.every((path) => scope.includes(path)) &&
        !dangerous.test(words) &&
        !deferred.test(words) &&
        !conditionalAction.test(words) &&
        (limitsChangesToTest(words, scope[0]) ||
          /^(?:chi (?:sua|chinh) (?:dung )?(?:test|file(?: test)?|tep(?: test)?) (?:do|nay)(?:, (?:giu nguyen|de nguyen) [^,;.!?]{1,115})?|chi dung (?:file|tep) test(?:, (?:giu nguyen|de nguyen) [^,;.!?]{1,115})?|only (?:edit|change) (?:that|this) (?:test|file)|chi (?:them|bo sung) (?:mot )?(?:case test|test case)(?:[, ]+khong (?:sua|chinh) (?:phan|muc|implementation) [^,;.!?]{1,90})?)$/.test(
            words,
          ))
      )
        return false;
      if (
        kind === 'code' &&
        extra?.every((path) => !scope.includes(path)) &&
        preservesOtherScope(words)
      )
        return false;
      if (extra?.every((path) => scope.includes(path)) && protectedEnding(words) && kind !== 'code')
        return false;
      if (
        !extra ||
        extra.some((path) => !scope.includes(path)) ||
        dangerous.test(words) ||
        noWork.test(words)
      )
        return true;
      if (gitMissingReport.test(words) && (gitEvidence.test(active) || route.verb === 'ra git'))
        return false;
      const retainedPrimary =
        /^(?:(?:while (?:it|that account) has quota, )?keep|otherwise (?:(?:keep|leave) (?:it|the (?:job|task|assignment)) with|keep)|con lai (?:giu nguyen viec cho|van giao cho)) (.+?)(?: as the assignee in all other cases| on it)?$/.exec(
          words,
        )?.[1];
      if (retainedPrimary && backup && matchesSingleGrant(retainedPrimary, member, team))
        return false;
      if (
        backup &&
        /^(?:otherwise )?(?:keep|retain) (?:the )?(?:primary|original (?:account|assignee)) (?:the rest of the time|in all other cases)$/u.test(
          words,
        )
      )
        return false;
      if (
        (backup === 'wait' || backup === 'none') &&
        /^(?:(?:minh|toi|tui) )?(?:(?:khong|dung) (?:doi|chuyen|nho|giao) (?:(?:sang|qua) )?(?:nguoi(?: khac)?|ban khac|ai(?: khac)?|tai khoan khac)|do not reassign|no reassignment|co (?:luot|quota) thi (?:doc|xem|chay|tiep tuc)(?: tiep)?)(?: nha| nhe| please)?$/.test(
          words,
        )
      )
        return false;
      const [opening, detail, ...otherDetails] = words.split(/,\s*/u);
      const pinned =
        /^(?:nguoi phu trach van la|giu luot bang|keep (?:the )?(?:assignee|owner) as)\s+(.+?)(?: nhe| nha| please)?$/.exec(
          detail ?? opening,
        )?.[1];
      if (
        pinned &&
        !otherDetails.length &&
        (machine || backup === 'none' || backup === 'wait') &&
        (!detail || /^[^,;]+ (?:von o|dang o|uses|is on) (?:windows|macos|linux)$/.test(opening)) &&
        grantsFor(pinned, team).length === 1 &&
        grantsFor(pinned, team)[0].id === member.id
      )
        return false;
      const sameAssignee =
        /^(?:luot nay van chay bang|still using)\s+(.+?)(?: nhe| nha| please)?$/.exec(
          detail ?? '',
        )?.[1];
      if (
        machine &&
        !otherDetails.length &&
        (pairedContext.test(opening) ||
          /^(?:[\p{L}\p{N} ._-]{1,65}) (?:da cho dung|dong y cho|consents? to|has approved) (?:chay cong cu(?: kiem thu| test)?|cong cu chay test|running (?:the )?tools?)(?: tren (?:may|thiet bi) (?:(?:da )?ghep(?: cap)? )?(?:nay|do))?$/u.test(
            opening,
          )) &&
        (!detail ||
          (sameAssignee &&
            grantsFor(sameAssignee, team).length === 1 &&
            grantsFor(sameAssignee, team)[0].id === member.id))
      )
        return false;
      if (
        followUp.test(clause) ||
        noWrite.test(words) ||
        asksAboutRead(words) ||
        historicalReadDetail(clause) ||
        (kind !== 'code' && reportWhen.test(words))
      ) {
        const instruction = words.replace(
          /\b(?:dung|khong(?: duoc)?|do not|don t|without) (?:sua|chinh|viet|ghi|edit|write|modify)(?: gi)?\b/g,
          ' ',
        );
        const requestWords = instruction.replace(
          /^.*?\b(?:can biet|can xem|need to know|need to see|chi can)\b/,
          ' ',
        );
        return (
          /\b(?:hay|nho|giao|then|please|also|and) (?:tu )?(?:sua|chinh|viet|ghi|them|tao|chay|edit|write|modify|add|create|run)\b/.test(
            requestWords,
          ) ||
          (kind === 'code' && noWrite.test(words))
        );
      }
      return !/^\b(?:(?:[^,.!?]{1,80}) (?:chi cho muon may|only lends (?:the )?(?:device|machine))|(?:windows|macos|linux|ubuntu) [^,.!?]* da pass|(?:my|our) (?:windows|macos|linux) [^,.!?]* (?:passed|works))\b/.test(
        words,
      );
    })
  )
    return;

  const details = [
    evidence,
    ...other.filter(
      (clause) =>
        clause !== quotaClause &&
        (clause === check ||
          followUp.test(clause) ||
          asksAboutRead(withoutPaths(clause)) ||
          historicalReadDetail(clause) ||
          (kind !== 'code' &&
            (reportWhen.test(withoutPaths(clause)) ||
              gitMissingReport.test(withoutPaths(clause))))),
    ),
  ]
    .filter(Boolean)
    .join('. ');
  const gitCheck =
    kind === 'research' &&
    (gitEvidence.test(active) || route.verb === 'ra git') &&
    (verifyVerb.test(route.verb) || /^(?:read|inspect|doc|xem|coi)$/.test(route.verb));
  const referenceRevisions = revisionIn(earlier);
  const referenceBindsScope = requestParts(earlier).some(
    (part) => scopes(part)?.includes(scope[0]) && revisionIn(part).includes(referenceRevisions[0]),
  );
  const currentRevisions = revisionIn(evidence);
  const latestRevision =
    /\b(?:commit(?: moi nhat| sau cung)|(?:latest|newest|most recent) (?:commit|revision))\b/.test(
      active,
    );
  if (
    gitCheck &&
    (currentRevisions.length > 1 ||
      (!latestRevision &&
        ![...evidence.matchAll(tagToken)].length &&
        referenceCue.test(active) &&
        (referenceRevisions.length !== 1 ||
          !referenceBindsScope ||
          currentRevisions.some((id) => id !== referenceRevisions[0]))))
  )
    return question('Bạn muốn xác minh commit nào trong tệp được tham chiếu?');
  return scopedTask(
    'task',
    kind,
    scope,
    member,
    gitCheck ? `Chỉ đọc lịch sử Git và kiểm tra đúng thay đổi đã nêu. ${details}` : details,
    {
      platform,
      machine,
      backup: backup === 'none' || backup === 'wait' ? undefined : backup,
      ...(backup === 'wait' ? { waitForProviderQuota: true } : {}),
      revision:
        gitCheck && !latestRevision
          ? (currentRevisions[0] ?? (referenceCue.test(active) ? referenceRevisions[0] : undefined))
          : undefined,
    },
  );
}

function parallelRoutes(routes: Route[], parts: string[], team: readonly Member[]) {
  if (routes.length < 2 || routes.length > 4) return;
  const openings = parts.filter((part) => !routes.some(({ clause }) => clause === part));
  if (
    !openings.some((part) =>
      /\b(?:song song|parallel|doc lap|independent)\b/.test(withoutPaths(part)),
    ) ||
    openings.some(
      (part) =>
        (!/^(?:chia (?:hai|ba|bon|2|3|4) |(?:hai|ba|bon|2|3|4) (?:dau |hang muc |tac )?viec |split (?:these |the )?(?:tasks|work)|(?:these|both) (?:tasks|items|checks|pieces of work) |(?:can |hay |please )?(?:lam |chay |run )?(?:song song|in parallel))/.test(
          withoutPaths(part),
        ) &&
          !/^(?:(?:please )?split (?:this|the work|these tasks) into (?:two|three|four|2|3|4) parallel (?:assignments|tasks|jobs)|there(?: is|['’]s) no dependency between (?:these|the) (?:two|three|four|2|3|4) (?:changes|tasks|assignments))$/.test(
            withoutPaths(part),
          )) ||
        scopes(part)?.length !== 0,
    )
  )
    return;
  const tasks: PlanTask[] = [];
  for (const [index, route] of routes.entries()) {
    const result = directTask(route, [], '', team);
    if (!result || !('key' in result)) return result;
    if (
      result.fallbackMemberId ||
      tasks.some(({ scope }) =>
        scope.some((path) =>
          result.scope.some((other) => other.toLowerCase() === path.toLowerCase()),
        ),
      )
    )
      return;
    tasks.push({ ...result, key: `task-${index + 1}`, title: `${result.title} (${index + 1})` });
  }
  return plan(tasks);
}

function ordinalRoute(parts: string[], earlier: string, team: readonly Member[]) {
  const opening =
    /^(?:trong (?:hai|2) (?:file|tệp|tep) (?:trên|tren|đó|do)|of the two (?:files|paths)(?: above)?)\s*,\s*(.+)$/iu.exec(
      parts[0],
    )?.[1];
  if (!opening) return;
  const route = routeAt(opening);
  if (!route || !/^(?:doc|xem|coi|read|inspect|check)$/.test(route.verb)) return;
  const selector =
    /^(?:cai |file |tep |the )?(dau|thu nhat|thu hai|sau|first|second|latter)(?: thoi| only)?$/.exec(
      withoutPaths(route.evidence),
    )?.[1];
  const files = scopes(earlier);
  if (!selector || files?.length !== 2) return scopeQuestion(files);
  const task = directTask(
    route,
    parts.slice(1),
    earlier,
    team,
    files[/^(?:dau|thu nhat|first)$/.test(selector) ? 0 : 1],
  );
  return task && ('key' in task ? plan([task]) : task);
}

function approvedReference(parts: string[], earlier: string, team: readonly Member[]) {
  const approval = fold(parts[0] ?? '');
  const literal = approvedLiteral.test(approval);
  const finalDetail =
    /^(?:(?:ok|okay|duoc|yes)[, ]+)?(?:(?:gio|bay gio|now) )?(?:toi|minh|tui|i|we) (?:(?:da )?chot|(?:have )?finali[sz]ed) ((?!.*\b(?:nhung|but|chua|khong|not|unless|tru khi)\b)[^,;.!?]{1,90})$/u.exec(
      approval,
    )?.[1];
  if (
    !/^(?:(?:ok|okay|duoc|yes)[, ]+)?(?:(?:phan chinh sua nay|noi dung nay|de xuat nay) )?(?:toi|minh|tui|i|we) (?:(?:da )?(?:phe )?duyet(?: roi| no)?|(?:da )?(?:phe )?duyet (?:sua|chinh|cap nhat) (?:noi dung|phan|de xuat) (?:nay|do|tren)(?: roi)?|approve(?:d)?(?: it| this| the (?:change|proposal))?(?: now)?)$/.test(
      approval,
    ) &&
    !literal &&
    !finalDetail &&
    !/^(?:toi|minh|tui|i|we) (?:(?:xac nhan )?da chot|confirm (?:i |we )?(?:approved|finali[sz]ed|signed off)) (?!.*\b(?:nhung|but|chua|khong|not|unless|tru khi)\b)[^,;.!?]{1,90}$/u.test(
      approval,
    )
  )
    return;
  const [instruction, ...inlineLimits] = (parts[1] ?? '').split(/,\s*/u);
  const isolatedLimit =
    inlineLimits.length === 1 && preservesOtherScope(withoutPaths(inlineLimits[0]));
  const routeLine = isolatedLimit ? instruction : parts[1];
  const route =
    routeLine &&
    (routeAt(routeLine) ??
      (literal
        ? routeAt(
            routeLine.replace(/\bthay (?=(?:câu|cau|dòng|dong|nhãn|nhan|chữ|chu)\s)/iu, 'replace '),
          )
        : undefined));
  if (
    (literal || finalDetail) &&
    route &&
    writeVerb.test(route.verb) &&
    scopes(parts[0])?.length === 0 &&
    (!finalDetail || literal || (!dangerous.test(finalDetail) && !deferred.test(finalDetail)))
  ) {
    const linkedWording = route.evidence.replace(
      /\b(?:mà|ma) (?:tôi|toi|mình|minh|tui) (?:đang|dang) (?:trả lời|tra loi|reply)\b/iu,
      'ở tin mình đang trả lời',
    );
    const labeledPath = sharedSadeReferencedFileEvidence(linkedWording, earlier);
    const scopeLimits = [...(isolatedLimit ? inlineLimits : []), ...parts.slice(2)];
    if (
      labeledPath &&
      scopeLimits.every((part) => {
        const words = withoutPaths(part);
        return scopes(part)?.every((path) => path !== labeledPath) && preservesOtherScope(words);
      })
    ) {
      const task = directTask(route, [], earlier, team, labeledPath);
      if (!task || !('key' in task)) return task;
      return plan([
        {
          ...task,
          description: [
            task.description,
            `Nội dung đã chốt: ${redact(parts[0])}.`,
            ...scopeLimits.map(redact),
          ]
            .join(' ')
            .slice(0, 2000),
        },
      ]);
    }
  }
  if (
    !route ||
    !(route.verb === 'thuc hien' || writeVerb.test(route.verb)) ||
    !referenceCue.test(withoutPaths(route.evidence)) ||
    !/^(?:(?:dung |only |the )?(?:(?:noi dung|de xuat) va )?(?:file|tep|duong dan|proposal|change|edit)(?: (?:nay|do|tren|ay))?(?: (?:da neu )?(?:trong|o|tu) (?:tin|tin nhan) (?:truoc|tren|duoc (?:tham chieu|tra loi)|(?:toi|minh|tui) (?:reply|tra loi))| (?:from|in) (?:the )?(?:previous|referenced) (?:message|reply))?|(?:huong dan|noi dung|ghi chu|chi tiet) (?:o|trong) dung (?:file|tep)(?: da neu)? (?:o|trong) tin (?:truoc|tren|duoc (?:tham chieu|tra loi)))$/u.test(
      withoutPaths(route.evidence).split(/,\s*/u)[0].trim(),
    )
  )
    return;
  const remainder = [
    route.evidence.split(/,\s*/u).slice(1).join(', '),
    ...(isolatedLimit ? inlineLimits : []),
    ...parts.slice(2),
  ].filter(Boolean);
  const keepSection =
    /^(?:(?:giu nguyen|leave|keep) (?:phan|muc|cac muc|cac phan|all other|the existing)\s+[^,;.!?]+|(?:phan|muc) [^,;.!?]{1,90} giu nguyen)$/;
  const preciseChange =
    /^(?:(?:chi|only) )?(?:thay|doi|replace|change) [^,;.!?]{1,100} (?:thanh|sang|to|with) [^,;.!?]{1,100}$/;
  let currentChange: string | undefined;
  for (const part of remainder) {
    const words = withoutPaths(part);
    if (scopes(part)?.length !== 0 || dangerous.test(words)) return;
    if (keepSection.test(words)) continue;
    if (
      currentChange ||
      !preciseChange.test(words) ||
      conditionalAction.test(words) ||
      deferred.test(words)
    )
      return;
    currentChange = part;
  }
  const records = requestParts(earlier);
  const held =
    /^(?:chua chot|chua phe duyet|pending approval|not yet approved|(?:cho (?:toi|minh) (?:phe duyet|xac nhan(?: noi dung)?) (?:roi (?:moi|hay)|truoc khi)|wait for (?:my|our) approval before)\s+(?:cap nhat|sua|chinh|updating|editing|making the change))$/;
  const proposalPattern =
    /^(?:(?:(?:giữ lại|giu lai|ghi lại|ghi lai|record|save)\s+(?:the\s+)?)?(?:đề xuất|de xuat|proposal\s+to|propose\s+to)|(?:nếu được duyệt|neu duoc duyet|if approved)[, ]+(?:thì|thi|then))\s+(?<verb>ghi rõ|ghi ro|bổ sung|bo sung|đổi|doi|sửa|sua|chỉnh|chinh|cập nhật|cap nhat|change|edit|update|add|specify)\s+(?<evidence>.+)$/iu;
  const proposals = records
    .map((part) => proposalPattern.exec(part)?.groups)
    .filter((part) => part !== undefined);
  if (
    proposals.length !== 1 ||
    records.some(
      (part) =>
        !proposalPattern.test(part) &&
        !held.test(fold(part)) &&
        (!keepSection.test(withoutPaths(part)) ||
          scopes(part)?.length !== 0 ||
          dangerous.test(withoutPaths(part))),
    )
  )
    return;
  const [proposal] = proposals;
  const paths = scopes(earlier);
  if (paths?.length !== 1) return scopeQuestion(paths);
  if (scopes(route.evidence)?.some((file) => file !== paths[0])) return scopeQuestion(paths);
  const task = directTask(
    {
      ...route,
      verb: 'sua',
      evidence: `${proposal.verb} ${proposal.evidence}`,
      clause: proposal.evidence,
    },
    [],
    '',
    team,
  );
  return (
    task &&
    ('key' in task
      ? plan([
          {
            ...task,
            description: remainder.length
              ? redact(
                  [
                    task.description,
                    ...(currentChange ? ['Áp dụng đúng nội dung người yêu cầu vừa chốt.'] : []),
                    ...remainder,
                  ].join('. '),
                ).slice(0, 2000)
              : task.description,
          },
        ])
      : task)
  );
}

function revisionPreflight(
  route: Route,
  preceding: string[],
  following: string[],
  earlier: string,
  team: readonly Member[],
) {
  const words = withoutPaths(route.evidence);
  if (
    !(verifyVerb.test(route.verb) || /^(?:read|doc)$/.test(route.verb)) ||
    !gitEvidence.test(words) ||
    !following.length
  )
    return;
  if (following.length > 2) return;
  const conditionalWrite =
    /^(?:(?:chỉ|chi|only)\s+)(?<actor>.+?)\s+(?<verb>sửa|sua|chỉnh|chinh|fix|edit|update)\s+(?<work>.+)$/iu.exec(
      following[0],
    )?.groups;
  const guardedWrite =
    /^(?:chỉ|chi|only)\s+(?:khi|when|if)\s+(?<reviewer>.+?)\s+(?:xác nhận chưa có|xac nhan chua co|confirms? (?:it is |it['’]s )?(?:missing|absent))\s+(?:(?:thì mới để|thi moi de|thì mới nhờ|thi moi nho|then (?:ask|have))\s+)(?<actor>.+?)\s+(?:bổ sung|bo sung|sửa|sua|add|fix|edit)\s+(?<work>.+)$/iu.exec(
      following[0],
    )?.groups;
  // Keep tag and assignee provenance on the two sides of the condition.
  const taggedFinding =
    /^(?:(?:chỉ|chi) )?(?:nếu|neu|chỉ khi|chi khi) (?<finding>[^,;.!?]{1,155}?)(?:,\s*(?:(?:thì|thi) )?|\s+(?:thì|thi)\s+)(?:mới |moi )?(?<instruction>.+)$/iu.exec(
      following[0],
    )?.groups;
  const taggedAction =
    taggedFinding &&
    (/^(?:giao|nhờ|nho|cho) /iu.test(taggedFinding.instruction)
      ? routeAt(taggedFinding.instruction)
      : /^[\p{L}\p{M}\p{N}_ -]{1,120} (?:mới|moi) (?:bổ sung|bo sung|sửa|sua|chỉnh|chinh)\b/iu.test(
            taggedFinding.instruction,
          )
        ? routeAt(taggedFinding.instruction.replace(/ (?:mới|moi) /iu, ' '))
        : undefined);
  const taggedCriterion =
    taggedFinding &&
    (/^(?:kiểm chứng|kiem chung|kiểm tra|kiem tra|xác minh|xac minh) (?:ở|o|tại|tai) tag (?:này|nay|đó|do) (?:cho thấy|cho thay|xác nhận|xac nhan) (?<missing>[^,;.!?]{1,100}) (?:còn thiếu|con thieu|chưa có|chua co)$/iu.exec(
      taggedFinding.finding,
    )?.groups ??
      /^(?<checker>[^,;.!?]{1,80}?) (?:xác nhận|xac nhan|xác minh|xac minh) (?<missing>[^,;.!?]{1,100}?) (?:còn thiếu|con thieu|chưa có|chua co) (?:ở|o|tại|tai) tag (?:này|nay|đó|do)$/iu.exec(
        taggedFinding.finding,
      )?.groups);
  const sameTagWrite =
    taggedCriterion && taggedAction && writeVerb.test(taggedAction.verb)
      ? {
          actor: taggedAction.actor,
          work: taggedAction.evidence,
          missing: taggedCriterion.missing,
          checker: taggedCriterion.checker,
        }
      : undefined;
  const writeRequest = guardedWrite ?? conditionalWrite ?? sameTagWrite;
  if (!writeRequest) return;
  const work = withoutPaths(writeRequest.work);
  if (sameTagWrite) {
    const files = scopes(route.evidence);
    const revision =
      files?.length === 1 && requestedSharedVerificationRevision(route.evidence, files[0]);
    const finding = withoutPaths(sameTagWrite.missing);
    if (
      !revision ||
      revision.kind !== 'tag' ||
      !/^(?:vao |trong )?(?:chinh |dung )?(?:file|tep) (?:do|nay|ay)$/.test(work) ||
      /\b(?:co the|chua ro|chua chac|khong|chua du|khong du|chua ket luan|khong the)\b/.test(
        finding,
      ) ||
      following.some((part) => scopes(part)?.length !== 0)
    )
      return;
  }
  if (
    !sameTagWrite &&
    (guardedWrite
      ? !/^(?:phan do trong dung (?:file|tep) nay|phan do trong dung (?:file|tep) do|(?:the )?missing part in (?:this|that|the same) file)$/.test(
          work.trim(),
        )
      : !/^(?:phan con thieu neu can|phan con thieu neu chua xong|nhung gi con thieu neu can|what is (?:still )?missing if (?:needed|required)|only (?:the )?remaining (?:work|changes) if (?:needed|required))$/.test(
          work.trim(),
        ))
  )
    return;
  // Prefix may identify one already-open file, which is only evidence for the current read.
  if (
    preceding.length > 1 ||
    preceding.some(
      (part) =>
        !/\b(?:cung mo|dang mo|already (?:have|opened)|have (?:the )?(?:file|tab) open)\b/.test(
          withoutPaths(part),
        ),
    )
  )
    return;
  const referenced = preceding[0] ?? earlier;
  const members = grantsFor(route.actor, team);
  if (members.length !== 1) return grantQuestion(route.actor, members);
  const [member] = members;
  const assignee = writeRequest.actor;
  const allowed = grantsFor(assignee, team);
  if (allowed.length !== 1) return grantQuestion(assignee, allowed, true);
  if (guardedWrite) {
    const reviewer = grantsFor(guardedWrite.reviewer, team);
    if (reviewer.length !== 1 || reviewer[0].id !== member.id)
      return question(
        'Bạn muốn dùng bằng chứng kiểm tra Git của teammate nào trước khi thực hiện thay đổi?',
      );
  } else if (sameTagWrite?.checker && !matchesSingleGrant(sameTagWrite.checker, member, team)) {
    return question(
      'Bạn muốn dùng kết quả tại Git tag của teammate nào để quyết định có giao việc sửa không?',
    );
  } else if (!sameTagWrite && allowed[0].id !== member.id) {
    return question('Bạn muốn giao việc kiểm tra và sửa phần còn thiếu cho cùng teammate nào?');
  }
  const [writer] = allowed;
  if (!writer.allowWrites) return grantQuestion(assignee, allowed, true);
  if (
    following[1] &&
    !(sameTagWrite
      ? /^(?:neu )?(?:da co|co san|co roi|chua (?:ro|du (?:can cu|bang chung)|ket luan(?: duoc)?))(?: hoac (?:da co|co san|co roi|kiem (?:tra )?khong ra|chua (?:ro|du (?:can cu|bang chung)|ket luan(?: duoc)?)))(?: de (?:ket luan|xac nhan))?,? (?:thi )?(?:(?:khong|dung) (?:mo|bat dau|giao) (?:buoc|viec|tac vu) (?:sua|chinh)|chi bao (?:lai )?(?:ket qua|ket luan)(?: kiem tra)?|dung (?:lai )?o (?:buoc )?(?:kiem tra|xac minh)|dung sau khi bao (?:lai )?ket qua)$/u.test(
          withoutPaths(following[1]),
        )
      : /^(?:[\p{L}\p{N}_ -]{1,70} )?(?:(?:dung|khong|do not|don['’]t) (?:sua|chinh|edit|modify)(?: chung| at the same time)?|chua kiem thi khoan sua|do not edit until checked)(?: nha| nhe| please)?$/u.test(
          withoutPaths(following[1]),
        ))
  )
    return;
  const task = directTask(route, [], referenced, team);
  if (!task || !('key' in task)) return task;
  if (
    task.kind !== 'research' ||
    task.scope.length !== 1 ||
    task.fallbackMemberId ||
    task.requiredPlatform ||
    [preceding[0], following[1]]
      .filter(Boolean)
      .some(
        (clause) =>
          dangerous.test(withoutPaths(clause)) ||
          scopes(clause)?.some((path) => !task.scope.includes(path)),
      )
  )
    return;
  const preflight = {
    ...task,
    key: 'read-git-history',
    description: sameTagWrite
      ? `Chỉ đọc đúng Git tag được chỉ định và xác minh tiêu chí ${redact(sameTagWrite.missing)}. Báo rõ nếu tiêu chí đã có, còn thiếu hoặc chưa đủ bằng chứng. ${task.description}`
      : `Chỉ đọc lịch sử Git và xác minh trạng thái hiện tại. ${task.description}`,
  };
  const write = scopedTask(
    'finish-missing-work',
    'code',
    task.scope,
    writer,
    'Chỉ sửa phần còn thiếu nếu bằng chứng từ tác vụ kiểm tra đã hoàn thành xác nhận còn thiếu và checkout vẫn khớp. Nếu đã xong, kết quả không rõ hoặc checkout khác đi, giữ nguyên tệp và báo lại. ' +
      route.evidence +
      (guardedWrite || sameTagWrite ? `. Điều kiện từ người yêu cầu: ${following[0]}` : ''),
    { after: [preflight.key] },
  );
  return plan([preflight, { ...write, editIfMissingAfter: preflight.key }]);
}

function splitCurrent(request: string) {
  const parts = requestParts(request);
  const switchTo = parts.findIndex(
    (part, index) => index > 0 && /^(?:gio|bay gio|now|instead)\b/.test(fold(part)),
  );
  if (
    switchTo > 0 &&
    parts
      .slice(0, switchTo)
      .some((part) =>
        /\b(?:doi y|doi lai|thoi khoan|khoan|changed my mind|correction|scratch that)\b/.test(
          fold(part),
        ),
      )
  )
    return { active: parts.slice(switchTo), superseded: parts.slice(0, switchTo).join('. ') };
  return { active: parts, superseded: '' };
}

const runOnlyAssignment = new RegExp(
  `^(?<actor>${actorPart})\\s+(?:(?:to|can|should|will)\\s+)?(?:(?:giữ|giu) (?:đúng|dung|nguyên|nguyen) (?:account|tài khoản|tai khoan)(?: (?:đang dùng|dang dung|hiện tại|hien tai))? (?:và|va) )?(?:chỉ |chi |only )?(?:chạy|chay|run)\\s+(?:(?:just|exactly|đúng|dung|riêng|rieng|the|test|kiểm thử|kiem thu)\\s+)*(?<target>\\S+)(?<place>[^,;.!?]*(?:,[^;.!?]+)?)$`,
  'iu',
);

const runOnlyRestriction =
  /^(?:(?:test|tools?)[ -]only|(?:tools[ -]only|chi dung (?:tool|cong cu))(?: de)? (?:chay|run) (?:bai |the )?(?:kiem thu|test)(?: thoi| only)?|(?:chi|only|just) (?:chay|run) (?:dung |only |the |bai )?(?:test|kiem thu)(?: nay| do| thoi| only)?|(?:chay|run) (?:dung |the )?(?:bai )?(?:test|kiem thu)(?: nay| do)? (?:thoi|only)|(?:dung|khong|do not|don t|no) (?:sua|chinh|viet|edit|write|modify|edits|writes)(?: [\p{L}\p{N}_ -]{1,42}?)?)(?:[, ]+(?:(?:va |and )?(?:dung |khong |do not |don t )|(?:hay |or )(?=(?:chay bai khac|run (?:any )?other tests?)$))(?:sua|chinh|doi tai khoan|chay bai khac|edit|modify|switch accounts|run (?:any )?other tests?)(?: [\p{L}\p{N}_ -]{1,42})?)?$/u;
const noSourceEdits =
  /^(?:dung|khong|do not|don t) (?:sua|chinh|edit|modify) (?:test|bai test|file|code|tep)(?: hay| or) (?:dung(?: den)? ma nguon|file du an|(?:touch|change) (?:the )?(?:source|code))$/;
function leavesTestSources(text: string) {
  return (
    noSourceEdits.test(text) ||
    /^(?:(?:file|tep) (?:test|kiem thu) (?:lan|va) (?:ma (?:nguon|du an)|code) (?:cu )?(?:de nguyen|giu nguyen)|giu nguyen (?:ca )?(?:file|tep)(?: (?:test|kiem thu))? (?:lan|va) (?:ma (?:nguon|du an)|app|code)|(?:leave|keep) (?:both )?(?:the )?test (?:and|or) (?:the )?(?:source|project code)(?: files?)? (?:as (?:is|they are)|unchanged))$/.test(
      text,
    )
  );
}
const reportTestResult =
  /^(?:(?:(?:chi )?bao(?: lai)? (?:ket qua|trang thai|thu tu|khi|neu|co)|(?:chay|test) xong bao(?: lai)?|(?:only|just) report (?:the )?(?:test )?(?:results?|order))\b[^,;.!?]{0,95}|(?:chi )?bao(?: lai)? [^,;.!?]{1,60} co [^,;.!?]{1,60} (?:khong|chua))$/u;
const reportScreenReader =
  /^(?:chi )?bao(?: lai)? (?:trinh doc man hinh doc (?:gi|cau nao)|thu tu (?:doc|tab|focus)) (?:sau )?khi (?:doi|chuyen|bat|tat|mo|dong|chon) [^,;.!?]{1,60}$/u;

const namedTestRunner = new RegExp(
  `^(?:giữ|giu|keep|use)\\s+(?:(?:nguyên|nguyen|đúng|dung|exactly)\\s+)?(?<actor>${actorPart})\\s+(?:làm người chạy|lam nguoi chay|(?:để|de) làm việc này|de lam viec nay|cho (?:việc|viec|lượt|luot) (?:này|nay)|as (?:the|its) (?:tester|runner)|for this (?:run|test))(?: nhé| nhe| nha| please)?$`,
  'iu',
);
const assignedTestRunner = new RegExp(
  `^(?:(?:người chạy|nguoi chay) (?:(?:vẫn|van) )?(?:là|la)|the (?:runner|tester) (?:still )?is)\\s+(?<actor>${actorPart})(?: nhé| nhe| nha| please)?$`,
  'iu',
);
const detachedTest =
  /^(?<place>(?:trên|tren|on|using|dùng|dung|use)\s+[^,;.!?]{1,90}?)\s+(?:(?:dùng|dung|use) (?:chỉ |chi |only )?(?:tools?|công cụ|cong cu) (?:để |de |to )?)?(?:chạy|chay|run)\s+(?:(?:dung|đúng|just|only|exactly|riêng|rieng|the|một bài|mot bai|bài|bai|test)\s+)*(?<target>[^,\s]+)(?:\s+(?:riêng|rieng|thôi|thoi|only))?(?:(?:,\s*|\s+(?:và|va|and)\s+)(?<limits>[^.;!?]+)|\s+(?:xem|coi) (?<question>[^.;!?]+))?$/iu;
const testOnThatDevice = new RegExp(
  `^(?<actor>${actorPart})\\s+(?:to\\s+)?(?:(?:giữ|giu) (?:đúng|dung|nguyên|nguyen) (?:việc|viec|lượt|luot) (?:này|nay|đó|do) (?:và|va) )?(?<run>(?:dùng|dung|use) (?:đúng |dung |exactly )?(?:(?:máy|may|Mac|thiết bị|thiet bi) (?:đó|do|này|nay)|(?:this|that) (?:Mac|machine|device))\\s+.+)$`,
  'iu',
);

function testWithSelectedRunner(actor: string, match: Record<string, string>) {
  if (match.question && !scopedReadQuestion.test(withoutPaths(match.question))) return;
  const place = match.place.replace(
    /^(?:dùng|dung|use)\s+(?:(?:đúng|dung|exactly)\s+)?/iu,
    'trên ',
  );
  return [
    `${actor} chạy ${match.target} ${place}`,
    ...(match.limits?.split(/,\s*/u) ?? []),
    ...(match.question ? [`Báo ${match.question}`] : []),
  ];
}

function attachTestRunner(parts: string[]) {
  parts = parts.flatMap((part) => {
    const combined = /^(?<role>[^,;]+),\s*(?<run>(?:chạy|chay|run)\b.+)$/iu.exec(
      stripOpening(part),
    )?.groups;
    const actor =
      combined &&
      (namedTestRunner.exec(combined.role)?.groups?.actor ??
        assignedTestRunner.exec(combined.role)?.groups?.actor);
    return actor && combined ? [`${actor} ${combined.run}`] : [part];
  });
  const roleMentions = parts.map((part) => {
    const clause = stripOpening(part);
    return (
      namedTestRunner.exec(clause)?.groups?.actor ?? assignedTestRunner.exec(clause)?.groups?.actor
    );
  });
  const actorIndex = roleMentions.findIndex(Boolean);
  if (actorIndex === -1)
    return parts.flatMap((part) => {
      const instruction = testOnThatDevice.exec(stripOpening(part))?.groups;
      const run = instruction && detachedTest.exec(instruction.run)?.groups;
      return (instruction && run && testWithSelectedRunner(instruction.actor, run)) || [part];
    });
  const actor = roleMentions[actorIndex];
  const run = parts[actorIndex + 1] && detachedTest.exec(parts[actorIndex + 1])?.groups;
  const attached = actor && run && testWithSelectedRunner(actor, run);
  if (!attached) return parts;
  return [...parts.slice(0, actorIndex), ...attached, ...parts.slice(actorIndex + 2)];
}

function pairedTestOnly(
  parts: string[],
  team: readonly Member[],
): SharedSadeCloudResult | undefined {
  const request = parts.join('. ');
  const files = scopes(request);
  if (files?.length !== 1 || quote.test(request)) return;
  const clauses = attachTestRunner(parts);
  const [file] = files;
  const parsed = clauses.flatMap((part, index) => {
    const matched = runOnlyAssignment.exec(stripOpening(part))?.groups;
    return matched?.target.replace(/^\x60|\x60$/gu, '') === file ? [{ matched, index }] : [];
  });
  if (parsed.length !== 1) return;
  const [{ matched, index }] = parsed;
  const before = clauses.slice(0, index);
  const after = clauses.slice(index + 1);
  const restrictions = after.flatMap((part) =>
    withoutPaths(part).split(/,\s*(?=(?:khong|dung|giu nguyen|no |do not|don t)\b)/u),
  );
  const place = withoutPaths(matched.place).trim();
  const preservesEveryFile =
    /^(?:chi chay|run only) (?:va|and) (?:giu nguyen (?:toan bo|tat ca) (?:file|tep)|leave (?:all )?(?:the )?files unchanged)$/u;
  if (
    !restrictions.length ||
    !restrictions.some(
      (text) =>
        runOnlyRestriction.test(text) || leavesTestSources(text) || preservesEveryFile.test(text),
    ) ||
    !restrictions.every(
      (text) =>
        runOnlyRestriction.test(text) ||
        leavesTestSources(text) ||
        preservesEveryFile.test(text) ||
        reportTestResult.test(text) ||
        (reportScreenReader.test(text) && !conditionalAction.test(text)) ||
        /^(?:chi chay (?:bang|qua) (?:tools?|cong cu)|(?:only|just) run with (?:the )?tools?)$/.test(
          text,
        ) ||
        /^(?:chi chay va bao (?:lai )?ket qua|(?:only|just) run and report (?:the )?(?:test )?results?)\b[^,;.!?]{0,65}$/u.test(
          text,
        ),
    ) ||
    restrictions.some(
      (text) =>
        dangerous.test(text) ||
        deferred.test(reportScreenReader.test(text) ? text.replace(' sau khi ', ' khi ') : text) ||
        (reportTestResult.test(text) && conditionalAction.test(text)),
    ) ||
    before.some((part) => {
      const text = withoutPaths(part);
      return (
        !/^[\p{L}\p{M}\p{N}_' -]{1,60} (?:(?:da |vua )?dong y cho (?:muon|dung)|(?:da |vua )?(?:dong y )?(?:chia|cap(?: cho nhom)?) quyen (?:chay|kiem thu)|(?:(?:da |vua )?cho|nhan cho) (?:nhom )?(?:muon|dung)|vua confirm|has (?:agreed|approved)|agreed to lend|gave consent)\b[^,;.!?]{1,110}$/u.test(
          text,
        ) ||
        dangerous.test(text) ||
        deferred.test(text) ||
        /\b(?:and|va|or|hay|then|roi) (?:now |hay |please )?(?:read|doc|xem|run|chay|sua|edit|write|viet|assign|giao)\b/.test(
          text,
        )
      );
    }) ||
    !/^(?:tren |on |qua |using |via )[^,;.!?]{1,120}$/u.test(place) ||
    dangerous.test(place) ||
    deferred.test(place) ||
    conditionalAction.test(place) ||
    /\b(?:va|and|hay|or|sua|edit|modify|chay|run)\b/.test(place)
  )
    return;

  const candidates = grantsFor(matched.actor, team);
  if (candidates.length !== 1) return grantQuestion(matched.actor, candidates);
  const [member] = candidates;
  const context = withoutPaths(request);
  const environments = platformFor(context);
  const platform = (['darwin', 'linux', 'win32'] as const).find(
    (target) => target === member.pairedPlatform,
  );
  const machine = member.pairedMachineName;
  const label = machine && fold(machine);
  const owner = label && /^mac cua (.+)$/.exec(label)?.[1];
  const deviceLabels = label ? [label, ...(owner ? [`${owner}'s mac`, `${owner}’s mac`] : [])] : [];
  const target = place
    .replace(/^(?:tren|on|qua|using|via) (?:(?:dung|exactly) )?(?:the )?/, '')
    .replace(/ (?:nhe|nha|please|giup(?: minh)?)$/, '');
  const namedEarlier = before.some((part) => {
    const description = withoutPaths(part).replace(
      /(?: (?:roi|already|nha|nhe|please)(?: nha| nhe)?| (?:de|to) (?:(?:chay|run) )?(?:(?:dung|exactly|just) )?(?:(?:mot|one|a) )?(?:bai )?(?:thu|test|kiem thu)(?: nay| do| this)?)$/,
      '',
    );
    return deviceLabels.some((name) => description.endsWith(` ${name}`));
  });
  const exactDevice =
    deviceLabels.includes(target) ||
    deviceLabels.includes(target.replace(/^may /, '')) ||
    (Boolean(owner) && namedEarlier && target === `may cua ${owner}`);
  if (
    !platform ||
    !machine ||
    environments.some((environment) => environment !== platform) ||
    (!exactDevice &&
      (!/^(?:(?:may|mac|thiet bi) (?:do|nay)|(?:that|this) (?:mac|machine|device))$/.test(target) ||
        !namedEarlier))
  )
    return question(
      `${redact(matched.actor)} cần quyền chạy đúng kiểm thử trên máy đã ghép cặp mà bạn chỉ định. Bạn muốn cấp quyền cho thiết bị nào?`,
    );

  const task = scopedTask(
    'run-test-only',
    'code',
    files,
    member,
    `Chỉ chạy kiểm thử đã được chủ máy cho phép trên đúng thiết bị. Không sửa tệp, không chạy bài kiểm thử khác. ${redact(request)}`,
    { platform, machine },
  );
  return plan([{ ...task, testOnly: true }]);
}

const literalScopeLimit =
  /^(?:(?:in )?(?:that|this|the) (?:label|line|text|wording|copy|message) (?:alone|only)|(?:the )?(?:logic|implementation|rest of the file)(?: and (?:the )?rest of the file)? should (?:stay|remain) (?:as (?:it is|they are)|unchanged)|cai do thoi|chi doi (?:chu|nhan) do|chi vay thoi|chi thay doi nay|just (?:that|this)(?: change)?|only (?:that|this)(?: change)?|(?:that|this) (?:one )?(?:label|change) is all (?:i|we) need(?: right now)?|that['’]s (?:the whole change|all)|(?:leave|keep) (?:the )?(?:layout|logic|implementation|rest of the file) (?:alone|as is|unchanged)|(?:keep|limit) (?:the|this) (?:edit|change) to (?:the|that|this) (?:label|line|wording|copy|message|notice)(?: in (?:this|that|the same) file)?)$/;
const literalEditPreface =
  /^(?:(?:for|regarding|about) [^,;.!?]{1,65}, )?(?:(?:i|we) (?:have|need|want)|(?:toi|minh) (?:can|muon)) (?:one |a |mot )?(?:small |single |nho )?(?:approved )?(?:(?:copy|text|label|wording) (?:change|edit|fix)|(?:doi|chinh) (?:nhan|chu|cau))(?: (?:for|in) [^,;.!?]{1,65})?(?: thoi)?$/;
const preserveUneditedCopy =
  /^(?:keep|leave) (?:(?:every|each|all|the) )?other (?:line|label|text|message|copy|wording|string)s?(?: in (?:that|this|the) (?:file|card|component|screen|page))? (?:untouched|unchanged|intact|alone|as (?:it is|they are|written))$/;

function literalReplacement(parts: readonly string[], team: readonly Member[]) {
  const copies =
    /(?:^|,\s*|\s+)(?:đổi|doi|thay|replace|change|rename|swap|(?<from>from|từ|tu))\s+(?:(?:the\s+)?(?:chữ|chu|nhãn|nhan|text|label|copy)\s+)?["“]([^"”\r\n]{1,120})["”]\s+(?:thành|thanh|sang|to|with|for)\s+["“]([^"”\r\n]{1,120})["”](?:\s+(?:in|trong)\s+(?<scope>.+?))?(?:\s+(?:nhé|nhe|nha|please))?$/iu;
  const changes = parts
    .map((part, index) => ({ index, change: copies.exec(part) }))
    .filter(({ change }) => change !== null);
  if (changes.length !== 1) return;
  const { index, change } = changes[0];
  if (!change || index > 1 || change[2] === change[3] || (change.groups?.from && index !== 0))
    return;
  const prefix = parts[index].slice(0, change.index).trim();
  const [suffixScope = '', ...suffixLimits] = change.groups?.scope?.trim().split(/,\s*/u) ?? [];
  if (suffixScope && !/^(?:(?:the )?(?:file|tệp|tep) )?\x60?[^\s\x60]+\x60?$/iu.test(suffixScope))
    return;
  const direct = suffixScope ? routeAt(parts[index]) : undefined;
  const opening = (index ? parts[0] : prefix).replace(
    /,\s*((?:on|under)\s+[^,;.!?]{1,60}['’]s\s+account),/iu,
    ' $1',
  );
  const edit = copyEdit.exec(stripOpening(opening).replace(/^give\s+/iu, ''))?.groups;
  const assignee = !direct
    ? (
        copyEditAssignee.exec(opening.replace(/^(?:please|could you|can you)\s+/iu, '')) ??
        copyEditAssignee.exec(stripOpening(opening))
      )?.groups
    : undefined;
  const route =
    (edit && {
      actor: edit.actor,
      verb: fold(edit.verb),
      evidence: edit.evidence,
      clause: opening,
    }) ??
    direct ??
    (assignee && {
      actor: assignee.actor,
      verb: fold(assignee.verb),
      evidence: assignee.evidence || prefix,
      clause: opening,
    }) ??
    routeAt(opening);
  if (!route || !writeVerb.test(route.verb)) return;
  const currentPrecedence = direct ? prefix : route.evidence;
  const routeText = withoutPaths(currentPrecedence);
  const source = scopes([currentPrecedence, prefix, suffixScope].join(' '));
  if (
    source?.length !== 1 ||
    (suffixScope &&
      suffixScope.replace(/^(?:the )?(?:file|tệp|tep) /iu, '').replace(/^\x60|\x60$/gu, '') !==
        source[0]) ||
    dangerous.test(routeText) ||
    deferred.test(routeText) ||
    sharedSadeWriteIsWaiting(currentPrecedence) ||
    noWrite.test(routeText) ||
    (direct &&
      parts.slice(0, index).some((part) => {
        const words = withoutPaths(part);
        return (
          !literalEditPreface.test(words) ||
          scopes(part)?.length !== 0 ||
          dangerous.test(words) ||
          deferred.test(words) ||
          sharedSadeWriteIsWaiting(part)
        );
      })) ||
    (!direct &&
      index &&
      !((edit || assignee?.evidence) && !prefix) &&
      !/^(?:(?:trong|in|at|file|tep)\s+)+$/.test(
        withoutPaths(prefix).replaceAll('\x60', '').trim() + ' ',
      )) ||
    [...suffixLimits, ...parts.slice(index + 1)].some((part) => {
      const text = fold(part);
      return (
        !literalScopeLimit.test(text) &&
        !preserveUneditedCopy.test(text) &&
        !/^(?:only (?:that|this) (?:text|wording|label|message|sentence) should change|(?:i|we) only want (?:that|this|the) (?:text|wording|label|sentence|line|message) changed|(?:keep|leave) (?:the rest of the(?: (?:screen|page|component) and)? (?:the )?file|everything else(?: in (?:this|that|the) (?:card|panel|screen|component|file|page))?|(?:the )?other (?:text|messages|labels|lines|strings)(?: and (?:the )?(?:layout|structure|logic|implementation))?) (?:alone|unchanged|as (?:it is|they are|written)))$/.test(
          text,
        )
      );
    })
  )
    return;
  const candidates = grantsFor(route.actor, team);
  if (candidates.length !== 1 || !candidates[0].allowWrites)
    return grantQuestion(route.actor, candidates, true);
  return plan([
    scopedTask(
      'replace-literal',
      'code',
      source,
      candidates[0],
      'Thay đúng chuỗi văn bản literal bên dưới trong tệp đã giao và giữ nguyên nội dung khác. ' +
        JSON.stringify({ oldText: change[2], newText: change[3] }),
    ),
  ]);
}

const needsStructuredConditions =
  /\b(?:quota|het luot|du phong|fallback|backup assignee|reassign|doi nguoi|commit|revision|sha|git|review|reviewer|ra soat|kiem duyet|doc lap|independent|macos|windows|linux|ubuntu|darwin|mac(?:book)? cua|paired|ghep cap|approval|permission|consent|grant|xac nhan|cho duyet|phe duyet|cap quyen|thu hoi|wait|hold off|postpone|instead|unless|only if|chi khi|tru khi|after the|before the|sau khi|truoc khi|song song|parallel)\b/;
const sourceWriteDirective =
  /\b(?:please|hay|xin|nho|giao|ask|have|assign) (?:[\p{L}\p{M}\p{N}_' -]{1,80} )?(?:sua|chinh|viet|them|doi|tao|xoa|cap nhat|edit|write|fix|create|delete|change|update|add|run|chay)\b/u;
const stopCurrentWork =
  /\b(?:chua can (?:lam|giao|mo|bat dau)|khong can (?:giao|phan cong)|dung (?:giao|phan cong|bat dau)|do not (?:assign|schedule|start)|no (?:new|current|active) (?:work|assignment)|nothing to dispatch|for (?:your )?information only|context only|status only|fyi)\b/;

/** A limited menu for one independently grounded action when the rest of the chat supplies context. */
export function sharedSadeSingleOperation(delivery: SharedDelivery) {
  const { request, team } = delivery;
  if (
    delivery.phase !== 'plan' ||
    delivery.clarification ||
    delivery.readAssignment ||
    delivery.handoffAssignments ||
    delivery.handoffDeliverables ||
    request.length > 1_200 ||
    quote.test(request) ||
    /\x60{3}|https?:\/\//i.test(request)
  )
    return;

  const files = scopes(request);
  if (files?.length !== 1) return;
  const parts = requestParts(request.normalize('NFC'));
  const words = withoutPaths(request);
  if (stopCurrentWork.test(words) || needsStructuredConditions.test(words) || dangerous.test(words))
    return;

  const anchors = parts.flatMap((part) => {
    const route = routeAt(part);
    if (!route) return [];
    const candidates = grantsFor(route.actor, team);
    return candidates.length === 1 ? [{ route, member: candidates[0] }] : [];
  });
  if (anchors.length !== 1) return;
  const [{ route, member }] = anchors;
  if (scopes(route.evidence)?.[0] !== files[0] || !route.evidence) return;

  const code = writeVerb.test(route.verb);
  const ordinaryRead = /^(?:doc|xem|coi|tom tat|read|inspect|summari[sz]e)$/.test(route.verb);
  if (!code && !ordinaryRead && !verifyVerb.test(route.verb)) return;
  if (/^(?:test|chay|kiem thu|run)\b/.test(route.verb)) return;
  if (
    /\b(?:chay|run|rerun|execute) (?:it|them|dung|thu|test|checks?|commands?|scripts?|the)\b/.test(
      words,
    )
  )
    return;
  if (
    code &&
    (!member.allowWrites ||
      noWrite.test(words) ||
      deferred.test(words) ||
      sharedSadeWriteIsWaiting(request) ||
      parts.some((part) => part !== route.clause && protectedEnding(withoutPaths(part))))
  )
    return;
  if (!code && (sourceWriteDirective.test(words) || conditionalAction.test(words))) return;
  if (parts.some((part) => part !== route.clause && sourceWriteDirective.test(withoutPaths(part))))
    return;

  const kind = code ? 'code' : 'research';
  const action = code ? 'Edit only this exact file' : 'Read this exact file and report only';
  const name = 'single_scoped_operation';
  const option = `${action} (${files[0]}) using ${redact(member.name)} of ${redact(member.owner)}. No additional task, substitute, required device or checkpoint.`;
  const questions: SharedSadeChoiceQuestion[] = [
    {
      name,
      instructions:
        'Confirm only if this is the complete action the sender assigns in the current message, with precisely the shown permission, account and scope. Use no_match for additional actions, omitted conditions, different actors or files, a reported past change, or work that the sender is deferring. Explanatory context and requested read results can be part of the same action.',
      choices: [
        { value: 'matches_scoped_action', description: option },
        {
          value: 'no_match',
          description: 'The candidate does not cover the exact active assignment.',
        },
      ],
    },
  ];
  return {
    questions,
    option,
    compile: (selections: Record<string, string>) =>
      selections[name] === 'matches_scoped_action'
        ? plan([scopedTask('scoped-operation', kind, files, member, request)])
        : undefined,
  };
}

export function sharedSadeGroundedRoute(
  delivery: SharedDelivery,
): SharedSadeCloudResult | undefined {
  if (
    delivery.phase !== 'plan' ||
    delivery.readAssignment ||
    delivery.handoffAssignments ||
    delivery.clarification
  )
    return;
  const parts = requestParts(delivery.request.normalize('NFC'));
  const testOnly = pairedTestOnly(parts, delivery.team);
  if (testOnly) return testOnly;
  if (quote.test(delivery.request)) {
    const first = parts[0]?.match(/"[^"\r\n]{1,120}"|“[^”\r\n]{1,120}”/gu);
    if (
      first?.length === 1 &&
      approvedLiteral.test(fold(parts[0])) &&
      parts.slice(1).every((part) => !quote.test(part))
    ) {
      const approved = approvedReference(
        parts,
        delivery.referencedMessage?.content.normalize('NFC') ?? '',
        delivery.team,
      );
      if (approved) return approved;
    }
    return literalReplacement(parts, delivery.team);
  }
  const { active, superseded } = splitCurrent(delivery.request.normalize('NFC'));
  const earlier = delivery.referencedMessage?.content.normalize('NFC') ?? '';
  const { team } = delivery;
  if (active.some((part) => !quotaCondition(withoutPaths(part)) && noWork.test(withoutPaths(part))))
    return;
  const approved = approvedReference(active, earlier, team);
  if (approved) return approved;
  const review = independentReview(active, earlier, team);
  if (review) return review;
  const ordinal = active.length && ordinalRoute(active, earlier, team);
  if (ordinal) return ordinal;

  const routes = active
    .map(routeAt)
    .filter((route): route is Route => Boolean(route))
    .filter(({ actor, clause }) => {
      if (
        followUp.test(clause) ||
        /\b(?:lay|sau khi|after|khi|if|neu|roi|then|cung|da|bao|biet|tim|cap quyen)\b/.test(
          fold(actor),
        )
      )
        return false;
      const { label, owner } = actorParts(actor);
      return (
        team.some(({ name }) => nameEquals(label, name)) ||
        Object.hasOwn(providerAliases, fold(label)) ||
        (Boolean(owner) &&
          /^\p{L}+[\p{L}\p{M}\p{N}_-]*(?: [\p{L}\p{M}\p{N}_-]+){0,3}$/u.test(label) &&
          /\b(?:nho|giao|cho|ask|have|assign|using|with)\b/.test(withoutPaths(clause)))
      );
    });
  const primary = routes.filter(({ clause }) => !/^(?:chi|only)\s+/.test(fold(clause)));
  if (primary.length === 1) {
    const [route] = primary;
    const index = active.indexOf(route.clause);
    const preflight = revisionPreflight(
      route,
      active.slice(0, index),
      active.slice(index + 1),
      earlier,
      team,
    );
    if (preflight) return preflight;
  }
  if (routes.length > 1) return parallelRoutes(routes, active, team);
  if (!routes.length) return;
  const [route] = routes;
  const start = active.indexOf(route.clause);
  if (
    active
      .slice(0, start)
      .some(
        (part) =>
          !status.test(withoutPaths(part)) &&
          !(
            scopes(part)?.length === 0 &&
            /^(?:[^,;.!?]{2,72}) (?:vua|da) (?:ban giao|nop|hoan tat) [^,;.!?]{1,65}$/u.test(
              withoutPaths(part),
            )
          ),
      )
  )
    return;
  const task = directTask(route, active.slice(start + 1), superseded || earlier, team);
  return task && ('key' in task ? plan([task]) : task);
}

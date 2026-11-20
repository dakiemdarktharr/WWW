import type { SharedSadeChoiceQuestion } from '../shared/sade-cloud.ts';
import type { PlanTask } from '../shared/types.ts';
import { isPrivateCredentialPath } from './checkpoint.ts';
import type { SharedDelivery } from './group-sade.ts';
import { normalizeScope, redact } from './security.ts';
import type { SharedSadeCloudResult } from './shared-sade-cloud-planner.ts';
import { foldSharedSadeName } from './shared-sade-assignment.ts';
import { parseTeamPlan } from './workflow-plan.ts';

type Member = SharedDelivery['team'][number];
type Span<T> = { start: number; end: number; value: T };
type Actor = Span<ReadonlySet<Member>>;
type EvidenceText = {
  visible: string;
  prose: string;
  paths: Span<string>[];
  digests: Span<string>[];
  inlineDigests: Span<string>[];
  scopeLabels: string[];
  brief: string;
};
type AuthorityInventory = {
  current: EvidenceText;
  reference?: EvidenceText;
  words: string;
  actors?: Actor[];
  currentScope: string[];
  replyScope: string[];
};
type Route = {
  kind: 'read' | 'commit' | 'review';
  scope: string[];
  actors: Member[];
  revision?: string;
  waitForSameAccount?: boolean;
};

const questionName = 'evidence_route';
const noMatch = 'no_match';
const pathToken =
  /(?<![\p{L}\p{M}\p{N}_.:@/\\-])(?:[\p{L}\p{M}\p{N}_.-]+\/)*[\p{L}\p{M}\p{N}_.-]*\.[\p{L}\p{M}\p{N}_-]+(?![\p{L}\p{M}\p{N}_/\\-])/gu;
const absolutePath = /(?:^|[\s`"'(])(?:[a-z]:[/\\]|[/\\]{1,2})(?=[\p{L}\p{N}_.-])/iu;
const revisionToken =
  /\b(?:commit|revision|sha(?:-1)?|patch|diff|ban va|pushed|da day|da commit)\s*(?:(?:is|la)\s+)?\s*:?\s*\x60?([a-f0-9]{7,40})\x60?(?![a-z0-9])/gi;
const revisionWithLabel =
  /\b([a-f0-9]{7,40})\x60?\s+(?:is|la)\s+(?:(?:the|that|a|correct|exact)\s+)*(?:commit|revision|sha(?:-1)?|patch|diff|ban va)\b/gi;
const bareRevision = /\b(?=[a-f0-9]{7,40}\b)(?=[a-f0-9]*[a-f])(?=[a-f0-9]*\d)[a-f0-9]{7,40}\b/gi;
const read =
  /\b(?:doc|xem|coi|nhin|ngo|goi y|kiem tra|kiem chung|kiem\b|xac minh|doi chieu|tra cuu|tom tat|giai thich|read|look (?:at|up)|check|inspect(?:ion)?|verify|audit|review|compare|summari[sz]e|explain)\b/;
const asksForWork =
  /\b(?:nho|xin|vui long|giup|cho (?:minh|toi) biet|hay|cho (?:nay|do)|please|could (?:you|we)|would (?:you|we)|can (?:you|we)|tell me|i (?:need|want) to (?:know|understand)|what|which|whether|why|how many|how much|bao nhieu|cai nao|the nao|vi sao|tai sao|la gi)\b/;
const git = /\b(?:git|commit|revision|sha(?:-1)?|tag)\b/;
const patchReview = /\b(?:review(?:s|ed|ing|er|ers)?|audit(?:s)?|ra soat|soat xet|tham dinh)\b/;
const independentLook = /\b(?:take (?:an? )?independent look|kiem tra doc lap)\b/u;
const independence =
  /\b(?:doc lap|khac chu|chu tai khoan khac (?:voi )?(?:nguoi (?:viet|sua)|tac gia|nguoi trien khai)|independent(?:ly)?|independence|different (?:human |account )?owners?|owned by (?:(?:a different|another) (?:human|person)|someone else)|(?:another|a different|different) (?:person|human) s account|separate (?:read[ -]only )?reviews|reviewers? (?:work|report) separately|(?:review|audit)(?: [\p{L}\p{N}_-]+){0,10} +separately)\b/u;
const replyRelation = /(?:(?:minh|toi|tui) )?(?:(?:dang|vua|da) )?(?:tra loi|reply)/;
const replyMessage = new RegExp(
  `tin(?: nhan)? (?:(?:(?:ngay|phia|o) )?(?:tren|truoc|nay|do|cu)|duoc (?:tham chieu|tra loi)|${replyRelation.source})`,
);
const precedingSource =
  /(?:previous|preceding|referenced|earlier|above|attached) (?:message|note|reply|file|patch|attachment|post)/;
const reply = new RegExp(
  `\\b(?:${replyMessage.source}|${precedingSource.source}|(?:file|tep|duong dan|commit|ban va) ${replyRelation.source}|${/(?:file|tep|duong dan|commit|ban va)(?: do| ay| tren| vua neu)|o tren|(?:that|the (?:referenced|mentioned)) (?:file|path|patch|commit|diff)|(?:message|note|post) (?:i (?:am |m )?)?(?:repl(?:y|ying|ied)|respond(?:ing|ed)?) to|(?:files?|patch|commit|diff|note|entry|item|change) (?:(?:from|listed|named|mentioned) )?(?:above|in the reply)/.source})\\b`,
);
const explicitReply = new RegExp(
  `\\b(?:${replyMessage.source}|${precedingSource.source}|(?:file|tep|duong dan|commit|ban va) ${replyRelation.source}|(?:files?|patch|commit|diff|note)(?: (?:from|listed|named|mentioned))? (?:above|in the reply)|(?:message|note|post) (?:i (?:am |m )?)?(?:repl(?:y|ying|ied)|respond(?:ing|ed)?) to|(?:trong|tu) tin)\\b`,
);
const mutation =
  /\b(?:sua|chinh|viet|xoa|them|ghi|chay|tao|cap nhat|bo sung|rut gon|tinh gian|bien tap|thay (?:the|doi)|va (?:lai|loi)|gop|hop nhanh|dua len|day len|tai len|xuat ban|trien khai|gui (?:email|mail|ra ngoai)|edit|write|change|delete|remove|add|run|execute|create|update|fix|modify|replace|shorten|rewrite|rephrase|revise|push|deploy|publish|merge|upload|release)\b/;
const unresolved =
  /\b(?:quota|het luot|du phong|backup|fallback|thay nguoi|substitut\w*|revoked|thu hoi|cho xac nhan|wait for|hold off|wait until|when approved|once approved|de sau|(?:dung|khong|chua) (?:nho|giao|yeu cau)|(?:do not|don t|never) (?:ask|tell|assign|have|delegate)|no action|just sharing|fyi|for (?:your )?information only|chi bao tinh hinh|macos|windows|ubuntu|linux|macbook|may mac)\b|(?:^|[.,!?;])\s*(?:hay doi|(?:vui long|xin) (?:doi|cho (?:toi|den) khi))\b/;
const negativeWork =
  /\b(?:(?:dung|khoi|khong(?: can| duoc)?|chua can)(?: tu)?|do not|don t|without|neither (?:(?:reviewer|teammate|person) )?should) (?:sua|chinh|viet|ghi|xoa|tao|them|bo sung|gop|cap nhat|va (?:lai|loi)|commit|edit(?:ing)?|chang(?:e|ing)|modif(?:y|ying)|writ(?:e|ing)|add(?:ing)?|merge|push|deploy|publish)(?:(?:\s*,\s*|\s+(?:and|or|va|hay|hoac)\s+)(?:dung |khong |do not )?(?:sua|chinh|viet|ghi|xoa|tao|them|bo sung|gop|cap nhat|commit|edit|write|modify|add|merge|push|deploy|publish))*\b/g;
const negativeRead =
  /\b(?:khoi|dung|khong(?: can| duoc)?|do not|don t|without) (?:doc|xem|coi|mo|open|read|inspect|review|look at)\b/g;
const withdrawn =
  /^(?:(?:thoi|khoan|hold on),?\s+)?(?:(?:chuyen|phan|viec|de xuat) (?:sua|chinh|viet|day len|cap nhat) (?:trong )?tin (?:truoc|tren|cu) (?:gac|cat|bo) lai|(?:gac|cat|bo) (?:lai )?(?:chuyen|phan|viec|de xuat) (?:sua|chinh|viet|day len|cap nhat) (?:trong )?tin (?:truoc|tren|cu)|(?:khoan|tam dung|thoi) (?:sua|chinh|viet|day len|cap nhat) (?:theo|trong) tin (?:truoc|tren|cu)|(?:withdraw|cancel|park|ignore) (?:the )?(?:earlier|previous) (?:edit|change|push|proposal))(?: nha| nhe| for now)?$/;
const withdrawnReplyChange = new RegExp(
  `^(?:thoi[, ]+)?(?:khoan|tam dung|thoi|khong can) (?:sua|chinh|viet|day len|cap nhat) (?:nhu|theo|trong) ${replyMessage.source}(?: nha| nhe)?$`,
);
const numberedPaths =
  /\b(?:(hai|ba|two|three|2|3) (?:(?:of )?(?:the|its|these) )?|(?:ca hai|both) (?:(?:of )?(?:the|its|these) )?)(?:(?:listed|named|cited|affected|referenced) )?(?:file(?:s)?|tep|duong dan|paths?)\b/;
const activeEdition =
  /\b(?:(?:dang|hien) (?:(?:duoc |su )?dung|ap dung)|(?:currently|now) (?:in use|used|active|applied)|(?:active|current|live) (?:edition|version|copy)|in active use)\b/;
const retiredEdition =
  /\b(?:da bo|da thu hoi|da ngung (?:su )?dung|ngung su dung|no longer (?:used|in use)|retired|archived|deprecated|superseded|withdrawn)\b/;
const aliases: Readonly<Record<string, readonly string[]>> = {
  codex: ['Codex', 'ChatGPT'],
  claude: ['Claude'],
  gemini: ['Gemini'],
  antigravity: ['Antigravity'],
};

const fold = (text: string) => foldSharedSadeName(text.normalize('NFC'));
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const redactLabel = (label: string) => redact(label).slice(0, 100);

function validScope(value: string) {
  try {
    return (
      value.length <= 300 &&
      normalizeScope(value) === value &&
      !isPrivateCredentialPath(value) &&
      redact(value) === value
    );
  } catch {
    return false;
  }
}

function paths(text: string): Span<string>[] | undefined {
  if (absolutePath.test(text)) return;
  const tokens = Array.from(text.matchAll(pathToken), (match) => ({
    value: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
  return tokens.every(({ value }) => validScope(value)) ? tokens : undefined;
}

function literalFile(value: string) {
  const segment = /^(?:[\p{L}\p{M}\p{N}_.@+-]+(?: [\p{L}\p{M}\p{N}_.@+-]+)*)$/u;
  const parts = value.split('/');
  const leaf = parts.at(-1) ?? '';
  // A quotation alone does not make an arbitrary phrase a filename. Dotted
  // leaves and conventional extensionless project filenames are bounded literals.
  return (
    !/^(?:please|ignore|forget|read|open|check|review|inspect|ask|assign|copy|send|deploy|delete|write|change|update|remove|edit|move|run|create|modify|doc|xem|mo|kiem tra|nho|giao|bo qua|cap nhat|chinh|sua|gop|dao)\s+/u.test(
      fold(value),
    ) &&
    parts.every((part) => segment.test(part)) &&
    !parts.slice(0, -1).some((part) => /\.[\p{L}\p{N}_-]+\s/u.test(part)) &&
    (/\.[\p{L}\p{N}_-]{1,18}$/u.test(leaf) ||
      /^(?:README|LICENSE|NOTICE|Makefile|Dockerfile|Containerfile|Gemfile|Rakefile|Procfile|Vagrantfile|Jenkinsfile)$/.test(
        leaf,
      )) &&
    validScope(value)
  );
}

function mask(text: string, spans: readonly Span<unknown>[]) {
  let position = 0;
  let masked = '';
  for (const { start, end } of spans) {
    masked += text.slice(position, start) + ' '.repeat(end - start);
    position = end;
  }
  return masked + text.slice(position);
}

function evidenceText(text: string): EvidenceText | undefined {
  const source = text.normalize('NFC');
  const quoted =
    /\x60{3}[\s\S]*?\x60{3}|\x60([^\x60\r\n]+)\x60|"([^"\r\n]+)"|“([^”\r\n]+)”|‘([^’\r\n]+)’|«([^»\r\n]+)»|(?<![\p{L}\p{N}])'([^'\r\n]+)'(?![\p{L}\p{N}])/gu;
  const quotations = [...source.matchAll(quoted)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    value: match.slice(1).find((part) => typeof part === 'string'),
    inline: typeof match[1] === 'string',
  }));
  const visible = mask(source, quotations);
  if (/["“”‘«»<>\x60]/u.test(visible)) return;
  const unquoted = paths(visible);
  if (!unquoted) return;
  const scope = [...unquoted];
  const digests: Span<string>[] = [];
  const inlineDigests: Span<string>[] = [];
  const scopeLabels: string[] = [];
  const retained = new Set<number>();
  for (const { start, end, value, inline } of quotations) {
    if (!value || redact(value) !== value) continue;
    const before = fold(visible.slice(0, start));
    if (literalFile(value)) {
      scope.push({ start: start + 1, end: end - 1, value });
      retained.add(start);
    } else if (
      /^[a-f0-9]{7,40}$/i.test(value) &&
      (/\b(?:commit|revision|sha(?:-1)?|patch|diff|ban va)\s*:?[ ]*$/u.test(
        fold(visible.slice(0, start)),
      ) ||
        /^\s*(?:is|la)\s+(?:(?:the|that|a|exact)\s+)?(?:commit|revision|sha|patch|diff)\b/u.test(
          fold(visible.slice(end)),
        ))
    ) {
      digests.push({ start, end, value: value.toLowerCase() });
      retained.add(start);
    } else if (
      inline &&
      /^(?=[a-f0-9]{7,40}$)(?=[a-f0-9]*[a-f])(?=[a-f0-9]*\d)[a-f0-9]+$/i.test(value)
    ) {
      // Inline code alone is not commit authority. Reference routing also
      // needs a matching file and revision cue in the same sentence.
      inlineDigests.push({ start, end, value: value.toLowerCase() });
    } else if (/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} _-]{0,63}$/u.test(value)) {
      const words = fold(value);
      const termIntroduced = /\b(?:what|term|label|code|word|ma|tu|nhan|ky hieu)\s*$/.test(before);
      if (
        !mutation.test(words) &&
        !/\b(?:please|ignore|disregard|override|instruction|system prompt|credential|bo qua|lam theo|nho|assign|delegate)\b/.test(
          words,
        ) &&
        (termIntroduced || !/^(?:read|check|inspect|review|doc|xem|coi|tra)\s+/.test(words))
      ) {
        retained.add(start);
        if (
          /\b(?:file|tep|scope|path|version|ban|muc) (?:marked|named|called|labelled|labeled|co nhan|mang ten|ten la)\s*$/u.test(
            before,
          )
        )
          scopeLabels.push(words);
      }
    }
  }
  scope.sort((left, right) => left.start - right.start);
  return {
    visible,
    prose: mask(visible, scope),
    paths: scope,
    digests,
    inlineDigests,
    scopeLabels,
    brief: mask(
      source,
      quotations.filter(({ start }) => !retained.has(start)),
    ),
  };
}

const actorCharacter = /^[\p{L}\p{M}\p{N}_-]/u;

function actorBoundary(text: string, index: number) {
  return index < 0 || index >= text.length || !actorCharacter.test(text.slice(index, index + 2));
}

function actorBoundaryBefore(text: string, index: number) {
  const last = text.charCodeAt(index - 1);
  const lead = text.charCodeAt(index - 2);
  const pair = last >= 0xdc00 && last <= 0xdfff && lead >= 0xd800 && lead <= 0xdbff;
  return actorBoundary(text, index - (pair ? 2 : 1));
}

function actorSpans(text: string, team: Member[]) {
  const exact = text.normalize('NFC').replace(/[’‘]/g, "'").toLowerCase();
  // Keep offsets into the masked source exact even when lowercasing a
  // character expands it into multiple UTF-16 code units.
  if (exact.length !== text.length) return;
  const addressedOwner = /^\s*([\p{L}][\p{L}\p{M}\p{N}_ -]{0,64}?) (?:ơi|oi)\s*,/u.exec(exact)?.[1];
  // Only accept accent folding for unaccented input. This avoids choosing a different
  // published person whose name only differs by accents when the sender supplied them.
  const candidates = new Map<string, { expression: string; members: Set<Member> }>();
  for (const member of team) {
    const names = [
      ...new Set([
        member.name,
        ...(Object.hasOwn(aliases, member.provider) ? aliases[member.provider] : []),
      ]),
    ];
    for (const label of names) {
      const variants = [
        label,
        `${label} của ${member.owner}`,
        `${label} cua ${member.owner}`,
        `${label} bên ${member.owner}`,
        `${label} ben ${member.owner}`,
        `${label} phía ${member.owner}`,
        `${label} phia ${member.owner}`,
        `${label} from ${member.owner}`,
        `${label} of ${member.owner}`,
        `${label} owned by ${member.owner}`,
        `${label} under ${member.owner}'s account`,
        `${label} (${member.owner})`,
        `${member.owner}'s ${label}`,
        `${member.owner} dùng ${label}`,
        `${member.owner} dung ${label}`,
        `${member.owner} nhờ ${label}`,
        `${member.owner} nho ${label}`,
        `${member.owner} cho ${label}`,
        `${member.owner} uses ${label}`,
        ...(member.ownedByRequester
          ? [
              `my ${label}`,
              `${label} cua toi`,
              `${label} cua minh`,
              `${label} cua tui`,
              `${label} của tôi`,
              `${label} của mình`,
              `${label} của tui`,
            ]
          : !addressedOwner ||
              addressedOwner === member.owner.toLowerCase() ||
              (addressedOwner === fold(addressedOwner) && addressedOwner === fold(member.owner))
            ? [`your ${label}`, `${label} của bạn`, `${label} cua ban`]
            : []),
      ];
      for (const spelling of new Set(variants.flatMap((variant) => [variant, fold(variant)]))) {
        const expression = spelling.normalize('NFC').replace(/[’‘]/g, "'").toLowerCase();
        const found = candidates.get(expression) ?? { expression, members: new Set() };
        found.members.add(member);
        candidates.set(expression, found);
      }
    }
  }
  const spans: Actor[] = [];
  for (const { expression, members } of candidates.values()) {
    if (!expression.trim()) continue;
    let start = exact.indexOf(expression);
    while (start >= 0) {
      const end = start + expression.length;
      const complete = actorBoundaryBefore(exact, start) && actorBoundary(exact, end);
      if (complete) spans.push({ start, end, value: members });
      start = exact.indexOf(expression, complete ? end : start + 1);
    }
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const strongest: Actor[] = [];
  for (const span of spans) {
    const prior = strongest.at(-1);
    if (prior && span.start < prior.end) continue;
    // A shorter name must not substitute for a different owner, including a
    // revoked/unknown account that is absent from the current roster.
    if (
      /\b(?:cua|ben|phia|from|of|your|my)\s+$/.test(
        fold(exact.slice(Math.max(0, span.start - 12), span.start)),
      ) &&
      !/\s/.test(exact.slice(span.start, span.end))
    )
      return;
    if (
      /(?:['’]s\s+)$/.test(exact.slice(0, span.start)) ||
      /^(?:\s+(?:cua|ben|phia|from|of|owned by|under)\s+\p{L}|\s*\(\s*\p{L})/u.test(
        fold(exact.slice(span.end)),
      )
    )
      return;
    const rawPrefix = text.slice(0, span.start);
    if (
      !/\s/.test(exact.slice(span.start, span.end)) &&
      /(?:^|[\s,;])(?:anh |chị |chi |mr\. |ms\. )?[\p{Lu}][\p{L}\p{M}\p{N}_-]{1,31}\s+(?:nhờ|nho|cho|dùng|dung|uses)\s+$/u.test(
        rawPrefix,
      ) &&
      !/(?:vui lòng|vui long|please|xin)\s+(?:cho|nhờ|nho)\s+$/iu.test(rawPrefix)
    ) {
      // "Grant a Linux machine to Astra" describes a permission recipient,
      // not a new person named Linux who nominated a different Astra.
      if (
        /\b(?:cap|chia se) (?:quyen )?(?:may|thiet bi) (?:linux|ubuntu|debian|fedora|windows|win32|macos|macbook|mac) cho\s*$/u.test(
          fold(rawPrefix),
        )
      )
        continue;
      return;
    }
    strongest.push(span);
  }
  return strongest;
}

function selectedFile(text: string, files: string[]) {
  if (files.length === 1) return files[0];
  if (files.length < 2) return;
  const selector =
    /\b(?:(?:first|second|third|latter|former) (?:file|path|one)|(?:the|only the) (?:first|second|third|latter|former)(?=\s*(?:[.,;!?]|$))|(?:cai|file|tep|duong dan) (?:dau|truoc|sau|thu (?:nhat|hai|ba)))\b/g;
  const ordinal = [
    ...new Set(
      Array.from(text.matchAll(selector), ([at]) => {
        if (/\b(?:first|former|dau|truoc|nhat)\b/.test(at)) return 0;
        if (/\b(?:third|ba)\b/.test(at)) return 2;
        if (/\b(?:latter|sau)\b/.test(at)) return files.length === 2 ? 1 : -1;
        return 1;
      }),
    ),
  ];
  return ordinal.length === 1 ? files[ordinal[0]] : undefined;
}

function descriptorTerms(text: string) {
  const canonical = fold(text)
    .replace(/\b(?:phan cung|thiet bi (?:that|thuc te))\b/g, 'hardware')
    .replace(/\b(?:sim|emulator|mo phong|gia lap)\b/g, 'simulator')
    .replace(/\b(?:het|full|maximum|toan bo|toi da)\b/g, 'full')
    .replace(/\b(?:den|lights|lighting|lamps?)\b/g, 'light');
  const common =
    /^(?:the|and|for|from|with|which|that|this|file|document|version|config|configuration|read|review|option|what|when|where|about|van|doi|giu|xem|doc|nho|cho|noi|tep|cau|bao|ban|file|phong|cung|cho|dung|danh|khi|bat|thu|muc|thuoc|tren|gia|nhan|tra|loi|phai|nhom|trong)$/;
  return new Set(
    (canonical.match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((word) => !common.test(word)),
  );
}

function intersectingDescriptor(text: string, descriptors: Map<string, Set<string>>) {
  const choice = text
    .split(/(?<=[.!?;])\s+/u)
    .filter(
      (clause) =>
        !/\b(?:co (?:mot )?ban (?:tuong tu|khac)|has (?:a |another )?(?:similar|alternate|different) (?:copy|version|file))\b/.test(
          clause,
        ),
    );
  const explicit = choice.flatMap((clause) => {
    const description =
      /(?:^|[,;]\s*)(?:lay|chon|dung|use|choose|select|take|work from) (?:the |dung |only )?(?:ban|tep|file|to|phieu|copy|edition|sheet|version)\s+([^,.!?;]{2,110})/u.exec(
        clause.trim(),
      )?.[1];
    return description ? [description] : [];
  });
  const distinguishing = new Map<string, string[]>();
  for (const term of descriptorTerms((explicit.length ? explicit : choice).join(' '))) {
    const matches = [...descriptors].filter(([, terms]) => terms.has(term)).map(([path]) => path);
    if (matches.length && matches.length < descriptors.size)
      distinguishing.set(explicit.length ? term : matches.join('\0'), matches);
  }
  // A single weak keyword does not select a scope. The file must satisfy each
  // separately discriminating condition stated by the current requester.
  if (distinguishing.size < 2) return;
  const matching = [...descriptors.keys()].filter((path) =>
    [...distinguishing.values()].every((paths) => paths.includes(path)),
  );
  return matching.length === 1 ? matching[0] : undefined;
}

function selectionProse(text: string) {
  return text
    .split(/(?<=[.!?;])\s+/u)
    .filter(
      (clause) =>
        !/^(?:(?:leave|keep)\b.{0,120}\b(?:unchanged|untouched|alone)|(?:file|ban|tep)\b.{0,120}\b(?:de|giu) nguyen)(?: nha| nhe| please)?[.!?;]?$/u.test(
          clause.trim(),
        ),
    )
    .join(' ')
    .replace(
      /(?:^|[,;]\s*|(?<=[.!?])\s+)(?:bo(?: qua)?|khong (?:dung|lay)|ignore|skip|do not use) (?:(?:the|those) )?(?:ban|bang|to|phieu|phien ban|edition|version|copy|sheet) [\p{L}\p{N} -]{1,100}(?=[.!?;]|$)/gu,
      (clause) =>
        /\b(?:giao|nho|hay|roi|sau do|then|ask|assign|write|edit|deploy|sua|xoa|chay)\b/u.test(
          clause,
        )
          ? clause
          : ' ',
    );
}

function referencesByLabel(text: string, reference: string, paths: Span<string>[]) {
  const selection = selectionProse(text);
  const descriptions = new Map<string, Set<string>>();
  const descriptors = new Map<string, Set<string>>();
  const editions = new Map<string, Set<'active' | 'retired'>>();
  for (const [index, path] of paths.entries()) {
    const phrases = descriptions.get(path.value) ?? new Set<string>();
    const before =
      fold(reference.slice(paths[index - 1]?.end ?? 0, path.start))
        .split(/[.!?;\r\n]/u)
        .at(-1) ?? '';
    const labeled =
      /(?:^|[:,])\s*([^,:]{2,90}?)\s*(?:\b(?:is|la|at|nam o|o|duoc luu o|located at|stored at|lives at)\b|:|=>)\s*$/u.exec(
        before,
      )?.[1];
    if (labeled) {
      const label = labeled.trim().replace(/^(?:the|file|tep|ban)\s+/u, '');
      phrases.add(label);
      const audience = /^(.+?)\s+(?:for|cho|danh cho)\s+(.+)$/u.exec(label);
      if (audience) {
        phrases.add(audience[1]);
        if (audience[2].includes(' ')) phrases.add(audience[2]);
      }
    }
    const after = fold(reference.slice(path.end, paths[index + 1]?.start ?? reference.length));
    const qualifier =
      /^\s*[`)]?\s*(?:(?:for|intended for|used in|used by|cho|danh cho|dung trong|su dung trong|cua|belongs to)|(?:,\s*)?(?:la|is|which is))\s+([^,.!?;\r\n]{3,64}?)\s*(?=\s+(?:and|or|va|hoac|lan|con|dang cho|pending|awaiting)\s|[,;.!?]|$)/u.exec(
        after,
      )?.[1];
    if (qualifier) phrases.add(qualifier.trim());
    const label = fold(path.value.split('/').at(-1) ?? '')
      .replace(/\.[^.]+$/, '')
      .replace(/[-_.]+/g, ' ');
    if (label.trim()) phrases.add(label.trim());
    descriptions.set(path.value, phrases);
    const annotation = after.split(/[.!?;\r\n]/u, 1)[0].slice(0, 140);
    const terms = descriptorTerms(
      `${path.value.replace(/\.[^.]+$/, '').replace(/[-_/.]+/g, ' ')} ${annotation} ${labeled ? before.slice(-110) : ''}`,
    );
    descriptors.set(path.value, new Set([...(descriptors.get(path.value) ?? []), ...terms]));
    const localDescription = `${labeled ?? ''} ${annotation.split(',', 1)[0]}`;
    const states = editions.get(path.value) ?? new Set<'active' | 'retired'>();
    if (activeEdition.test(localDescription)) states.add('active');
    if (retiredEdition.test(localDescription)) states.add('retired');
    editions.set(path.value, states);
  }
  const matched = [...descriptions].filter(([, labels]) =>
    [...labels].some((label) =>
      new RegExp(`(?<![\\p{L}\\p{N}_-])${escape(label)}(?![\\p{L}\\p{N}_-])`, 'u').test(selection),
    ),
  );
  const constrained = intersectingDescriptor(selection, descriptors);
  const requestedEdition = selection.replace(
    /\b(?:not|rather than|instead of|khong phai) (?:the |ban )?(?:(?:active|current|live) (?:edition|version|copy)|(?:dang|hien) (?:(?:duoc |su )?dung|ap dung))\b/g,
    ' ',
  );
  if (
    activeEdition.test(requestedEdition) &&
    [...editions.values()].some((states) => states.size)
  ) {
    const active = [...editions].filter(
      ([path, states]) =>
        states.size === 1 &&
        states.has('active') &&
        (!matched.length || matched.some(([file]) => file === path)) &&
        (!constrained || constrained === path),
    );
    if (active.length !== 1) return;
    return active[0][0];
  }
  if (matched.length === 1)
    return !constrained || constrained === matched[0][0] ? matched[0][0] : undefined;
  return matched.length && !matched.some(([path]) => path === constrained)
    ? undefined
    : constrained;
}

function revisions(text: string) {
  return [...text.matchAll(revisionToken), ...text.matchAll(revisionWithLabel)].map(([, hash]) =>
    hash.toLowerCase(),
  );
}

function digestBindings(source: EvidenceText) {
  const text = source.prose;
  const bare = [...text.matchAll(bareRevision)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    value: match[0].toLowerCase(),
  }));
  const digests = [...bare, ...source.digests, ...source.inlineDigests].filter(({ start, end }) => {
    const before = fold(
      text
        .slice(0, start)
        .split(/[.!?;\r\n]/u)
        .at(-1) ?? '',
    );
    const after = fold(text.slice(end).split(/[.!?;\r\n]/u)[0] ?? '');
    return (
      /\b(?:git|commit|revision|sha|patch|diff|ban va|pushed|(?:co|da|vua) day|thay doi (?:o|(?:duoc )?ghi (?:tai|o|trong))|change (?:was )?recorded (?:at|in)|(?:luot|lan|dot) (?:sua|chinh|doi|loi|cap nhat|thay doi)(?: [\p{L}\p{N}_-]+){0,8} (?:co )?ghi)\b/u.test(
        `${before} ${after}`,
      ) ||
      (/\b(?:(?:luot|lan|dot) (?:sua|chinh sua|cap nhat|thay doi)(?: (?:truoc|cu|gan nhat))?|(?:earlier|previous) (?:change|patch|fix))\s*,?\s*$/u.test(
        before,
      ) &&
        /^\s*(?:di voi|gan voi|kem(?: theo)?|goes with|comes with|is paired with|belongs to)\s/u.test(
          after,
        ))
    );
  });
  return digests.flatMap(({ start, end, value }) => {
    const files = source.paths.filter((path) => {
      const gap = path.end <= start ? text.slice(path.end, start) : text.slice(end, path.start);
      return gap.length <= 180 && !/[.!?;\r\n]/u.test(gap);
    });
    return files.length ? [{ digest: value, scope: files.map(({ value }) => value) }] : [];
  });
}

function isRosterContext(prose: string, mention: Actor) {
  if (mention.value.size < 2) return false;
  const start =
    fold(prose.slice(0, mention.start))
      .split(/[,.!?;\r\n]/u)
      .at(-1) ?? '';
  const boundary = /^[\s]*(?:[,.!?;]|$)/u.test(prose.slice(mention.end));
  return (
    boundary &&
    /^(?:(?:nhom|team|phong|group) (?:minh |nay |our )?(?:dang )?(?:co|has|have)|we have|there (?:are|were)|team has)\s+(?:hai|ba|2|3|two|three|multiple|several|nhieu|vai)\s*$/u.test(
      start.trim(),
    )
  );
}

function actorRole(prose: string, actor: Actor): 'mentioned' | 'excluded' | 'uncertain' {
  const before = fold(prose.slice(0, actor.start));
  const after = fold(prose.slice(actor.end));
  // An exact account after an explicit correction is a rejected candidate.
  if (
    /\b(?:khong phai(?: cai| ban| chiec| tai khoan| tro ly)?|not(?: the)?|rather than|instead of)\s*$/u.test(
      before,
    )
  ) {
    return /(?:^|[,.!;\r\n])\s*(?:khong phai(?: cai| ban| chiec| tai khoan| tro ly)?|not(?: the)?)\s*$|\b(?:rather than|instead of)\s*$/u.test(
      before,
    ) && /^\s*(?:(?:nha|nhe|please)\s*)?(?=[,.!;\r\n]|$)/u.test(after)
      ? 'excluded'
      : 'uncertain';
  }
  return /^\s+(?:(?:should |must |will )?(?:remain|stay|be|keep) unassigned|(?:does not need to|should not|must not) (?:take|handle|do) (?:this|the) (?:work|task)|(?:will not|won t|is not) (?:take|taking|assigned to|handling) (?:this (?:one|task|round)|the task)|khong (?:can|duoc|nen) (?:nhan viec|lam viec nay|tham gia|xu ly viec nay)|khong nhan (?:viec|dot|luot) (?:nay|do))(?: nha| nhe| please)?\s*(?=[.!?;]|$)/.test(
    after,
  )
    ? 'excluded'
    : 'mentioned';
}

function readProse(text: string) {
  const fragments = text.split(/(?<=[.!?;])\s+|[\r\n]+/u);
  const actionable = fragments.map((fragment) => {
    const clause = fold(fragment).replace(/[’']/g, ' ');
    const sentence = clause.replace(/[.!?]$/, '').trim();
    if (withdrawn.test(sentence) || withdrawnReplyChange.test(sentence)) return '';
    const restriction = Array.from(clause.matchAll(negativeRead)).find((match) => {
      // An owner qualifier establishes identity even when folding makes the
      // owner's name look like a negation of the following verb.
      if (!match[0].startsWith('dung ')) return true;
      return (
        !/\b(?:cua|ben|phia|of|from)\s+$/.test(clause.slice(0, match.index)) &&
        !/^Dũng\b/u.test(fragment.slice(match.index))
      );
    });
    // Isolated negative reading language is a boundary for the active request.
    // A clause that has later instructions is not discarded as a boundary.
    if (restriction)
      return /(?:,|^)\s*$/.test(clause.slice(0, restriction.index)) &&
        !/\b(?:and then|after that|sau do|tiep theo|but|nhung)\b/.test(
          clause.slice(restriction.index),
        )
        ? clause.slice(0, restriction.index)
        : undefined;
    return clause;
  });
  return actionable.every((clause) => clause !== undefined) ? actionable.join(' ') : undefined;
}

function activeWorkWords(words: string) {
  return (
    words
      .replace(
        /\b((?:doc|xem|coi|kiem tra|doi chieu) (?:dung |ca |to |ban )?)ghi chu\b/gu,
        '$1tai lieu',
      )
      .replace(/\b((?:giay|phieu|to) )ghi (?:ca|so)\b/gu, '$1tai lieu')
      .replace(
        /\b(?:dung|khoi|khong (?:can|duoc)) (?:sua|chinh|viet|ghi|them|xoa|gop|cap nhat) them(?=\s*(?:[,.!?;]|$))/gu,
        ' ',
      )
      .replace(negativeWork, ' ')
      .replace(
        /\b(?:khoi|dung|khong can|chua can) (?:mo|lap|tao|giao) (?:viec|task) (?:sua|chinh|viet|cap nhat)\b/gu,
        ' ',
      )
      .replace(
        /\b((?:tep|file|duong dan|ban va) (?:da|duoc)) ghi(?=\s+(?:o|trong|de (?:xem|kiem tra|doi chieu))\b|[,.!?;]|$)/gu,
        '$1',
      )
      .replace(
        /\b((?:doc|xem|coi) (?:ca hai |hai |dung )?(?:tep|file)) ghi (?=(?:o (?:do|day|tren)|trong (?:tin|ban va))\b)/gu,
        '$1 ',
      )
      .replace(
        /(?:^|[,.!?;]\s*)(?:chua|tam thoi khong) (?:tinh|ban|xet) (?:chuyen|viec|den viec) (?:sua|chinh|viet|cap nhat)(?: (?:luc nay|nha|nhe))?(?=\s*(?:[.!?;]|$))/gu,
        ' ',
      )
      .replace(/\bno (?:changes|edits|writes)\b/g, ' ')
      .replace(
        /\b(?:do not|don t|never) (?:assign|schedule|request|delegate) (?:any )?(?:edits?|writes?|changes?)\b/g,
        ' ',
      )
      .replace(
        /\b((?:da|co) (?:(?:thuc su|that su) )?(?:(?:duoc|bi) )?)(?:sua|chinh|viet|them|xoa|tao|ghi|cap nhat|gop)(?=(?: +[\p{L}\p{N}_-]+){0,8} +(?:chua|khong)\b)/gu,
        '$1',
      )
      .replace(
        /\b((?:muon chac|xac nhan|kiem tra|xem) (?:vu|viec|phan)) (?:gop|sua|chinh|viet|them|xoa|tao|ghi|cap nhat)(?=(?: +[\p{L}\p{N}_-]+){1,13} +(?:da co|da xong|co chua)\b)/gu,
        '$1',
      )
      // A nominal description of earlier work and a question about what the
      // product already does are evidence. Only mask those predicates, keeping
      // any adjacent imperative or conditional second action visible.
      .replace(
        /(^|[.!?;]\s*)((?:cai )?(?:vu|viec|chuyen) )(?:gop|sua|chinh|viet|them|cap nhat)(?=(?: +[\p{L}\p{N}_-]+){1,14} +(?:hom bua|hom truoc|truoc do)\s*,)/gu,
        '$1$2',
      )
      .replace(
        /\b((?:can|muon) biet(?: +[\p{L}\p{N}_-]+){0,14} +(?:van|co the)) ghi nhan(?= duoc(?: +[\p{L}\p{N}_-]+){0,10} +(?:hay )?khong\s*(?:[.!?;]|$))/gu,
        '$1',
      )
      .replace(
        /\b((?:bao (?:lai )?(?:minh|toi|tui) thoi|chi bao (?:minh|toi|tui))\s*,\s*(?:neu )?(?:thieu|khong co) thi) ghi (?:thieu|khong co)(?=\s*(?:[.!?;]|$))/gu,
        '$1',
      )
      // English `them` in an assignment clause is a pronoun, not Vietnamese thêm.
      .replace(/\b(assign|send|give|route|delegate) them (?=to\b)/g, '$1 ')
  );
}

function pinnedQuotaWait(words: string) {
  return (
    /\b(?:quota|usage limit|rate limit|gioi han su dung|het luot)\b/.test(words) &&
    /\b(?:hold (?:the )?assignment until|wait until|cho (?:toi|den) khi|doi[^,.;!?]{1,84} co (?:quota|luot) (?:moi|tro lai))\b/.test(
      words,
    ) &&
    /\b(?:(?:keep|retain) the same (?:assignee|account|teammate)|nguoi phu trach van la|giu nguyen (?:nguoi|tai khoan|teammate))\b/.test(
      words,
    )
  );
}

function mentionedAuthor(actors: Actor[], prose: string) {
  return actors.filter(({ start, end }) => {
    const before = fold(prose.slice(Math.max(0, start - 90), start));
    const after = fold(prose.slice(end, end + 90));
    // Require grammatical evidence of authorship; a bare household name in a
    // reviewer list does not make its owner the author of the patch.
    return (
      /\b(?:authored|written|created|implemented|prepared|made|developed) by\s*$|\b(?:patch|diff|commit|ban va|thay doi)(?:\s+[a-f0-9]{7,40})?\s+(?:by|from|cua|do)\s*$/u.test(
        before,
      ) ||
      /^\s+(?:(?:da|already) )?(?:wrote|authored|created|implemented|prepared|made|viet|tao|lam)\b/.test(
        after,
      )
    );
  });
}

function identifiedPatchOwners(prose: string, members: Member[]) {
  const owner =
    /\b(?:(?:authored|written|created|implemented|prepared|made|developed) by|(?:patch|diff|commit|revision|ban va|thay doi)(?: (?:under review|above|referenced|duoc nhac))?(?: (?:is|la))?(?: +\x60?[a-f0-9]{7,40}\x60?)? +(?:by|from|cua|do)|(?:author|tac gia|nguoi viet) (?:is|la))\s+([^,.!?;\r\n]{2,110})/giu;
  const known = new Set(members.map(({ owner }) => fold(owner)));
  const owners = new Set<string>();
  for (const [, attribution] of fold(prose).matchAll(owner)) {
    for (const candidate of known) {
      const name = new RegExp(`(?<![\\p{L}\\p{N}_-])${escape(candidate)}(?![\\p{L}\\p{N}_-])`, 'u');
      if (name.test(attribution)) owners.add(candidate);
    }
  }
  return owners;
}

function explicitlyListedReviewers(actors: Actor[], prose: string) {
  if (actors.some(({ value }) => value.size !== 1)) return;
  const selected = new Set(actors.flatMap(({ value }) => [...value]));
  if (selected.size < 2 || selected.size > 3) return;
  let group = new Set<Member>();
  for (const [index, actor] of actors.entries()) {
    const previous = actors[index - 1];
    if (
      previous &&
      !/^\s*,?\s*(?:(?:and|va|&)\s+)?(?:(?:one (?:from|by)|mot (?:luot |lan )?(?:tu|cua))\s+)?$/u.test(
        fold(prose.slice(previous.end, actor.start)),
      )
    )
      group = new Set<Member>();
    group.add([...actor.value][0]);
    if (group.size === selected.size) return [...group];
  }
}

function reviewRecipientList(actors: Actor[], prose: string, words: string) {
  // A request for each reviewer to do and report their own work distinguishes
  // the recipient of a review from a possible source of the commit.
  if (
    !/\b(?:give each|each (?:should|will|must|reports?)|their findings separate|moi nguoi|tung nguoi)\b/u.test(
      words,
    )
  )
    return [];
  const clauses = [...prose.matchAll(/[^.!?;\r\n]+/gu)];
  const supported = clauses.flatMap(({ 0: clause, index }) => {
    const local = actors.filter(({ start, end }) => start >= index && end <= index + clause.length);
    const first = local[0];
    if (!first || !explicitlyListedReviewers(local, prose)) return [];
    const lead = fold(prose.slice(index, first.start));
    return /\b(?:reviews|audits|luot (?:review|ra soat))\b[^,.!?;]{0,150}\b(?:from|tu)\s*$/u.test(
      lead,
    )
      ? [local]
      : [];
  });
  return supported.length === 1 ? supported[0] : [];
}

function authorityInventory(delivery: SharedDelivery): AuthorityInventory | undefined {
  if (delivery.team.length > 36) return;
  const current = evidenceText(delivery.request);
  if (!current) return;
  const words = readProse(current.prose);
  if (!words?.trim()) return;
  const currentScope = [...new Set(current.paths.map(({ value }) => value))];
  const usesReference =
    Boolean(delivery.referencedMessage) &&
    (currentScope.length ? explicitReply.test(words) : reply.test(words));
  const reference = usesReference ? evidenceText(delivery.referencedMessage!.content) : undefined;
  // A requested linked source still has to be representable as bounded data.
  if (usesReference && !reference) return;
  return {
    current,
    reference,
    words,
    currentScope,
    actors: actorSpans(current.prose, delivery.team)?.filter(
      (actor) => !isRosterContext(current.prose, actor),
    ),
    replyScope: [...new Set(reference?.paths.map(({ value }) => value))],
  };
}

function inventoriedFile(inventory: AuthorityInventory) {
  const { words, current, currentScope, reference, replyScope } = inventory;
  if (currentScope.length) {
    if (currentScope.length !== 1 || (replyScope.length && !replyScope.includes(currentScope[0])))
      return;
    return currentScope[0];
  }
  if (!reference) return;
  if (replyScope.length > 1 && mustChooseFile(words)) return;
  const ordinal = selectedFile(words, replyScope);
  if (replyScope.length <= 1) return ordinal;
  const labeled = referencesByLabel(
    [words, ...current.scopeLabels].join(' '),
    reference.visible,
    reference.paths,
  );
  return ordinal && labeled && ordinal !== labeled ? undefined : (ordinal ?? labeled);
}

function mustChooseFile(words: string) {
  return /\b(?:(?:ask|confirm|clarify|check with) (?:me )?(?:first )?which (?:one|file|attachment|path|sheet|of (?:the|these|those) (?:two|three|files|attachments))|(?:hoi|xac nhan) (?:lai )?(?:toi |minh )?(?:dung )?(?:(?:tep|file|ban|duong dan) )?nao)\b/.test(
    words,
  );
}

function explicitlyRequestsAllFiles(words: string) {
  return /\b(?:(?:read|check|inspect|review|compare|doc|xem|coi|kiem tra|ra soat|so sanh) (?:exactly |only |dung )?(?:both|all (?:of )?the|ca hai|tat ca|toan bo) (?:of (?:the|these|its) )?(?:files?|attachments?|paths?|tep|file|duong dan)|(?:both|all (?:of )?the) (?:files?|attachments?|paths?) (?:should|must|need to) be (?:read|checked|reviewed|inspected))\b/.test(
    words,
  );
}

/** Resolve linked file evidence without authorizing an action or an assignee. */
export function sharedSadeReferencedFileEvidence(
  request: string,
  source: string,
): string | undefined {
  const current = evidenceText(request);
  const reference = evidenceText(source);
  if (!current || !reference) return;
  const words = readProse(current.prose);
  if (!words || !reply.test(words)) return;
  const replyScope = [...new Set(reference.paths.map(({ value }) => value))];
  if (!replyScope.length) return;
  const file = inventoriedFile({
    current,
    reference,
    words,
    currentScope: [...new Set(current.paths.map(({ value }) => value))],
    replyScope,
  });
  return file && replyScope.includes(file) ? file : undefined;
}

function scopeRequest(words: string) {
  return (
    read.test(words) ||
    git.test(words) ||
    patchReview.test(words) ||
    asksForWork.test(words) ||
    /\?\s*$/u.test(words)
  );
}

const observationSubject =
  /\b(?:(?:does|did|will|would|can|whether|if) (?:it|(?:the|this) (?:code|app|system|handler|form|service|filter|function|page))|(?:code|app|he thong|chuong trinh|bo loc|giao dien|bieu mau|ham|tinh nang) (?:co(?: tu| the)?|da|van|tu(?: dong)?))\b/u;
const observationLead =
  /\b(?:xem|coi|kiem tra|xac minh|cho (?:minh|toi|tui) biet|can biet|muon biet|(?:tell|show|report to) me|say|see|check|verify|find out)\s*$/u;
const newAction =
  /\b(?:roi|sau do|tiep theo|thi hay|hay|vui long|nho|giao|then|after that|please|ask|assign|must|should)\b/u;

function verifiedReadProse(inventory: AuthorityInventory, actor: Member, file: string) {
  const { current, reference, actors } = inventory;
  const activeMention = actors?.find(
    (span) =>
      actorRole(current.prose, span) === 'mentioned' &&
      span.value.size === 1 &&
      span.value.has(actor),
  );
  if (!activeMention) return;
  const clauses = [...current.prose.matchAll(/[^.!?;\r\n]+[.!?;]?/gu)];
  if (
    !clauses.some(({ 0: clause, index }) => {
      const end = index + clause.length;
      const localActor = activeMention.start >= index && activeMention.end <= end;
      const nominatedEarlier =
        activeMention.end <= index &&
        /\b(?:ban (?:do|ay)|nguoi (?:do|ay)|tai khoan (?:do|ay)|they|that (?:person|account|teammate))\b/u.test(
          fold(clause),
        );
      const localPath = current.paths.some(
        (path) => path.value === file && path.start >= index && path.end <= end,
      );
      const boundPath = localPath || (reference !== undefined && reply.test(fold(clause)));
      return boundPath && (localActor || nominatedEarlier) && read.test(fold(clause));
    })
  )
    return;
  return clauses
    .map(([raw]) => {
      const clause = fold(raw).replace(/[’']/gu, ' ');
      const observation = observationSubject.exec(clause);
      if (!observation) return clause;
      const opening = clause.slice(0, observation.index);
      const tail = clause.slice(observation.index + observation[0].length);
      // An explicit reporting complement or question about a product subject can
      // contain verbs like "update" without allowing an update to be dispatched.
      if (
        (!observationLead.test(opening) && !/\?\s*$/u.test(clause)) ||
        newAction.test(tail) ||
        /\b(?:va|and)\s+(?:sua|viet|chinh|xoa|them|chay|edit|write|run|update|push|deploy|send)\b/u.test(
          tail,
        )
      )
        return clause;
      return opening;
    })
    .join(' ');
}

function distinctMembers(actors: Actor[] | undefined) {
  if (!actors?.length || actors.some(({ value }) => value.size !== 1)) return [];
  return [...new Set(actors.flatMap(({ value }) => [...value]))];
}

function editNominations(inventory: AuthorityInventory) {
  const {
    current: { prose },
    words,
    actors,
  } = inventory;
  const edit =
    /\b(?:sua|chinh|viet|tao|doi|cap nhat|bo sung|them|rut gon|tinh gian|bien tap|thay the|edit|write|fix|create|modify|update|add|replace|change|shorten|rewrite|rephrase|revise|implement(?:ing)?)\b/;
  if (
    !actors ||
    !edit.test(activeWorkWords(words)) ||
    /\b(?:fyi|just sharing|no action|for (?:your )?information only|chi bao tinh hinh)\b/.test(
      words,
    )
  )
    return [];
  const active = actors.filter((actor) => {
    if (actorRole(prose, actor) !== 'mentioned') return false;
    const localPrefix =
      prose
        .slice(0, actor.start)
        .split(/[.!?;\r\n]/u)
        .at(-1) ?? '';
    // The accent in "đúng Claude" distinguishes the exact-account qualifier
    // from "đừng Claude". Keep unaccented ambiguous words conservative.
    const before = fold(localPrefix.replace(/(?<![\p{L}\p{M}])đúng\s*$/iu, ' '));
    const after = fold(prose.slice(actor.end).split(/[.!?;\r\n]/u)[0]);
    if (
      /\b(?:(?:khong|dung|chua) (?:nho|giao|chi dinh)|(?:do not|don['’]t|never) (?:ask|assign|delegate|have))\b/.test(
        before,
      )
    )
      return false;
    const delegated =
      /\b(?:nho|giao|chi dinh|assign|ask|have|let)\b/.test(before) ||
      /\b(?:nho|dung|uses)\b/.test(fold(prose.slice(actor.start, actor.end)));
    if (
      /\b(?:why|whether|if|when|why would|vi sao|tai sao|xem|kiem tra|verify|inspect|do not|don t|khong|dung)\b/.test(
        before,
      ) &&
      !delegated
    )
      return false;
    const verb = new RegExp(
      `^\\s*,?\\s*(?:(?:to|should|will|please|se|hay|chi|only)\\s+)*(?:${edit.source}|(?:make|do|handle) (?:the|a|an|one) (?:(?:requested|approved|small|[a-z-]+) ){0,3}(?:change|edit)\\b)`,
      'u',
    );
    return (
      verb.test(after) ||
      (inventory.currentScope.length === 1 &&
        /^(?:the|this) (?:edit|change|fix) (?:in|to|for)\s+(?:goes|is assigned) to\s*$/u.test(
          before,
        ) &&
        /^[.!?;\s]*$/u.test(after)) ||
      (delegated &&
        /^\s*(?:as (?:the )?(?:(?:actual|primary|sole|only|main) )?writer|(?:lam|la) (?:nguoi )?(?:viet|sua)(?: chinh)?)\b/u.test(
          after,
        ))
    );
  });
  return distinctMembers(active);
}

function conflictingReviewer(inventory: AuthorityInventory, team: Member[], writers: Member[]) {
  const {
    current: { prose },
    reference,
    words,
    actors,
  } = inventory;
  if (!actors || !independence.test(words) || !patchReview.test(words)) return;
  const active = actors.filter((actor) => actorRole(prose, actor) === 'mentioned');
  const recipients = reviewRecipientList(active, prose, words);
  const authorshipProse = mask(prose, recipients);
  const mentionedAuthors = new Set(
    mentionedAuthor(active, authorshipProse).filter((actor) => !recipients.includes(actor)),
  );
  const owners = identifiedPatchOwners(`${authorshipProse}. ${reference?.prose ?? ''}`, team);
  for (const { owner } of [...writers, ...distinctMembers([...mentionedAuthors])])
    owners.add(fold(owner));
  if (
    writers.length === 1 &&
    /\b(?:same (?:account|teammate) (?:down )?(?:for|to) (?:the )?review|cung tai khoan (?:do )?(?:de|lam) (?:review|ra soat))\b/u.test(
      words,
    )
  )
    return writers[0];
  const candidates = active.filter(
    (actor) =>
      actor.value.size === 1 &&
      !mentionedAuthors.has(actor) &&
      !/^\s*(?:as (?:a |the )?(?:backup|fallback)|la (?:nguoi )?du phong)\b/u.test(
        fold(prose.slice(actor.end)),
      ),
  );
  const nominated = candidates.filter((actor) => {
    const before = fold(
      prose
        .slice(0, actor.start)
        .split(/[.!?;\r\n]/u)
        .at(-1) ?? '',
    );
    const after = fold(prose.slice(actor.end).split(/[.!?;\r\n]/u)[0]);
    return (
      /\b(?:reviewer (?:is|was|would be|should be)|review (?:by|from)|de xuat|nguoi (?:duyet|ra soat) la)\s*$/u.test(
        before,
      ) ||
      /^\s+(?:(?:(?:to|down to|will|should|can|was going to|had been asked to|se|chi|only) )?(?:review|audit|ra soat|duyet)|(?:as (?:the |a )?|la (?:mot )?)reviewer|(?:la|lam) nguoi (?:review|duyet|ra soat)|lam (?:duyet|ra soat))\b/u.test(
        after,
      ) ||
      /^\s+(?:is|was|appeared as) (?:my|our|the) (?:draft|original|proposed) (?:reviewer|review (?:pick|choice|candidate))\b/u.test(
        after,
      ) ||
      /^\s+(?:chi |only )?(?:xem|doc|kiem tra|read|inspect)\b[^.!?;]{0,110}\b(?:review|ra soat) (?:doc lap|independently)\b/u.test(
        after,
      )
    );
  });
  // Reviewers are task roles. A style contact, extra writer or neighboring
  // teammate mention supplies no evidence that they were asked to review.
  const reviewerList = explicitlyListedReviewers(
    recipients.length ? recipients : candidates,
    prose,
  );
  const possibleReviewers = nominated.length ? distinctMembers(nominated) : (reviewerList ?? []);
  const authorConflict = possibleReviewers.find(({ owner }) => owners.has(fold(owner)));
  if (authorConflict) return authorConflict;
  return possibleReviewers.find((member, index) =>
    possibleReviewers.slice(index + 1).some(({ owner }) => fold(owner) === fold(member.owner)),
  );
}

function removedGrantIdentities(prose: string) {
  const active =
    /(?:^|[.!?;\r\n]\s*)(?<owner>[\p{Lu}][\p{L}\p{M}\p{N}_-]{1,48})\s+(?:has )?(?:removed|revoked|withdrew|disabled)\s+(?<name>[\p{L}\p{M}\p{N}_-]{2,48})['’]s\s+(?:share|grant|access)\s+(?:from|in|for)\s+(?:this|the)\s+(?:room|workspace|project)\b/gu;
  // The account is the subject of the revoked access, not the earlier
  // possessive describing the room or project that owns the grant.
  const passive =
    /(?:^|[.!?;\r\n]\s*)(?:(?:this|the current)\s+(?:room|workspace|project)['’]s\s+(?:grant|access|share|permission)|(?:the\s+)?(?:grant|access|share|permission)\s+(?:in|for)\s+(?:this|the current)\s+(?:room|workspace|project))\s+(?:for|to)\s+(?<owner>[\p{L}\p{M}\p{N}_-]{2,48})['’]s\s+(?<name>[\p{L}\p{M}\p{N}_-]{2,48})\s+(?:was|is|has been)\s+(?:(?:just|recently|now|already)\s+)?(?:revoked|withdrawn|disabled|removed|taken away)\b/giu;
  const vietnamese =
    /(?:^|[.!?;\r\n]\s*)(?:(?:Tôi|Toi|Mình|Minh) (?:thấy|thay) )?(?<owner>[\p{L}\p{M}\p{N}_-]{2,48})\s+(?:(?:đã|da|vừa|vua)\s+)?(?:tắt|tat|thu hồi|thu hoi|gỡ|go)\s+(?:(?:chia sẻ|chia se|quyền|quyen|grant)\s+){1,2}(?:(?:dùng|dung|sử dụng|su dung)\s+)?(?<name>[\p{L}\p{M}\p{N}_-]{2,48})\s+(?:(?:ở|o|trong|của|cua)\s+)?(?:project|dự án|du an|phòng|phong|nhóm|nhom)\s+(?:này|nay)\b/giu;
  const targets = new Map<string, { name: string; owner: string }>();
  for (const { groups } of [
    ...prose.matchAll(active),
    ...prose.matchAll(passive),
    ...prose.matchAll(vietnamese),
  ]) {
    if (!groups) continue;
    const { name, owner } = groups;
    targets.set(`${fold(name)}\0${fold(owner)}`, { name, owner });
  }
  return [...targets.values()];
}

function requestsRestoredGrant(words: string) {
  return /\b(?:restor(?:e|ing) (?:the |this |its )?(?:grant|share|access)|cap lai (?:quyen|grant)|chia lai quyen|(?:hoi|xac nhan) .{0,55}(?:cap|ve) quyen hien tai)\b/u.test(
    words,
  );
}

function staleProjectGrant(prose: string, words: string) {
  if (
    !/\b(?:that (?:exact|same) (?:account|teammate)|(?:dung|chinh) (?:tai khoan|nguoi) (?:do|ay))\b/u.test(
      words,
    ) ||
    !/\b(?:this|current) (?:project|workspace|room)\b|\b(?:du an|project|phong) (?:nay|hien tai)\b/u.test(
      words,
    ) ||
    !/\b(?:ask|confirm|check with|hoi|xac nhan)\b.{0,95}\b(?:grant|permission|access|quyen)\b/u.test(
      words,
    )
  )
    return;
  const sources = [...prose.matchAll(/[^.!?;\r\n]+/gu)]
    .map(([text]) => text)
    .filter((text) =>
      /\b(?:(?:previous|another|other|last|training|demo|sandbox) (?:project|workspace|room)|(?:du an|project|phong) (?:truoc|khac|cu|tap huan|dao tao))\b/u.test(
        fold(text),
      ),
    );
  if (sources.length !== 1) return;
  const matching = [
    ...sources[0].matchAll(
      /(?:^|\s)(?<owner>[\p{L}\p{M}\p{N}_-]{2,48})['’]s\s+(?<name>[\p{L}\p{M}\p{N}_-]{2,48})\s+(?:handled|read|checked|inspected|could)\b/giu,
    ),
  ];
  if (matching.length !== 1) return;
  const { name, owner } = matching[0].groups!;
  return { name, owner };
}

function routesFor(delivery: SharedDelivery, inventory: AuthorityInventory): Route[] {
  const { team } = delivery;
  const {
    current,
    words: plain,
    actors: actorEvidence,
    currentScope,
    replyScope: fromReply,
    reference,
  } = inventory;
  if (!actorEvidence?.length) return [];
  const { prose } = current;
  if (removedGrantIdentities(prose).length) return [];
  const requestsSeparateReview =
    independence.test(plain) && (patchReview.test(plain) || independentLook.test(plain));
  const actorRoles = actorEvidence.map((actor) => ({ actor, role: actorRole(prose, actor) }));
  if (actorRoles.some(({ role }) => role === 'uncertain')) return [];
  const activeActors = actorRoles.flatMap(({ actor, role }) =>
    role === 'mentioned' ? [actor] : [],
  );
  const disallowed = actorRoles.flatMap(({ actor, role }) => (role === 'excluded' ? [actor] : []));
  const selectedScope = inventoriedFile(inventory);
  const positive = activeWorkWords(
    reference && selectedScope && activeEdition.test(plain) ? selectionProse(plain) : plain,
  );
  const waitForSameAccount = pinnedQuotaWait(positive);
  const unresolvedWork = waitForSameAccount
    ? positive.replace(
        /\b(?:quota|usage limit|rate limit|gioi han su dung|het luot|wait until|hay doi)\b/g,
        ' ',
      )
    : positive;
  if (!scopeRequest(plain) || editNominations(inventory).length || unresolved.test(unresolvedWork))
    return [];
  if (
    /\b(?:usage|rate) limit\b/.test(unresolvedWork) &&
    !/\b(?:keep|retain) the same (?:assignee|account|teammate)\b/.test(plain)
  )
    return [];

  const usesReference = Boolean(reference);
  if (
    currentScope.length &&
    fromReply.length &&
    currentScope.some((file) => !fromReply.includes(file))
  )
    return [];
  const scopes = currentScope.length ? currentScope : fromReply;
  const reviewRevisions = requestsSeparateReview
    ? current.inlineDigests
        .filter(({ start }) =>
          /\b(?:independent look at|review|audit|check|inspect)(?: (?:of|at))?\s*$/u.test(
            fold(prose.slice(0, start)),
          ),
        )
        .map(({ value }) => value)
    : [];
  const currentRevision = [
    ...new Set([
      ...revisions(fold(prose)),
      ...current.digests.map(({ value }) => value),
      ...reviewRevisions,
    ]),
  ];
  const referenceProse = reference?.prose ?? '';
  const referenceWords = fold(referenceProse);
  const explicitReference = [
    ...revisions(referenceWords),
    ...(reference?.digests.map(({ value }) => value) ?? []),
  ];
  const boundDigests =
    reference && (git.test(plain) || patchReview.test(plain)) ? digestBindings(reference) : [];
  const referenceRevision = [
    ...new Set([...explicitReference, ...boundDigests.map(({ digest }) => digest)]),
  ];
  if (
    currentRevision.length > 1 ||
    (usesReference && referenceRevision.length > 1) ||
    (usesReference &&
      currentRevision.length &&
      referenceRevision.length &&
      currentRevision[0] !== referenceRevision[0])
  )
    return [];
  const revision = currentRevision[0] ?? (usesReference ? referenceRevision[0] : undefined);

  if (requestsSeparateReview) {
    if (mutation.test(positive)) return [];
    const recipients = reviewRecipientList(activeActors, prose, plain);
    const authorshipProse = mask(prose, recipients);
    const authorSpans = new Set(
      mentionedAuthor(activeActors, authorshipProse).filter((actor) => !recipients.includes(actor)),
    );
    const referenceActors = usesReference ? actorSpans(referenceProse, team) : [];
    if (!referenceActors) return [];
    const authors = [...authorSpans, ...referenceActors];
    const reviewerSpans = activeActors.filter((span) => !authorSpans.has(span));
    if (recipients.length && reviewerSpans.some((span) => !recipients.includes(span))) return [];
    // An explicit list must designate these accounts together; separated mentions
    // alone cannot assign a reviewer, but repetitions of the same pair can clarify.
    const members = explicitlyListedReviewers(
      recipients.length ? recipients : reviewerSpans,
      prose,
    );
    if (!members || !revision || !scopes.length || scopes.length > 8) return [];
    const reviewerCount = [
      ...plain.matchAll(
        /\b(hai|ba|two|three|2|3) (?:(?:independent|separate|read[ -]only) )*(?:reviews?|reviewers?|(?:luot |nguoi )?(?:review|ra soat))\b/g,
      ),
    ];
    if (
      reviewerCount.some(([, count]) => members.length !== (/^(?:ba|three|3)$/.test(count) ? 3 : 2))
    )
      return [];
    const owners = new Set(members.map(({ owner }) => fold(owner)));
    const attributedOwners = identifiedPatchOwners(
      `${authorshipProse}. ${usesReference ? referenceProse : ''}`,
      team,
    );
    if (
      owners.size !== members.length ||
      disallowed.some(({ value }) => members.some((member) => value.has(member))) ||
      [...owners].some((owner) => attributedOwners.has(owner)) ||
      authors.some(({ value }) => [...value].some(({ owner }) => owners.has(fold(owner))))
    )
      return [];
    const expectedCount = numberedPaths.exec(plain);
    if (
      expectedCount &&
      scopes.length !== (/^(?:ba|three|3)$/.test(expectedCount[1] ?? '') ? 3 : 2)
    )
      return [];
    if (
      scopes.length > 1 &&
      !currentScope.length &&
      !expectedCount &&
      !/\b(?:same|exact|entire|whole|cung|toan bo) (?:patch|diff|revision|commit|ban va)\b/.test(
        plain,
      )
    )
      return [];
    if (currentScope.length && fromReply.length && currentScope.length !== fromReply.length)
      return [];
    return [{ kind: 'review', actors: members, scope: scopes, revision }];
  }

  if (activeActors.some(({ value }) => value.size !== 1)) return [];
  const requestedActors = activeActors.filter((actor) => {
    const start = prose.slice(0, actor.start).search(/[^.!?;\r\n]*$/u);
    const lead = prose.slice(start, actor.start).trim();
    const clause = prose.slice(actor.end).split(/[.!?;\r\n]/u)[0];
    if (
      lead ||
      current.paths.some(
        ({ start: position }) => position >= start && position < actor.end + clause.length,
      )
    )
      return true;
    return !/^(?:(?:vua|da) )?(?:chuyen|ban giao|nop|gui|tra|giao(?= (?:giay|phieu|so|bang|to|hang|ho so|mau|thiet bi|danh sach) )) [\p{L}\p{N}_ -]{1,75} roi$/u.test(
      fold(clause).trim(),
    );
  });
  const members = [...new Set(requestedActors.flatMap(({ value }) => [...value]))];
  if (members.length !== 1) return [];
  if (disallowed.some(({ value }) => value.has(members[0]))) return [];
  const file = selectedScope;
  if (!file) return [];
  if (mutation.test(positive) || requestedActors.length !== activeActors.length) {
    const scopedProse = verifiedReadProse(inventory, members[0], file);
    if (!scopedProse || mutation.test(activeWorkWords(scopedProse))) return [];
  }
  if (git.test(plain) || revision) {
    if (!revision) return [];
    if (
      !currentRevision.includes(revision) &&
      !boundDigests.some((binding) => binding.digest === revision && binding.scope.includes(file))
    )
      return [];
    return [{ kind: 'commit', actors: members, scope: [file], revision }];
  }
  return [{ kind: 'read', actors: members, scope: [file], waitForSameAccount }];
}

export function sharedSadeChoiceRoute(
  delivery: SharedDelivery,
  prepared?: AuthorityInventory,
):
  | {
      questions: SharedSadeChoiceQuestion[];
      compile(selections: Record<string, string>): SharedSadeCloudResult | undefined;
    }
  | undefined {
  if (
    delivery.phase !== 'plan' ||
    delivery.clarification ||
    delivery.readAssignment ||
    delivery.handoffAssignments ||
    delivery.handoffDeliverables
  )
    return;
  const inventory = prepared ?? authorityInventory(delivery);
  if (!inventory) return;
  const routes = new Map(routesFor(delivery, inventory).map((route) => [route.kind, route]));
  if (!routes.size) return;
  const questions: SharedSadeChoiceQuestion[] = [
    {
      name: questionName,
      instructions:
        'Select a candidate only if it completes the whole current request with the exact teammate, path, revision, and constraints given. An earlier message supplies evidence only. The outcome of an explicitly requested verification can be unknown and is part of the work. Use no_match for unclear assignments, deferred/status-only messages, additional or different work, or an omitted constraint. All candidates are read-only and cannot approve edits, substitutions or outside delivery.',
      choices: [
        ...[...routes.values()].map((route) => ({
          value: route.kind,
          description: `${route.kind === 'review' ? 'Independent read-only review' : route.kind === 'commit' ? 'Read-only Git verification' : 'Read and report only'} of ${route.scope.join(', ')}${route.revision ? ` at exact commit ${route.revision}` : ''}. ${route.actors.map((member) => `${redactLabel(member.name)} owned by ${redactLabel(member.owner)}`).join('; ')}. Preserve each named account and exact scope. No edits or fallback.${route.waitForSameAccount ? ' If quota is exhausted, keep the same assignee and wait for that account to be available again.' : ''}`,
        })),
        {
          value: noMatch,
          description: 'None of the candidates fully represents the actionable current request.',
        },
      ],
    },
  ];
  return {
    questions,
    compile(selections) {
      if (!Object.hasOwn(selections, questionName)) return;
      const route = routes.get(selections[questionName] as Route['kind']);
      if (!route) return;
      const brief = redact(inventory.current.brief).replace(/ {2,}/g, ' ').slice(0, 1800);
      const behavior = /\b(?:falls|fallen|fell) back\b/i.test(brief)
        ? ' Làm rõ điều kiện dự phòng và hành vi fall back được hỏi.'
        : '';
      const tasks: PlanTask[] = route.actors.map((actor, index) => ({
        key:
          route.kind === 'review'
            ? `review-${index + 1}`
            : route.kind === 'commit'
              ? 'read-git-history'
              : 'read-file',
        title: `${route.kind === 'review' ? 'Rà soát' : 'Đọc'} ${route.scope[0].slice(0, 110)} (${index + 1})`,
        description: `${route.kind === 'review' ? 'Rà soát độc lập; báo phát hiện riêng.' : 'Chỉ đọc các tệp đã giao và báo kết quả.'}${route.revision ? ` Xác minh đúng commit ${route.revision} trong Git. Báo lại nếu commit hoặc tệp chưa có trong bản làm việc, giữ nguyên tệp và không dùng bản khác.` : ''} Yêu cầu: ${brief}`,
        kind: route.kind === 'review' ? 'review' : 'research',
        scope: route.scope,
        acceptance:
          'Chỉ đọc đúng phạm vi phân công, báo bằng chứng và giữ nguyên mọi tệp.' +
          behavior +
          (route.waitForSameAccount
            ? ' Nếu hết lượt, giữ nguyên người phụ trách và báo chờ đến khi người đó có lượt mới.'
            : ''),
        effort: 1,
        stage: route.kind === 'review' ? 'Review' : 'Plan',
        dependsOn: [],
        preferredMemberId: actor.id,
        ...(route.waitForSameAccount ? { waitForProviderQuota: true } : {}),
      }));
      return {
        kind: 'plan',
        plan: parseTeamPlan({
          summary: 'Đã xác minh người và phạm vi cho từng tác vụ chỉ đọc.',
          tasks,
        }),
      };
    },
  };
}

type EvidenceBinding = 'permission' | 'reviewer' | 'machine' | 'owner' | 'scope';

function requestedExecutionPlatform(prose: string, files: readonly Span<string>[]) {
  const positiveRequests = [...prose.matchAll(/[^,.!?;\r\n]+/gu)]
    .map(({ 0: text, index }) => ({
      text,
      words: fold(text).replace(/[’']/gu, ' '),
      bindsFile: files.some(({ start, end }) => start >= index && end <= index + text.length),
    }))
    .filter(
      ({ words, bindsFile }) =>
        (bindsFile || !files.length) &&
        !/\b(?:cho phep|da (?:dong y|cap quyen)|has (?:approved|authorized)|gave permission)\s+(?:chay|kiem thu|run|execute|to run)\b/u.test(
          words,
        ) &&
        !/\b(?:dung|khong(?: duoc)?|do not|don t|never) (?:chay|dung|su dung|muon|run|use|borrow|switch to)\b/u.test(
          words,
        ) &&
        /\b(?:chay|kiem thu|run|execute|(?:can|will|try|to|please) test|ghep cap|paired)\b/u.test(
          words,
        ),
    );
  const targets = [
    { platform: 'darwin', label: 'macOS', mention: /\b(?:macos|darwin|mac(?:book)?|may mac)\b/u },
    { platform: 'linux', label: 'Linux', mention: /\b(?:linux|ubuntu|debian|fedora)\b/u },
    { platform: 'win32', label: 'Windows', mention: /\b(?:windows|win32)\b/u },
  ].filter(({ mention }) => positiveRequests.some(({ words }) => mention.test(words)));
  if (targets.length !== 1) return;
  const [target] = targets;
  const deviceNames = new Map<string, string>();
  const locativeDevice =
    /\b(?:trên|tren|on|using|via|qua)\s+(?:(?:đúng|dung|exactly)\s+)?(?:the\s+)?(?:(?:máy|may)\s+)?(?<label>(?:(?:Mac(?:Book|OS)?|(?:Linux|Windows)(?: (?:machine|PC|workstation))?|machine|device)\s+(?:của|cua|of|named)\s+[^,;.!?]{1,60}|[\p{L}\p{M}\p{N}_-]{1,48}['’]s\s+(?:Mac(?:Book|OS)?|(?:Linux|Windows) (?:machine|PC|workstation))))\b/iu;
  for (const { text } of positiveRequests) {
    const name = locativeDevice
      .exec(text)
      ?.groups?.label.split(
        /\s+(?:giúp|giup|dùm|dum|nhé|nhe|nha|please|exactly|then|and|và|va|chứ|chu|thay vì)\b/iu,
        1,
      )[0]
      .trim();
    if (name && redact(name) === name) deviceNames.set(normalizeDeviceLabel(name), name);
  }
  return { ...target, names: [...deviceNames.values()] };
}

function normalizeDeviceLabel(value: string) {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/^(?:máy|may|the) +/u, '')
    .replace(
      /^(.+?)['’]s (mac(?:book|os)?|(?:linux|windows) (?:machine|pc|workstation))$/u,
      '$2 of $1',
    )
    .replace(
      /^(mac(?:book|os)?|(?:linux|windows)(?: (?:machine|pc|workstation))?) (?:cua|của) /u,
      '$1 of ',
    )
    .replace(/\s+/gu, ' ')
    .trim();
}

function deviceLabelMatches(requested: string, granted: string) {
  const requestedName = normalizeDeviceLabel(requested);
  const grantedName = normalizeDeviceLabel(granted);
  return (
    requestedName === grantedName ||
    (requestedName === fold(requestedName) && requestedName === fold(grantedName))
  );
}

export function sharedSadeEvidenceQuestion(
  delivery: SharedDelivery,
  prepared?: AuthorityInventory,
):
  | (Extract<SharedSadeCloudResult, { kind: 'question' }> & { binding: EvidenceBinding })
  | undefined {
  if (
    delivery.phase !== 'plan' ||
    delivery.clarification ||
    delivery.readAssignment ||
    delivery.handoffAssignments ||
    delivery.handoffDeliverables
  )
    return;
  const inventory = prepared ?? authorityInventory(delivery);
  if (!inventory) return;
  const {
    current: { prose, paths: fileSpans },
    words: plain,
    actors,
    currentScope,
    replyScope,
  } = inventory;
  const format = (binding: EvidenceBinding, summary: string) => ({
    kind: 'question' as const,
    summary,
    binding,
  });

  const removedGrants = removedGrantIdentities(prose);
  if (
    removedGrants.length &&
    requestsRestoredGrant(plain) &&
    inventoriedFile(inventory) &&
    scopeRequest(plain)
  ) {
    const labels = removedGrants.map(
      ({ name, owner }) => `${redactLabel(name)} của ${redactLabel(owner)}`,
    );
    return format(
      'permission',
      `Bạn muốn cấp lại quyền cho ${labels.join(' hay ')} trong dự án này để tiếp tục đúng phạm vi?`,
    );
  }

  const writers = editNominations(inventory);
  const deniedWriter = writers.find((member) => !member.allowWrites);
  if (deniedWriter && inventoriedFile(inventory))
    return format(
      'permission',
      `Bạn muốn cấp quyền ghi cho ${redactLabel(deniedWriter.name)} của ${redactLabel(deniedWriter.owner)} trong dự án này trước khi giao việc?`,
    );

  const namedMembers = distinctMembers(
    actors?.filter((actor) => actorRole(prose, actor) === 'mentioned'),
  );
  const target = requestedExecutionPlatform(mask(prose, actors ?? []), fileSpans);
  if (namedMembers.length === 1 && target) {
    const [member] = namedMembers;
    const [machine] = target.names;
    if (
      machine &&
      (target.names.length > 1 ||
        member.pairedPlatform !== target.platform ||
        !member.pairedMachineName ||
        !deviceLabelMatches(machine, member.pairedMachineName))
    )
      return format(
        'machine',
        `${redactLabel(member.name)} của ${redactLabel(member.owner)} cần quyền dùng đúng ${target.names.map(redactLabel).join(' hay ')} trong dự án này. Bạn muốn cấp quyền cho thiết bị nào?`,
      );
    if (member.platform !== target.platform && member.pairedPlatform !== target.platform)
      return format(
        'machine',
        `${redactLabel(member.name)} của ${redactLabel(member.owner)} cần quyền dùng máy ${target.label} trong dự án này. Bạn muốn cấp quyền cho thiết bị nào?`,
      );
  }
  if (!scopeRequest(plain)) return;

  const stale = staleProjectGrant(prose, plain);
  if (
    stale &&
    inventoriedFile(inventory) &&
    !namedMembers.some(
      ({ name, owner }) => fold(name) === fold(stale.name) && fold(owner) === fold(stale.owner),
    )
  )
    return format(
      'permission',
      `Bạn muốn xác nhận quyền hiện tại của ${redactLabel(stale.name)} của ${redactLabel(stale.owner)} trong dự án này trước khi giao việc?`,
    );

  const person = actors?.[0];
  if (
    person &&
    person.value.size > 1 &&
    actors?.every(
      ({ value }) =>
        value.size === person.value.size && [...value].every((member) => person.value.has(member)),
    )
  ) {
    const label = redactLabel(prose.slice(person.start, person.end));
    const owners = [...new Set([...person.value].map(({ owner }) => redactLabel(owner)))];
    return format(
      'owner',
      `Bạn muốn dùng ${label} của chủ tài khoản nào${owners.length > 1 ? `, ${owners.join(' hay ')}` : ''}?`,
    );
  }

  const conflict = conflictingReviewer(inventory, delivery.team, writers);
  if (conflict)
    return format(
      'reviewer',
      `Bạn muốn ai review độc lập, thuộc chủ tài khoản khác ${redactLabel(conflict.owner)}?`,
    );

  if (
    !currentScope.length &&
    !writers.length &&
    replyScope.length > 1 &&
    replyScope.length <= 4 &&
    !inventoriedFile(inventory) &&
    !explicitlyRequestsAllFiles(plain) &&
    !independence.test(plain)
  ) {
    return format(
      'scope',
      `Bạn muốn dùng đường dẫn tệp nào trong tin trước, ${replyScope.join(' hay ')}?`,
    );
  }

  if (
    (!actors || !actors.length) &&
    /\b(?:revoked|other project|another project|restore access|grant has expired|thu hoi|cap lai|du an khac|quyen o du an|quyen o project|quyen o nhom)\b/.test(
      plain,
    )
  ) {
    const possessive = [
      ...prose.matchAll(
        /(?:^|[\s,])([\p{L}\p{M}\p{N}_-]{2,32}['’]s\s+(?<name>[\p{L}\p{M}\p{N}_-]{2,32}))(?=[\s,.!?]|$)/giu,
      ),
    ].find(
      ({ groups }) =>
        !/^(?:grant|access|share|permission|policy|room|workspace|project|file|folder|account|device)$/u.test(
          fold(groups?.name ?? ''),
        ),
    )?.[1];
    const qualified =
      /(?:^|\s)([\p{L}\p{M}\p{N}_-]{2,32} (?:của|cua|bên|ben|phía|phia|from|of) [\p{L}\p{M}\p{N}_-]{2,32})(?=\s|$)/iu.exec(
        prose,
      )?.[1];
    const delegate =
      /(?:^|\s)(?:Anh |Chị )?(?<owner>[\p{Lu}][\p{L}\p{M}\p{N}_-]{1,31}) (?:nhờ|nho|cho|dùng|dung) (?<name>[\p{Lu}][\p{L}\p{M}\p{N}_-]{1,31})(?=\s|$)/u.exec(
        prose,
      )?.groups;
    const identity =
      possessive ?? qualified ?? (delegate && `${delegate.name} của ${delegate.owner}`);
    if (identity)
      return format(
        'permission',
        `Bạn muốn cấp lại quyền cho ${redactLabel(identity)} trong dự án này để tiếp tục đúng phạm vi?`,
      );
  }
}

export function sharedSadeReadEvidence(delivery: SharedDelivery) {
  const inventory = authorityInventory(delivery);
  return {
    question: inventory ? sharedSadeEvidenceQuestion(delivery, inventory) : undefined,
    choices: () => (inventory ? sharedSadeChoiceRoute(delivery, inventory) : undefined),
  };
}

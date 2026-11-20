import type { SharedSadeChoiceQuestion } from '../shared/sade-cloud.ts';
import type { PlanTask } from '../shared/types.ts';
import { isPrivateCredentialPath } from './checkpoint.ts';
import { assertSharedHandoffPlan, type SharedDelivery } from './group-sade.ts';
import { normalizeScope, redact, scopesOverlap } from './security.ts';
import { foldSharedSadeName } from './shared-sade-assignment.ts';
import type { SharedSadeCloudResult } from './shared-sade-cloud-planner.ts';
import { requestedSharedVerificationRevision } from './shared-sade-git.ts';
import { frontendStyleQuestion } from './shared-sade-handoff-facts.ts';
import { collectPrerequisites, parseTeamPlan } from './workflow-plan.ts';

type Member = SharedDelivery['team'][number];
type Candidate = {
  kind: 'code' | 'research' | 'review';
  scope: string[];
  member?: Member;
  reviewed?: [number, number];
  needsWriteConfirmation?: true;
};
type Completion = { kind: 'completion'; premise: string; consequent: string };
type Prerequisite = {
  kind: 'prior-file-completion';
  producer: number;
  file: string;
  evidence: string;
};
type VerificationGate = { kind: 'verified-missing'; source: number };
type Span = { start: number; end: number };
type FileSpan = Span & { file: string };
type ActorSpan = Span & { members: Member[] };
type Anchor = {
  text: string;
  candidates: Candidate[];
  waits: boolean;
  completion?: Completion;
  siblingOf?: number;
  afterBranches?: [number, number];
  condition?: VerificationGate;
  verificationCondition?: string;
  prerequisite?: Prerequisite;
  scopeOnly?: string;
  style?: string;
};
type Clause = {
  text: string;
  words: string;
  prose: string;
  files: string[];
  fileSpans: FileSpan[];
  actors: ActorSpan[];
  sibling: boolean;
};

const maxAnchors = 5;
const noMatch = { value: 'no_match', description: 'The request does not support this choice.' };
const scopeToken =
  /(?<![\p{L}\p{M}\p{N}_.:@/\\-])(?:[\p{L}\p{M}\p{N}_.-]+\/)*[\p{L}\p{M}\p{N}_-][\p{L}\p{M}\p{N}_.-]*\.[\p{L}\p{M}\p{N}_-]+(?![\p{L}\p{M}\p{N}_/\\-])/gu;
const clauseBoundary = /(?<=[.!?;])\s+|[\r\n]+/u;
const bulletMarker = /^(?:[-*•]|\d{1,2}[.)])\s+/u;
const workJunction =
  /[,;]\s*(?:(?:và|va|còn|con|and|while)\s+)?|\s+(?:và|va|còn|con|and|while)\s+/giu;
const operations = {
  write:
    /\b(?:sua|viet|ghi|chinh|bo sung|cap nhat|tao|them|phu trach|lam|soan|chot|thiet ke|rut gon|tinh gian|build|prepare|create|edit|fix|update|implement|write|correct|add|draft|design|adjust|rename|refactor|change|modify|record|revise|shorten)\b/u,
  read: /\b(?:doc|ra|kiem tra|xac minh|doi chieu|xem|coi|inspect|read|check|verify)\b/u,
  review: /\b(?:review|ra soat|kiem tra|inspect|audit)\b/u,
};
const explicitVietnameseEdit = /(?<!\p{L})(?:đổi|điều chỉnh|thay đổi|chỉnh lại)(?!\p{L})/iu;
const scopedHandoff = /\b(?:lo|handle|take care of)\s*$/u;
const boundedAssignment = /\b(?:gets?|receives?|takes?) (?:only|just)\s*$/u;
const beforeBothStart =
  /^(?:start neither|do not (?:start|begin) (?:either|both)|neither (?:implementation|write|edit|implementation job) may (?:start|begin))(?<target>[^,;]*?)(?:until|before) (?<source>[^,;]+)$/u;
const implementationGroup =
  /\b(?:implementation|implementation jobs|implementation branches|edits|writes)\b/u;
const implementationTarget =
  /^(?:(?:of (?:the )?)?(?:two )?(?:parallel )?(?:implementation(?: (?:jobs|branches|steps?))?|edits?|writes?))?$/u;
const completedFile =
  /^(?<file>that file|the (?:previous|prior|specified) file|[\p{L}\p{N}_.\/-]+) (?:is |has been )(?:complete|finished|done|ready)$/u;
const assignedScopeOnly =
  /^(?<owners>(?:ca )?hai nguoi|(?:the )?two (?:people|assignees)|both (?:people|assignees))\s+(?:chi (?:sua|chinh|xu ly)|(?:should |may )?only (?:edit|change|work on))\s+(?:the )?(?:tep da giao (?:cho )?(?:minh|tung nguoi|ho)|file assigned (?:to each|to them|for them)|their (?:own|assigned) files?)$/u;
const delegatedWrite =
  /^(?:sade )?(?:(?:hay|please) )?(?:viet|them|bo sung|test|write|implement|add|(?:giao|phan cong|assign) (?:backend|server|api|tests?|bo test)|(?:file|tep) [\p{L}\p{N}_.\/-]+ (?:thi )?(?:doi|cho) .{1,85} (?:moi|roi) (?:viet|them))\b/u;
const delegatedTestRole =
  /\b(?:(?:giao|cho|nho|ask|have|let|assign)|(?:thi|moi|then)) (?:mot |the )?(?:nguoi (?:phu trach |lam )?(?:test|kiem thu)|tester|test owner|qa teammate) (?:them|bo sung|viet|add|write|implement)\b/u;
const gitRead = /\b(?:git|commit|lich su git|revision|tag)\b/u;
const currentFile =
  /\b(?:(?:tep|file) (?:do|nay|ay)|cung (?:tep|file)|dung (?:tep|file) (?:cho|da (?:kiem|doc|nhac))|that file|this file|same file|exact (?:checked|named) file)\b/u;
const conditionalWrite =
  /^(?:neu|chi (?:khi|neu)|only (?:if|after)|if) (?<checker>[\p{L}\p{N}_ '’-]{1,100}?) (?:xac nhan|xac minh|ket luan|bao|confirms|verifies|reports) (?<finding>[^.;,]{1,130}?) *(?:,? +(?:thi (?:moi )?|moi |then )|, +)(?:hay |please )?(?:(?:giao|de|cho|nho|assign|let|ask|have) )?(?<writer>.+)$/u;
const missingFinding =
  /\b(?:chua co|con thieu|chua (?:duoc )?(?:lam|viet)|(?:is|remains) (?:missing|absent)|does not exist|is not (?:present|implemented))\b/u;
const uncertainFinding =
  /\b(?:co the|khong chac|chua chac|chua ro|chua ket luan|chua xac minh|(?:khong co|khong du|chua du) bang chung|maybe|possible|uncertain|unclear|inconclusive|no evidence|not enough evidence|cannot confirm|khong (?:con )?thieu|not missing)\b/u;
const priorCheckOnly =
  /^(?:(?:dung|khoan) (?:sua|viet) truoc khi (?:co ket luan|kiem tra xong)|chua (?:kiem|xac minh) thi (?:khoan|dung) (?:sua|viet)|wait for (?:the )?(?:check|verification|result) before (?:editing|writing))$/u;
const existingCheckStopsWrite =
  /^(?:neu|if) (?:[^,;]{0,60} )?(?:da co|is (?:already )?present|already exists) (?:thi |then )?(?:khoi sua|khong (?:can|duoc) sua|giu nguyen|leave (?:it|the file) unchanged|no changes? (?:needed|required))$/u;
const negativeCheckStop =
  /^(?:(?:neu|if) )?(?<outcomes>[^.;]{1,170}?)(?:,|\bthi\b|\bthen\b) *(?:hay )?(?<action>[^.;]+)$/u;
const protectedOutcome =
  /^(?:(?:(?:chua|khong|dung) (?:duoc )?(?:giao|mo|bat dau|thuc hien)|khoi|khong (?:can|duoc)|skip|do not) (?:buoc |luot |viec |the )?(?:sua|viet|edit|write)(?: (?:file|tep|yet|it))?|(?:chi )?(?:dung|ket thuc)(?: lai)? (?:o|sau) (?:buoc |viec |luot )?(?:kiem tra|xac minh)|stop (?:at|after|with) (?:the )?(?:check|inspection|verification)(?: step)?)$/u;
const noWriteFinding =
  /\b(?:da co|co san|chua (?:ket luan|xac dinh|xac minh|ro|chac)|(?:khong|chua) du bang chung|already present|inconclusive|unclear|uncertain|not enough evidence)\b/u;
const reportCheckOnly =
  /^(?:(?:chi )?bao ket qua (?:kiem tra|xac minh) roi dung|dung sau khi bao ket qua (?:kiem tra|xac minh)|(?:only )?report the (?:check|verification|inspection) results? and stop|stop after reporting the (?:check|verification|inspection) results?)$/u;
const reportCheckOutcomeOnly =
  /^(?:chi bao ket qua (?:kiem tra|xac minh)|only report the (?:check|verification|inspection) results?)$/u;
const noPeerWait =
  /\b(?:khong (?:can|phai) (?:cho|doi) nhau|no need to wait for (?:each|one) another)\b/gu;
const parallelWords =
  /\b(?:parallel|independent(?:ly)?|unrelated (?:edits|changes|tasks|assignments)|(?:start|work|run|go out) together|side by side|at the same time|concurrently|song song|dong thoi|cung luc|doc lap|khong phu thuoc nhau|khong (?:can|phai) (?:cho|doi) nhau|no need to wait for (?:each|one) another)\b/u;
const parallelRequest =
  /^(?:(?:can|could|shall) we |(?:please|let['’]s) )?(?:send|assign) (?:these two|those two|the two|both) (?:out )?together$/u;
const parallelGroupHeading =
  /\b(?:parallel|song song|dong thoi|cung luc|concurrently|at the same time|side by side)\s*:\s*$/u;
const separateGroupStatement =
  /^(?:(?:they(?:['’]re| are)|these are) )?separate (?:edits|changes|tasks|assignments)$/u;
const waitsForWork =
  /\b(?:sau khi|after|once|before|truoc khi|truoc luc|doi (?:[^,.]{1,65} )?(?:xong|hoan tat|san sang|hoan thanh)|cho (?:phan |the )?(?:backend|server|api|contract)|xong [^,.]{1,65} (?:thi|roi|moi)|(?:backend|server|api|frontend|ui|contract|hop dong|quy tac|phan code) (?:xong|hoan tat|san sang) (?:thi|roi|moi)|khi [^,.]{1,65} (?:xong|san sang|hoan tat|hoan thanh)|ban giao .* roi|then|sau do)\b/u;
const previousWork =
  /^(?:xong (?:phan|viec|buoc|tep|file) (?:do|ay)(?: roi)? (?:thi|moi)|(?:sau )?khi (?:phan|viec|buoc|tep|file) (?:do|ay) (?:xong|hoan tat|san sang)|(?:after|once) (?:that|the previous (?:task|step|file)|it) (?:is )?(?:ready|done|complete|finishes))\b/u;
const availableWork =
  /^(?:(?:khi )?co [^,;]{1,70} (?:thi|roi|moi)|once [^,;]{1,70} (?:exists|is available|lands))\b/u;
const actionPermission =
  /^(?:(?:please )?(?:ask|have|assign|let)|(?:xin |hay )?(?:giao|nho|cho|de))\b|\b(?:should|please|dam nhan|chiu trach nhiem|phan cong)\b/u;
const assignFromFile =
  /^[\s,;:–—-]*(?:(?:hay |please )?(?:giao cho|giao|nho|phan cho|assign to|assign|ask|have|let))\b/u;
const readOnlyWords = /\b(?:chi doc|read[ -]only|only read|keep .* unchanged|giu nguyen)\b/u;
const splitWork = /\b(?:chia|tach|split|handoff|ban giao|assignments|parallel|song song)\b/u;
const contextOnly =
  /\b(?:chia|tach|split|handoff|ban giao|two independent assignments|hai viec doc lap|giao (?:dong thoi|song song)|assign (?:two|separate|parallel))\b/u;
const goalPreface =
  /^(?:(?:minh|toi|tui|tui minh|bon minh|nhom minh|chung toi|i|we) (?:can|muon|need|want|would like)|(?:muc tieu|muc dich|the goal|the objective) (?:la|is)) (?<subject>[^,;]{1,110})$/u;
const workflowPreface =
  /^(?:(?:can )?(?:chot|hoan thien|trien khai|len ke hoach) (?:luong|quy trinh|ke hoach)|can chot (?:vu|viec)|(?:finalize|roll out|plan) (?:the )?(?:workflow|flow|rollout|process)) (?<subject>[^,;]{1,100})$/u;
const boundedTail =
  /^(?:(?:keep|limit) each (?:assignee|task) to (?:their |its )?(?:single |one )?(?:listed|specified) file|(?:both|the two) (?:tasks|assignments|changes) (?:can |may )?(?:run|start) in parallel|there(?:['’]s| is) no dependency between (?:these|the) two (?:changes|tasks|assignments)|(?:ca )?hai (?:viec|tac vu) (?:co the )?chay song song(?: duoc)?)$/u;
const mayBeScopeNote =
  /\b(?:each (?:person|one|assignee|task)|moi (?:nguoi|viec|phan)|assigned (?:file|scope)|file duoc giao|tep duoc giao|exact scope)\b/u;
const onlyOwnFiles =
  /^(?:moi (?:nguoi|ben) chi (?:sua|chinh|lam|giu) (?:dung )?(?:tep|file) (?:cua minh|duoc giao|tuong ung)|each (?:person|assignee|teammate) (?:may |should )?(?:only (?:edit|change|work on)|keep to) (?:their |the )?(?:own|assigned|listed) file|(?:ca )?hai (?:nguoi|ben) (?:xu ly|sua|chinh|lam) tung (?:tep|file) (?:rieng|duoc giao|tuong ung)(?:,? va khong (?:can|phai) (?:cho|doi) nhau)?)$/u;
const together =
  /^(?:(?:ca hai |hai (?:viec|nguoi|nhanh) )?(?:(?:co the|se) )?(?:lam|chay|bat dau|xu ly) (?:cung luc|dong thoi|song song)|(?:ca )?hai nhanh song song|(?:(?:they|both|both (?:tasks|people|branches)) )?(?:(?:can|may|will) )?(?:start|run|work) (?:at the same time|together|side by side|in parallel))$/u;
const scopeLimit =
  /^(?:(?:ai cung|moi (?:nguoi|ben)|tung nguoi) (?:thi )?(?:chi (?:dung|sua|chinh|lam|xu ly) (?:dung )?(?:tep|file) (?:cua minh|(?:da|duoc) giao|tuong ung)|giu dung (?:tep|file) duoc giao)|each (?:person|teammate|assignee) (?:may |should )?only (?:touch|edit|change|update|work on) (?:their |the )?(?:own|assigned|listed) file|each (?:person|teammate|assignee) (?:may |should )?(?:get|receive) (?:just|only) the file (?:named|listed|specified) for (?:them|that person)|(?:give|assign) each (?:person|teammate|assignee) (?:just|only) (?:their |the )?(?:own|assigned|listed) file)$/u;
const scopeAssignment =
  /\b(?:get|receive|give|assign|allow|permit|hand|giao|cap|phan cong|mo rong)\b/u;
const reviewOnlyTail =
  /^(?:chi (?:doc|gop y|(?:(?:bao|ghi) )?nhan xet|bao ket qua)(?: thoi)?|(?:read|comments|feedback|report) only|only (?:report|leave|provide) (?:findings|comments|feedback)|(?:dung|khong) (?:sua|chinh) (?:tep|file|gi|trong (?:luot|phan|buoc) (?:review|ra soat))|(?:do not|don't) (?:edit|change|modify) (?:the files?|anything|during (?:the )?review))$/u;
const distributiveScope =
  /^(?:(?:give|assign) (?:them|both) (?:just|only) their own files|(?:give|assign) each (?:just |only )?their own file)$/u;
const readPurpose =
  /^(?:muc dich la|muc tieu la|the (?:goal|purpose|objective) is to) (?:xac nhan|xac dinh|kiem tra|lam ro|confirm|determine|check|verify|establish)\b/u;
const approvalOrHold =
  /\b(?:approval|consent|permission|sign[ -]?off|duyet|phe duyet|bat den xanh|dong y|khoan|de sau|hold off|not yet|chua duoc|ngay mai moi|cho (?:.{1,50} )?xac nhan)\b/u;
const unresolvedContext =
  /\b(?:hoi|ask|nhan|giao|assign|thuc hien|perform|chay|run|bat dau|start|check|doi|defer|later|tomorrow|mai|tuan sau|next week|chon|choose|bo qua|ignore|override|skip|dung|stop|khong|not|neu|if|can|could|maybe)\b/u;
const mixedAuthority =
  /\b(?:push|merge|deploy|publish|upload|delete|xoa|wipe|tai len|gui email|hop nhanh|day len|dua len|secret|password|credentials?|api key|fallback|backup|du phong|het (?:quota|luot|han muc)|macos|macbook|darwin|windows|win32|linux|ubuntu|debian|do not assign|hold off|never start|tam hoan|tam dung|chua (?:duoc |can )?duyet|sau khi (?:duoc )?(?:duyet|dong y)|wait for (?:my |their )?(?:approval|sign[ -]?off)|thay vi|instead of|dinh chinh|correction|change of plan|fyi|for information only)\b/u;
const spareArtifactCopy =
  /\b((?:loi nhac|dong (?:nhac|chu)|nhan|tieu de) (?![^,.!?;]*\b(?:teammate|tai khoan|harness|tro ly|nguoi|quota)\b)[\p{L}\p{N}_ -]{1,70}) du phong(?= (?:trong|o)\s*[.!?;]*$)/u;
const negativeWrite =
  /\b(?:(?:do not|don't|never|khong(?: duoc| can)?|dung) )(?:sua|viet|them|lam|giao|dung|nho|edit|write|build|update|assign)\b/u;
const negativeReview =
  /\b(?:do not|don't|never|khong(?: duoc| can)?|dung|khoi|chua) (?:review|audit|read|ra soat|kiem tra|doc|gop y)\b/u;
const reportOnly =
  /\b(?:da (?:viet|lam|tao|cap nhat|sua|chinh sua|them|phu trach)|already (?:wrote|completed|finished|edited|made)|was (?:assigned|edited|completed))\b/u;
const lookupOnly =
  /\b(?:tham khao|tham chieu|dua tren|based on|according to|refer to|use as reference|for reference only)\b/u;
const another =
  /^(?:(?:va|and) )?(?:(?:cho|de|have|ask) )?(?:(?:mot )?nguoi khac|another (?:person|teammate|engineer)|someone else)\b/u;
const independentReview =
  /\b(?:nguoi (?:khac|khong (?:viet|lam)|chua (?:viet|lam))|reviewer doc lap|nguoi ra soat doc lap|independent reviewer|another reviewer|someone who did not (?:write|implement))\b/u;
const exactPair =
  /\b(?:dung hai (?:file|tep)|chi (?:hai|ca hai) (?:file|tep)|hai (?:file|tep) trien khai|exactly (?:those |the )?two files|only (?:those |the )?two files|both (?:scoped|implementation) files)\b/u;
const exactImplementationPair =
  /\b(?:(?:both|(?:the )?two) implementation (?:files|jobs|branches)|(?:ca )?hai (?:tep|file) trien khai)\b/u;
const fileRole = {
  ui: /\.(?:tsx|jsx|vue|svelte|html|css)$/i,
  server: /(?:^|\/)(?:server|backend|api|services?)\//i,
  tests: /(?:^|\/)(?:tests?|specs?|__tests__)\/|\.(?:test|spec)\.[^/]+$/i,
};
const backendPair =
  /\b(?:(?:ui|frontend|giao dien) (?:va|voi|lan|and) (?:server|backend|api|dich vu|service)|(?:server|backend|api|dich vu|service) (?:va|voi|lan|and) (?:ui|frontend|giao dien))\b/u;
const exactRolePair =
  /\b(?:review|ra soat|kiem tra|audit) (?:dung|chi|exactly|only) (?:the )?(?:ui|frontend|giao dien) (?:va|voi|lan|and) (?:server|backend|api|dich vu|service)\b/u;
const contractRole =
  /\b(?:contract|hop dong|quy uoc|quy tac|qui tac|dieu kien|cau truc|architecture|schema|brief|specification|rules?|policy|guidelines)\b/u;
const backendRole = /\b(?:server|backend|api|dich vu|service)\b/u;
const premiseBoundary = /[,;:]|\b(?:thi|roi|moi|nho|giao|cho|de|then|ask|have|assign|let)\b/u;
const completedSubject = /^(?:xong|sau khi|khi|after|once)\b/u;
const completionPredicate =
  /\b(?:xong|hoan tat|san sang|hoan thanh|done|finished|complete|ready)$/u;
const bothBranchesFinished =
  /^(?:(?:sau )?khi (?:ca )?hai(?: nhanh)? (?:xong|hoan tat|hoan thanh)|(?:after|once) both (?:branches )?(?:are (?:done|complete|finished)|finish))$/u;
const priorCriteria = /^(?:sau )?khi (?:phan )?tieu chi (?:do|ay) (?:xong|hoan tat|hoan thanh)$/u;
const criteriaDocument = /\b(?:tieu chi|chuan|criteria|rubric)\b/u;
const temporalSubject = /^(?:sau khi |khi |after |once )?(?:co |xong |the )?/u;
const styleRequest =
  /\b(?:hoi (?:lai )?(?:toi|minh|tui)|ask (?:me|the requester)) [^.!?;,]{0,70}\b(?:style|phong cach|visual design|giao dien (?:kieu|dang|theo)|kieu (?:giao dien|trinh bay)|how (?:the (?:ui|interface)|it) should look|layout)\b/u;
const requesterStyleChoice =
  /\b(?:(?:toi|minh|tui) (?:chua )?(?:chon|quyet dinh) (?:style|phong cach|kieu giao dien)|(?:i|the requester) (?:choose|pick|decide) (?:the )?(?:style|visual design|layout))\b/u;
const requestRequesterAnswer = /\b(?:hoi (?:lai )?(?:toi|minh|tui)|ask (?:me|the requester))\b/u;
const waitForStyleChoice =
  /\b(?:(?:roi moi|only then|before you) (?:sua|dung|lam|viet|edit|build|implement)|truoc khi (?:thao tac|bat dau|sua|cap nhat)|before (?:editing|making the edit))\b/u;
const declinesStyleQuestion =
  /\b(?:(?:dung|khong (?:can|phai|duoc)) (?:(?:cho|nho|bao) (?:[\p{L}\p{N}_'-]+ ){1,6})?hoi|(?:do not|don't) (?:(?:ask|let|have) (?:[\p{L}\p{N}_'-]+ ){1,6}(?:to )?)?ask|(?:not|no need) to ask)\b/u;
const requesterStyleSignoff =
  /\b(?:(?:and|then) wait for my (?:sign[ -]?off|approval|confirmation)|(?:roi|va) cho (?:toi|minh|tui) xac nhan)[.!?;]?$/u;

const fold = (text: string) => foldSharedSadeName(text).replace(/\s+/gu, ' ').trim();
const evidence = (text: string) => JSON.stringify(redact(text));
const containsWord = (text: string, token: string) =>
  ` ${text.replace(/[^\p{L}\p{N}_ -]/gu, ' ')} `.replace(/\s+/gu, ' ').includes(` ${token} `);
function completionPartition(words: string): Completion | undefined {
  const boundary = premiseBoundary.exec(words);
  if (!boundary) return;
  const premise = words.slice(0, boundary.index).trim();
  if (
    premise &&
    (completedSubject.test(words) || availableWork.test(words) || completionPredicate.test(premise))
  )
    return {
      kind: 'completion',
      premise,
      consequent: words
        .slice(boundary.index)
        .replace(/^[,;:\s]+/u, '')
        .trim(),
    };
}
const waitsForCompletion = (words: string) =>
  waitsForWork.test(words.replace(noPeerWait, '')) || !!completionPartition(words);

function parallelScopeNote(words: string) {
  const clauses = words.split(/\s*[,;]\s*(?:(?:va|and) )?|\s+(?:va|and)\s+/u);
  return clauses.every(
    (clause) => together.test(clause) || scopeLimit.test(clause) || distributiveScope.test(clause),
  );
}

function negativeCheckStopsWrite(words: string) {
  const stop = negativeCheckStop.exec(words)?.groups;
  if (
    !stop ||
    !(
      protectedOutcome.test(stop.action) ||
      reportCheckOnly.test(stop.action) ||
      reportCheckOutcomeOnly.test(stop.action)
    )
  )
    return false;
  return stop.outcomes
    .split(/\s*,?\s+(?:hoac|or|and|va)\s+|\s*,\s*/u)
    .every(
      (condition) =>
        noWriteFinding.test(condition) &&
        !missingFinding.test(condition) &&
        !/\b(?:khong phai|not (?:already )?present|never present)\b/u.test(condition) &&
        !/\b(?:thi|then|giao|assign|sua|viet|edit|write|mo buoc|open the step)\b/u.test(condition),
    );
}

function literalGitRef(text: string, literal: string, at: number) {
  const label = /\b(?:tag|commit|revision|sha)\s*$/iu.exec(text.slice(0, at))?.[0];
  if (!label) return false;
  const quoted = text.slice(at, at + literal.length + 2);
  const revision = requestedSharedVerificationRevision(label + quoted, '\0');
  return revision?.kind === 'tag' || revision?.kind === 'commit';
}

function inspectClause(
  text: string,
  readActors: (text: string) => ActorSpan[],
  sibling = false,
): Clause | undefined {
  const scopeMatches = [...text.matchAll(scopeToken)];
  const matches = scopeMatches.filter((match) => {
    const prefix = fold(text.slice(0, match.index).replace(/\x60$/u, ''));
    return (
      !/\b(?:tag|revision|commit|sha)(?: (?:id|hash))?\s*:?$/u.test(prefix) &&
      (!/\b(?:version|phien ban)$/u.test(prefix) ||
        !/^v?\d+\.\d+\.\d+(?:-[\w.-]+)?$/iu.test(match[0]))
    );
  });
  const files = [...new Set(matches.map(([path]) => path))];
  if (
    !files.every((path) => {
      try {
        return (
          path.length <= 300 && normalizeScope(path) === path && !isPrivateCredentialPath(path)
        );
      } catch {
        return false;
      }
    })
  )
    return;
  const literalText = text.replace(/\x60([^\x60]+)\x60/gu, (token, path: string, at: number) =>
    files.includes(path) || literalGitRef(text, path, at) ? path : token,
  );
  if (literalText.includes('\x60')) return;
  return {
    text,
    files,
    fileSpans: matches.map((match) => ({
      file: match[0],
      start: match.index,
      end: match.index + match[0].length,
    })),
    actors: readActors(
      text
        .replace(scopeToken, (literal) => ' '.repeat(literal.length))
        .replace(/\x60[^\x60]+\x60/gu, (literal) => ' '.repeat(literal.length)),
    ),
    sibling,
    words: fold(literalText).replace(/[.!?;,]+$/u, ''),
    prose: fold(literalText.replace(scopeToken, ' ')),
  };
}

function evidenceClauses(request: string, team: readonly Member[]) {
  const readActors = actorLedger(team);
  const sentences = request
    .split(/[\r\n]+/u)
    .flatMap((line) => line.trim().replace(bulletMarker, '').split(clauseBoundary))
    .map((text) => text.trim())
    .filter(Boolean);
  const clauses: Clause[] = [];
  for (const [index, text] of sentences.entries()) {
    const clause = inspectClause(text, readActors);
    if (!clause) return;
    const { files: paths, fileSpans, words } = clause;
    const lead = text.slice(0, text.indexOf(',') + 1);
    if (
      paths.length === 1 &&
      fileRole.tests.test(paths[0]) &&
      bothBranchesFinished.test(fold(lead.slice(0, -1)))
    ) {
      const end = fileSpans[0].end;
      const joined = /^\s*(?:,\s*)?(?:và|va|and)\s+(.+)$/iu.exec(text.slice(end));
      if (joined) {
        const reviewer = lead + ' ' + joined[1];
        const reviewerWords = fold(reviewer);
        if (
          exactImplementationPair.test(reviewerWords) &&
          namedReviewer(reviewerWords, team) &&
          operations.review.test(reviewerWords) &&
          !operations.write.test(reviewerWords)
        ) {
          const test = inspectClause(text.slice(0, end), readActors);
          const review = inspectClause(reviewer, readActors);
          if (!test || !review) return;
          clauses.push(test, review);
          continue;
        }
      }
    }
    if (
      paths.length !== 2 ||
      fileSpans.length !== 2 ||
      (independentReview.test(words) && operations.review.test(words))
    ) {
      clauses.push(clause);
      continue;
    }
    const explicitParallel =
      parallelWords.test(words) ||
      together.test(fold(sentences[index + 1] ?? '').replace(/[.!?;,]+$/u, ''));
    const left = fileSpans[0].end;
    const right = fileSpans[1].start;
    const junctions = [...text.slice(left, right).matchAll(workJunction)];
    let pieces: [Clause, Clause] | undefined;
    for (const junction of junctions.reverse()) {
      const position = left + junction.index;
      const next = text.slice(position + junction[0].length).trim();
      const following = fold(next.replace(scopeToken, ' '));
      const prior = text.slice(0, position).trim();
      const priorWords = fold(prior.replace(scopeToken, ' '));
      const priorActor = oneMember(completionPartition(priorWords)?.consequent ?? priorWords, team);
      const nextActor = oneMember(following, team);
      if (
        priorActor &&
        (nextActor || another.test(following)) &&
        (operations.write.test(following) ||
          operations.read.test(following) ||
          actionPermission.test(following) ||
          (explicitParallel &&
            boundedAssignment.test(fold(text.slice(position + junction[0].length, right)))) ||
          scopedHandoff.test(fold(text.slice(position + junction[0].length, right))))
      ) {
        const parsedPrior = inspectClause(prior, readActors);
        const parsedNext = inspectClause(
          next,
          readActors,
          explicitParallel && !waitsForCompletion(following) && !availableWork.test(following),
        );
        if (!parsedPrior || !parsedNext) return;
        pieces = [parsedPrior, parsedNext];
        break;
      }
    }
    clauses.push(...(pieces ?? [clause]));
  }
  for (const [index, first] of clauses.entries()) {
    const colon = first.text.indexOf(':');
    if (
      colon < 0 ||
      !/;$/u.test(first.text) ||
      !parallelGroupHeading.test(fold(first.text.slice(0, colon + 1)))
    )
      continue;
    const second = clauses[index + 1];
    if (
      !second ||
      first.sibling ||
      second.sibling ||
      waitsForCompletion(second.prose) ||
      scopesOverlap(first.files, second.files)
    )
      return;
    const firstActor = explicitWriter(first, team);
    const secondActor = explicitWriter(second, team);
    if (
      firstActor &&
      secondActor &&
      parallelGroupHeading.test(fold(first.text.slice(0, firstActor.start))) &&
      fold(firstActor.member.owner) !== fold(secondActor.member.owner) &&
      !(/;$/u.test(second.text) && clauses[index + 2]?.files.length)
    )
      second.sibling = true;
    else return;
  }
  return clauses;
}

function qualifiedActorNames(member: Member) {
  const name = fold(member.name);
  const owner = fold(member.owner);
  return [
    `${name} cua ${owner}`,
    `${name} ben ${owner}`,
    `${name} thuoc ${owner}`,
    `${name} from ${owner}`,
    `${owner} dung ${name}`,
    `${owner} su dung ${name}`,
    `${owner} chay ${name}`,
    `${owner} uses ${name}`,
    `${owner}'s ${name}`,
    `${owner}’s ${name}`,
    ...(member.ownedByRequester ? [`${name} cua toi`, `${name} cua minh`, `my ${name}`] : []),
  ];
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

function foldWithSpans(text: string) {
  let words = '';
  const spans: Span[] = [];
  for (const match of text.matchAll(/\s+|\P{M}\p{M}*|\p{M}+/gu)) {
    const value = /\s/u.test(match[0]) ? (words ? ' ' : '') : fold(match[0]);
    words += value;
    for (let index = 0; index < value.length; index++)
      spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return { words: words.trimEnd(), spans };
}

function actorLedger(team: readonly Member[]) {
  const byAlias = new Map<string, Member[]>();
  for (const member of team) {
    for (const alias of new Set([fold(member.name), ...qualifiedActorNames(member)])) {
      const members = byAlias.get(alias) ?? [];
      members.push(member);
      byAlias.set(alias, members);
    }
  }
  if (!byAlias.size) return () => [];
  const names = [...byAlias.keys()].sort((left, right) => right.length - left.length);
  const matcher = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${names.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_])`,
    'gu',
  );
  return (text: string) => {
    const { words, spans } = foldWithSpans(text);
    return [...words.matchAll(matcher)].map((match) => ({
      start: spans[match.index].start,
      end: spans[match.index + match[0].length - 1].end,
      members: byAlias.get(match[0])!,
    }));
  };
}

function withoutKnownActors(team: readonly Member[]) {
  const names = [...new Set(team.flatMap(qualifiedActorNames))].sort((a, b) => b.length - a.length);
  const qualified = names.length
    ? new RegExp(
        `(?<![\\p{L}\\p{N}_])(?:${names.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_])`,
        'gu',
      )
    : undefined;
  return (text: string) => (qualified ? text.replace(qualified, 'teammate') : text);
}

function namedMembers(words: string, team: readonly Member[]) {
  const matches = team.filter(({ name }) => containsWord(words, fold(name)));
  const alias = new Set(matches.map(({ name }) => fold(name)));
  if (alias.size !== 1) return [];
  const [name] = alias;
  const withOwner = matches.filter((member) =>
    qualifiedActorNames(member).some((qualified) => ` ${words} `.includes(` ${qualified} `)),
  );
  const escaped = escapeRegExp(name);
  const qualifier = new RegExp(
    `(?:\\b${escaped} (?:cua|ben|thuoc|from) |(?:['’]s|\\b(?:dung|su dung|chay|uses)) ${escaped}(?![\\p{L}\\p{N}_]))`,
    'u',
  );
  if (withOwner.length) return withOwner;
  return qualifier.test(words) ? [] : matches;
}

function oneMember(words: string, team: readonly Member[]) {
  const members = namedMembers(words, team);
  if (members.length === 1) return members[0];
}

function singleFileAction(clause: Clause, team: readonly Member[]) {
  if (clause.fileSpans.length !== 1) return;
  const { start, end } = clause.fileSpans[0];
  const originalBefore = clause.text.slice(0, start).replace(/\x60$/u, '');
  const originalAfter = clause.text.slice(end).replace(/^\x60/u, '');
  const beforeFolded = foldWithSpans(originalBefore);
  const before = beforeFolded.words;
  const after = fold(originalAfter);
  const fileFirst = assignFromFile.test(after);
  const completion = completionPartition(before);
  const action = fileFirst ? after : (completion?.consequent ?? before);
  const actionStart = fileFirst
    ? clause.text.length - originalAfter.length
    : completion
      ? (beforeFolded.spans[before.lastIndexOf(completion.consequent)]?.start ?? start)
      : 0;
  const actionEnd = fileFirst ? clause.text.length : start;
  const actors = clause.actors.filter(
    (actor) => actor.start >= actionStart && actor.end <= actionEnd,
  );
  const current = oneMember(action, team);
  const member =
    current &&
    actors.length &&
    actors.every(({ members }) => members.some(({ id }) => id === current.id))
      ? current
      : undefined;
  return {
    before,
    after,
    action,
    originalAction: clause.text.slice(actionStart, actionEnd),
    member,
    fileFirst,
    completion,
    actorStart: actors[0]?.start,
  };
}

function explicitWriter(clause: Clause, team: readonly Member[]) {
  const action = singleFileAction(clause, team);
  if (
    action?.member?.allowWrites &&
    action.actorStart !== undefined &&
    operations.write.test(action.action) &&
    !operations.read.test(action.action)
  )
    return { member: action.member, start: action.actorStart };
}

function distinctScopedWriters(anchors: Anchor[]) {
  if (anchors.length !== 2) return false;
  const [first, second] = anchors.map(({ candidates }) => candidates[0]);
  return (
    anchors.every(({ candidates }) =>
      candidates.every(
        ({ kind, member, scope }) => kind === 'code' && !!member && scope.length === 1,
      ),
    ) &&
    fold(first.member!.owner) !== fold(second.member!.owner) &&
    !scopesOverlap(first.scope, second.scope)
  );
}

function namedReviewer(words: string, team: readonly Member[]) {
  const action = words.search(/\b(?:review|ra soat|audit)\b/u);
  if (action < 0) return;
  const before = words.slice(0, action);
  const current = before
    .split(/[,;:]\s*/u)
    .filter((part) => part.trim())
    .at(-1);
  return current ? oneMember(current, team) : undefined;
}

function reviewCandidates(
  text: string,
  words: string,
  paths: string[],
  anchors: Anchor[],
  member?: Member,
) {
  const paired =
    exactImplementationPair.test(words) && !paths.length
      ? anchors.flatMap(({ siblingOf }, index) =>
          siblingOf === undefined ? [] : [[siblingOf, index] as const],
        )
      : [];
  if (
    (!member && !independentReview.test(words)) ||
    !operations.review.test(words) ||
    !(exactPair.test(words) || exactRolePair.test(words) || paired.length === 1)
  )
    return [];
  const afterWitness = words.replace(
    /\bnguoi (?:khong|chua) (?:viet|lam) (?:ca )?hai (?:phan|file|tep|hang muc)(?: do| nay| ay)?\b/u,
    'independent reviewer',
  );
  if (
    negativeWrite.test(afterWitness) ||
    negativeReview.test(afterWitness) ||
    approvalOrHold.test(afterWitness)
  )
    return [];
  if (
    /\b(?:also|plus|doc them|kiem tra them|toan bo|review all|va sua|and edit|roi sua)\b/u.test(
      words,
    )
  )
    return [];
  const pairs: Candidate[] = [];
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      const [first] = anchors[i].candidates;
      const [second] = anchors[j].candidates;
      if (first.kind !== 'code' || second.kind !== 'code') continue;
      const scope = [...first.scope, ...second.scope];
      const exactPaths = paths.length === 2 && scope.every((path) => paths.includes(path));
      const explicitImplementation =
        paired.length === 1 &&
        paired[0][0] === i &&
        paired[0][1] === j &&
        !scope.some((path) => fileRole.tests.test(path));
      const explicitRoles =
        !paths.length &&
        backendPair.test(words) &&
        scope.some((path) => fileRole.ui.test(path)) &&
        scope.some((path) => fileRole.server.test(path)) &&
        !scope.some((path) => fileRole.tests.test(path));
      const namedFiles = scope.every((path) => {
        const basename = path.split('/').at(-1)!;
        return [basename, basename.replace(/\.[^.]+$/u, '')].some((name) =>
          containsWord(text.toLowerCase(), name.toLowerCase()),
        );
      });
      if (
        exactPaths ||
        explicitImplementation ||
        explicitRoles ||
        (namedFiles &&
          paths.every((path) => scope.some((candidate) => candidate.endsWith('/' + path))))
      )
        pairs.push({ kind: 'review', scope, member, reviewed: [i, j] });
    }
  }
  return pairs;
}

function findAnchors(delivery: SharedDelivery) {
  const { team } = delivery;
  const request = delivery.request.trim().normalize('NFC');
  if (
    request.length > 1200 ||
    /["'“”‘’«»<>\\]|:\/\/|(?:^|[\s(])(?:[a-z]:)?\//iu.test(
      request.replace(/(?<=\p{L})['’](?:s|m|re|ve|ll|d)(?=\s|[.,!?;]|$)/giu, ''),
    )
  )
    return;
  const clauses = evidenceClauses(request, team);
  if (!clauses || clauses.length < 2 || clauses.length > 8) return;
  if (
    !splitWork.test(fold(request)) &&
    !clauses.some(
      ({ prose, words }) =>
        waitsForCompletion(prose) ||
        gitRead.test(prose) ||
        parallelWords.test(prose) ||
        parallelRequest.test(words),
    )
  )
    return;
  const anchors: Anchor[] = [];
  const context: string[] = [];
  const controlWords = withoutKnownActors(team);
  const implementationPrerequisites = new Map<number, Prerequisite>();
  let style: string | undefined;
  for (const [index, clause] of clauses.entries()) {
    const { text, sibling, files: paths, words, prose } = clause;
    const styleRequestHere =
      !paths.length &&
      (styleRequest.test(words) ||
        (requesterStyleChoice.test(words) && requestRequesterAnswer.test(words))) &&
      (waitsForCompletion(words) || waitForStyleChoice.test(words));
    const control = controlWords(
      styleRequestHere ? prose.replace(requesterStyleSignoff, '') : prose,
    );
    if (
      mixedAuthority.test(paths.length === 1 ? control.replace(spareArtifactCopy, '$1') : control)
    )
      return;
    const beforeBoth = beforeBothStart.exec(words)?.groups;
    if (beforeBoth) {
      const wait = completedFile.exec(beforeBoth.source)?.groups?.file;
      const producer = anchors.length - 1;
      const file = anchors[producer]?.candidates[0]?.scope[0];
      const deictic = wait === 'that file' || wait?.startsWith('the ');
      const match = wait && (deictic ? anchors.length === 1 : fold(file ?? '') === wait);
      const next = clauses[index + 1];
      const secondary = clauses[index + 2];
      if (
        !match ||
        !file ||
        !implementationTarget.test(beforeBoth.target.trim()) ||
        !implementationGroup.test(words.slice(0, words.length - beforeBoth.source.length)) ||
        (paths.length > 0 && (paths.length !== 1 || paths[0] !== file)) ||
        anchors[producer].candidates.some(
          (candidate) =>
            candidate.kind !== 'code' ||
            candidate.scope.length !== 1 ||
            candidate.scope[0] !== file,
        ) ||
        !next ||
        next.files.length !== 1 ||
        next.sibling ||
        !secondary?.sibling ||
        secondary.files.length !== 1 ||
        implementationPrerequisites.has(index + 1)
      )
        return;
      const attached: Prerequisite = {
        kind: 'prior-file-completion',
        producer,
        file,
        evidence: text,
      };
      implementationPrerequisites.set(index + 1, attached);
      implementationPrerequisites.set(index + 2, attached);
      context.push(text);
      continue;
    }
    if (!paths.length && (assignedScopeOnly.test(words) || distributiveScope.test(words))) {
      if (!distinctScopedWriters(anchors)) return;
      for (const anchor of anchors) anchor.scopeOnly = text;
      context.push(text);
      continue;
    }
    if (!paths.length && separateGroupStatement.test(words)) {
      if (!distinctScopedWriters(anchors) || anchors.some(({ waits }) => waits)) return;
      context.push(text);
      continue;
    }
    const prior = anchors.length === 1 ? anchors[0] : undefined;
    const read = prior?.candidates.find(({ kind }) => kind === 'research');
    if (
      !paths.length &&
      prior &&
      read &&
      prior.candidates.every(({ kind }) => kind === 'research') &&
      readPurpose.test(words) &&
      !negativeWrite.test(prose) &&
      !approvalOrHold.test(prose) &&
      !operations.write.test(prose)
    ) {
      prior.text += ' ' + text;
      continue;
    }
    if (prior && read && paths.every((file) => file === read.scope[0])) {
      const condition = conditionalWrite.exec(words)?.groups;
      if (condition) {
        const checker =
          oneMember(condition.checker, team) ??
          (read.member && fold(condition.checker) === fold(read.member.name)
            ? read.member
            : undefined);
        const writer = oneMember(condition.writer, team);
        if (
          !checker ||
          checker.id !== read.member?.id ||
          !missingFinding.test(condition.finding) ||
          uncertainFinding.test(condition.finding) ||
          approvalOrHold.test(condition.finding) ||
          !requestedSharedVerificationRevision(prior.text, read.scope[0]) ||
          !writer?.allowWrites ||
          (!paths.length && !currentFile.test(condition.writer)) ||
          !operations.write.test(condition.writer) ||
          negativeWrite.test(controlWords(condition.writer))
        )
          return;
        anchors.push({
          text,
          candidates: [{ kind: 'code', scope: read.scope, member: writer }],
          waits: true,
          condition: { kind: 'verified-missing', source: 0 },
        });
        prior.verificationCondition = text;
        continue;
      }
    }
    if (
      index === clauses.length - 1 &&
      !paths.length &&
      (boundedTail.test(words) ||
        onlyOwnFiles.test(words) ||
        (mayBeScopeNote.test(words) &&
          !scopeAssignment.test(prose) &&
          !operations.write.test(prose) &&
          !operations.read.test(prose) &&
          !approvalOrHold.test(prose)) ||
        (anchors.some(({ condition }) => condition !== undefined) &&
          (priorCheckOnly.test(words) || existingCheckStopsWrite.test(words))))
    ) {
      context.push(text);
      continue;
    }
    if (!paths.length && anchors.length >= 2 && parallelScopeNote(words)) {
      context.push(text);
      continue;
    }
    if (!paths.length && mayBeScopeNote.test(words) && scopeAssignment.test(prose)) return;
    if (
      !paths.length &&
      anchors.some(({ condition }) => condition !== undefined) &&
      negativeCheckStopsWrite(words)
    ) {
      context.push(text);
      continue;
    }
    if (styleRequestHere && !style) {
      if (declinesStyleQuestion.test(words) || approvalOrHold.test(control)) return;
      style = text;
      context.push(text);
      continue;
    }
    if (
      !paths.length &&
      index === 0 &&
      (contextOnly.test(words) || parallelWords.test(words) || parallelRequest.test(words)) &&
      !negativeWrite.test(prose) &&
      !approvalOrHold.test(prose) &&
      !/\b(?:da lam|da giao|already|quoted|example|hypothetical)\b/u.test(words)
    ) {
      context.push(text);
      continue;
    }
    const goalWords =
      !paths.length && index === 0
        ? fold(text.replace(/(?<!\p{L})nhận(?=\s)/giu, ' ')).replace(/[.!?;,]+$/u, '')
        : undefined;
    const subject =
      goalWords &&
      (goalPreface.exec(goalWords) ?? workflowPreface.exec(goalWords))?.groups?.subject;
    if (
      subject &&
      !unresolvedContext.test(subject) &&
      !approvalOrHold.test(subject) &&
      !/\b(?:gui|send|thong bao|announce)\b/u.test(subject) &&
      !operations.write.test(subject) &&
      !operations.read.test(subject) &&
      !operations.review.test(subject) &&
      !team.some(({ name }) => containsWord(subject, fold(name)))
    ) {
      context.push(text);
      continue;
    }
    if (
      !paths.length &&
      parallelWords.test(words) &&
      !scopeAssignment.test(control) &&
      !negativeWrite.test(prose) &&
      !approvalOrHold.test(prose) &&
      !operations.read.test(prose.replace(/\bdoc lap\b/gu, '')) &&
      !operations.write.test(prose) &&
      !operations.review.test(prose) &&
      !waitsForCompletion(prose)
    ) {
      context.push(text);
      continue;
    }
    const reviewMember = namedReviewer(prose, team);
    if ((independentReview.test(words) || reviewMember) && operations.review.test(words)) {
      const candidates = reviewCandidates(text, words, paths, anchors, reviewMember);
      const reviewTail = clauses.slice(index + 1);
      if (
        !candidates.length ||
        !waitsForCompletion(words) ||
        reviewTail.some(({ words, files }) => files.length > 0 || !reviewOnlyTail.test(words))
      )
        return;
      const [reviewed] = candidates;
      const completion = completionPartition(words);
      const afterBranches =
        candidates.length === 1 &&
        reviewed.reviewed &&
        anchors[reviewed.reviewed[1]].siblingOf === reviewed.reviewed[0] &&
        completion &&
        bothBranchesFinished.test(completion.premise)
          ? reviewed.reviewed
          : undefined;
      if (reviewTail.length) {
        anchors.push({
          text: [text, ...reviewTail.map(({ text }) => text)].join(' '),
          candidates,
          waits: true,
          afterBranches,
        });
        break;
      }
      anchors.push({ text, candidates, waits: true, afterBranches });
      continue;
    }
    if (negativeWrite.test(control) || reportOnly.test(control) || approvalOrHold.test(control))
      return;
    if (
      !paths.length &&
      !scopeAssignment.test(control) &&
      !unresolvedContext.test(prose) &&
      !waitsForCompletion(prose) &&
      !operations.read.test(prose) &&
      !operations.write.test(prose) &&
      !operations.review.test(prose) &&
      !team.some(({ name }) => containsWord(prose, fold(name)))
    ) {
      context.push(text);
      continue;
    }
    if (paths.length !== 1 || /\b(?:neu|if|unless|tru khi|hoac|otherwise)\b/u.test(prose)) return;
    const [file] = paths;
    const window = singleFileAction(clause, team);
    if (!window) return;
    const { before, after, fileFirst, completion, action, member, originalAction } = window;
    const inlineStyle = /^[,\s]*(?:nhung|but) (?<ask>.+)$/u.exec(after)?.groups?.ask;
    const styleCheckpoint =
      inlineStyle &&
      fileRole.ui.test(file) &&
      styleRequest.test(inlineStyle) &&
      waitForStyleChoice.test(inlineStyle) &&
      !declinesStyleQuestion.test(inlineStyle) &&
      !unresolvedContext.test(inlineStyle.replace(/\b(?:hoi|ask|chon|choose)\b/gu, ''))
        ? text
        : undefined;
    if (inlineStyle && styleRequest.test(inlineStyle) && !styleCheckpoint) return;
    if (
      fileFirst &&
      (operations.write.test(before) ||
        operations.read.test(before) ||
        team.some(({ name }) => containsWord(before, fold(name))))
    )
      return;
    if (
      !member &&
      team.some(({ name }) => containsWord(completion?.consequent ?? prose, fold(name)))
    )
      return;
    const siblingOf = sibling && anchors.length ? anchors.length - 1 : undefined;
    const attached = implementationPrerequisites.get(index);
    const prerequisite = siblingOf === undefined ? attached : undefined;
    const parallelPredecessor = anchors.at(-1)?.siblingOf;
    const afterBranches: Anchor['afterBranches'] =
      completion &&
      bothBranchesFinished.test(completion.premise) &&
      parallelPredecessor !== undefined &&
      fileRole.tests.test(file) &&
      [anchors[parallelPredecessor], anchors.at(-1)!].every(({ candidates }) =>
        candidates.every(({ kind, scope }) => kind === 'code' && !fileRole.tests.test(scope[0])),
      )
        ? [parallelPredecessor, anchors.length - 1]
        : undefined;
    const ordered = !!attached || waitsForCompletion(prose) || availableWork.test(prose);
    const writesAlongside =
      siblingOf !== undefined && anchors[siblingOf].candidates.some(({ kind }) => kind === 'code');
    const handoffAction = writesAlongside && !!member && scopedHandoff.test(action);
    const scopedImplementation =
      !!attached &&
      boundedAssignment.test(action) &&
      !operations.read.test(prose) &&
      !lookupOnly.test(prose);
    const writeWords =
      operations.write.test(action) ||
      scopedImplementation ||
      (!completion && explicitVietnameseEdit.test(originalAction));
    const readWords =
      operations.read.test(action.replace(/\bra\b/gu, '')) ||
      (gitRead.test(prose) && operations.read.test(action));
    const assignmentFrame = member && (fileFirst || actionPermission.test(action));
    const mandatoryRead = readOnlyWords.test(prose) || (readWords && gitRead.test(prose));
    const explicitTestInstruction =
      fileRole.tests.test(file) &&
      (/\b(?:moi|then) (?:viet|them|write|add)\b/u.test(after) ||
        (ordered &&
          (/\b(?:thi|moi|roi|then) (?:viet|them|bo sung|write|add)\b/u.test(before) ||
            delegatedTestRole.test(before))));
    const anonymousAlternative = sibling && another.test(words);
    const candidates: Candidate[] = [];
    if (
      !lookupOnly.test(before) &&
      !lookupOnly.test(action) &&
      (writeWords || explicitTestInstruction || assignmentFrame || handoffAction) &&
      (member
        ? member.allowWrites
        : anonymousAlternative || delegatedWrite.test(words) || explicitTestInstruction) &&
      !mandatoryRead &&
      (!readWords || assignmentFrame)
    )
      candidates.push({
        kind: 'code',
        scope: [file],
        member,
        ...((!writeWords && !explicitTestInstruction) || readWords
          ? { needsWriteConfirmation: true }
          : {}),
      });
    if (member && (readWords || mandatoryRead || (assignmentFrame && !writeWords)))
      candidates.push({ kind: 'research', scope: [file], member });
    if (
      !candidates.length ||
      (attached && candidates.some(({ kind, member }) => kind !== 'code' || !member))
    )
      return;
    anchors.push({
      text,
      candidates,
      waits: ordered || (siblingOf !== undefined && anchors[siblingOf].waits),
      completion,
      prerequisite,
      siblingOf,
      afterBranches,
      style: styleCheckpoint,
    });
  }
  if (anchors.length < 2 || anchors.length > maxAnchors) return;
  if (style) {
    const frontend = anchors.filter(({ candidates }) =>
      candidates.some(({ kind, scope }) => kind === 'code' && fileRole.ui.test(scope[0])),
    );
    if (frontend.length !== 1 || frontend[0].style) return;
    const styleWords = fold(style);
    const named = oneMember(styleWords, team);
    if (named && !frontend[0].candidates.some(({ member }) => member?.id === named.id)) return;
    frontend[0].style = style;
  }
  return { anchors, context };
}

const nodeQuestion = (index: number) => `graph_step_${index + 1}`;
const writeQuestion = (index: number) => `graph_write_${index + 1}`;
const candidateName = (candidate: Candidate, index: number) => `${candidate.kind}_${index + 1}`;
const coverage = 'graph_complete';

function canDependOn(anchors: Anchor[], from: number, to: number, team: readonly Member[]) {
  const destination = anchors[to];
  const source = anchors[from];
  if (from === to || source.candidates[0].kind === 'review') return false;
  if (destination.candidates[0].kind === 'review')
    return destination.candidates.some(({ reviewed }) => reviewed?.includes(from));
  if (source.siblingOf === to) return false;
  const clause = fold(destination.text.replace(scopeToken, ' '));
  if (previousWork.test(clause)) return from === to - 1;
  const completion = destination.completion ?? completionPartition(clause);
  const premise = completion?.premise ?? clause;
  const [path] = source.candidates[0].scope;
  const sourceClause = fold(source.text.replace(scopeToken, ' '));
  if (priorCriteria.test(premise))
    return (
      to === 1 &&
      from === 0 &&
      /\.mdx?$/iu.test(path) &&
      criteriaDocument.test(fold(source.text)) &&
      source.candidates.every(({ kind }) => kind === 'code')
    );
  if (completion && team.some(({ name }) => containsWord(premise, fold(name)))) {
    const earlierActors = [
      ...new Map(
        anchors
          .slice(0, to)
          .flatMap(({ candidates }) =>
            candidates.flatMap(({ member }) => (member ? [[member.id, member] as const] : [])),
          ),
      ).values(),
    ];
    const witness = oneMember(premise, team) ?? oneMember(premise, earlierActors);
    if (
      !witness ||
      from >= to ||
      !source.candidates.some(({ member }) => member?.id === witness.id)
    )
      return false;
    if (!contractRole.test(premise) && !backendRole.test(premise)) return true;
  }
  if (contractRole.test(premise)) return !source.waits && contractRole.test(sourceClause);
  if (backendRole.test(premise)) return fileRole.server.test(path) && !fileRole.tests.test(path);
  const explicitSubject = completion?.premise
    ?.replace(temporalSubject, '')
    .replace(completionPredicate, '')
    .trim();
  if (explicitSubject && explicitSubject.length > 3 && containsWord(sourceClause, explicitSubject))
    return true;
  const basename = path
    .split('/')
    .at(-1)!
    .replace(/\.[^.]+$/u, '');
  return containsWord(premise, fold(basename)) || (!completion && anchors.length === 2);
}

function compileGraph(
  anchors: Anchor[],
  selected: Candidate[],
  links: number[][],
  delivery: SharedDelivery,
) {
  const { team } = delivery;
  for (const [i, anchor] of anchors.entries()) {
    const candidate = selected[i];
    const parents = links[i];
    const sibling = anchor.siblingOf;
    if (anchor.style && candidate.kind !== 'code') return;
    if (
      anchor.scopeOnly &&
      (candidate.kind !== 'code' || !candidate.member || candidate.scope.length !== 1)
    )
      return;
    if (candidate.reviewed) {
      if (
        candidate.reviewed.some(
          (writer) => !parents.includes(writer) || selected[writer].kind !== 'code',
        ) ||
        parents.length !== 2
      )
        return;
      const authors = candidate.reviewed.map((writer) => selected[writer].member?.owner);
      const independent = (member: Member) =>
        !authors.some((author) => fold(author ?? '') === fold(member.owner));
      if (candidate.member ? !independent(candidate.member) : !team.some(independent)) return;
    } else if (anchor.afterBranches) {
      if (
        candidate.kind !== 'code' ||
        parents.length !== 2 ||
        anchor.afterBranches.some(
          (branch) => !parents.includes(branch) || selected[branch].kind !== 'code',
        )
      )
        return;
    } else if (anchor.condition !== undefined) {
      if (
        parents.length !== 1 ||
        parents[0] !== anchor.condition.source ||
        selected[anchor.condition.source].kind !== 'research'
      )
        return;
    } else if (anchor.prerequisite) {
      const { producer, file } = anchor.prerequisite;
      if (
        parents.length !== 1 ||
        parents[0] !== producer ||
        candidate.kind !== 'code' ||
        selected[producer].kind !== 'code' ||
        selected[producer].scope.length !== 1 ||
        selected[producer].scope[0] !== file
      )
        return;
    } else if (sibling !== undefined) {
      if (parents.length || anchor.waits !== anchors[sibling].waits) return;
      links[i] = [...links[sibling]];
      if (candidate.member) continue;
      if (!selected[sibling].member) return;
      const eligible = [
        ...links[sibling].flatMap((parent) => selected[parent].member ?? []),
        ...team,
      ];
      const writer = eligible.find(
        ({ owner, allowWrites }) =>
          allowWrites && fold(owner) !== fold(selected[sibling].member!.owner),
      );
      if (!writer) return;
      selected[i] = { ...candidate, member: writer };
    } else if (anchor.waits ? parents.length !== 1 : parents.length !== 0) return;
  }
  const codes = selected.filter(({ kind }) => kind === 'code');
  if (
    codes.some(({ scope }, i) =>
      codes.slice(i + 1).some(({ scope: other }) => scopesOverlap(scope, other)),
    )
  )
    return;
  const handoffKeys = [
    ['architecture', delivery.handoffAssignments?.producer.scope],
    ['frontend', delivery.handoffAssignments?.receiver.scope],
    ['backend', delivery.handoffDeliverables?.backend.scope],
    ['codebase', delivery.handoffDeliverables?.codebase.scope],
  ] as const;
  const keys = selected.map(
    ({ kind, scope }, i) =>
      (kind === 'code' && handoffKeys.find(([, path]) => path === scope[0])?.[0]) ||
      `step-${i + 1}`,
  );
  const tasks: PlanTask[] = selected.map((candidate, i) => {
    const { kind, scope, member } = candidate;
    const { text, style, condition, verificationCondition, scopeOnly, siblingOf } = anchors[i];
    const gate =
      anchors[i].prerequisite ??
      (siblingOf === undefined ? undefined : anchors[siblingOf].prerequisite);
    const brief = redact(text);
    const action =
      kind === 'code'
        ? 'Thực hiện'
        : kind === 'review'
          ? 'Rà soát độc lập'
          : gitRead.test(fold(text))
            ? 'Kiểm tra Git'
            : 'Đọc và kiểm tra';
    const notes = [
      ...(gate ? [redact(gate.evidence)] : []),
      ...(scopeOnly ? [redact(scopeOnly)] : []),
      ...(verificationCondition
        ? [
            `Xác minh quy tắc được nêu trong điều kiện sau. Đây là tiêu chí kiểm tra, kết quả vẫn phải dựa trên nội dung tại Git revision được chỉ định: ${redact(verificationCondition)}`,
          ]
        : []),
      ...(style
        ? [
            `Before editing, ask the requester which style to use and wait for their choice. ${redact(style)}`,
          ]
        : []),
      ...(condition === undefined
        ? []
        : [
            `Chỉ sửa nếu kết quả kiểm tra xác nhận phần này còn thiếu. Yêu cầu kiểm tra gốc: ${redact(anchors[condition.source].text)}`,
          ]),
      ...(kind === 'review' ? ['Chỉ đọc đúng phạm vi được giao và báo cáo độc lập.'] : []),
      brief,
    ];
    return {
      key: keys[i],
      title: `${action} phần việc ${i + 1}`,
      kind,
      scope,
      description: brief,
      acceptance: notes.join('\n\n'),
      ...(style ? { askBeforeEditing: frontendStyleQuestion } : {}),
      ...(condition === undefined ? {} : { editIfMissingAfter: keys[condition.source] }),
      dependsOn: links[i].map((parent) => keys[parent]),
      effort: kind === 'code' ? 2 : 1,
      stage: kind === 'code' ? 'Implement' : kind === 'review' ? 'Review' : 'Check',
      ...(member ? { preferredMemberId: member.id } : {}),
    };
  });
  try {
    const plan = parseTeamPlan({
      summary: 'Giao các phần việc theo đúng người, phạm vi và thứ tự đã xác minh.',
      tasks,
    });
    const byKey = new Map(plan.tasks.map((task) => [task.key, task]));
    for (const task of plan.tasks) {
      const upstream = collectPrerequisites(task.dependsOn, byKey, (parent) => parent.dependsOn);
      if (task.kind !== 'code' && task.kind !== 'research') continue;
      const conflicting = plan.tasks.find(
        (other) =>
          other.kind === (task.kind === 'code' ? 'research' : 'code') &&
          scopesOverlap(task.scope, other.scope) &&
          !upstream.includes(other) &&
          !collectPrerequisites(other.dependsOn, byKey, (parent) => parent.dependsOn).includes(
            task,
          ),
      );
      if (conflicting) return;
    }
    if (delivery.handoffAssignments)
      assertSharedHandoffPlan(
        plan,
        delivery.handoffAssignments,
        delivery.handoffDeliverables,
        true,
      );
    return { kind: 'plan' as const, plan };
  } catch {
    return;
  }
}

/** Each question selects from a local catalog. No answer becomes an authorization or a task field. */
export function sharedSadeChoiceGraph(delivery: SharedDelivery):
  | {
      questions: SharedSadeChoiceQuestion[];
      candidateSteps: string[][];
      laterRequesterCheckpoint: boolean;
      compile(selections: Record<string, string>): SharedSadeCloudResult | undefined;
    }
  | undefined {
  if (delivery.phase !== 'plan' || delivery.readAssignment || delivery.clarification) return;
  const parsed = findAnchors(delivery);
  if (!parsed) return;
  const { anchors, context } = parsed;
  const candidateSteps = anchors.map(
    ({ candidates, condition, style, prerequisite, siblingOf, afterBranches }) =>
      candidates.map((candidate) =>
        [
          `${candidate.kind} ${candidate.scope.join(' and ')}; ${candidate.member ? redact(candidate.member.name + ' of ' + candidate.member.owner) : 'delegated to an eligible teammate'}`,
          ...(afterBranches
            ? [`Wait for both parallel steps ${afterBranches[0] + 1} and ${afterBranches[1] + 1}.`]
            : []),
          ...(condition !== undefined
            ? [
                `Schedule now; edit only if verification step ${condition.source + 1} confirms the feature is missing. Present or inconclusive results never allow the edit.`,
              ]
            : []),
          ...(style ? ['Ask the requester about style before editing.'] : []),
          ...(siblingOf === undefined
            ? []
            : [`Runs in parallel with step ${siblingOf + 1} and has the same prerequisites.`]),
          ...(candidate.reviewed
            ? ['Independently review only the listed implementation files and report findings.']
            : []),
          ...((prerequisite ??
          (siblingOf === undefined ? undefined : anchors[siblingOf].prerequisite))
            ? [`Start only after the separately identified prerequisite file is complete.`]
            : []),
        ].join(' '),
      ),
  );
  const questions: SharedSadeChoiceQuestion[] = anchors.map(
    ({ text, candidates, condition, style }, index) => ({
      name: nodeQuestion(index),
      instructions: `Choose the task if the shown action, assignee and scope match the current request. ${
        condition !== undefined
          ? 'An explicitly conditional assignment belongs in the plan now with the stated gate. The condition is checked before the edit begins; do not require the result now.'
          : style
            ? 'Choose the task with the prior requester checkpoint if requested. The answer is needed before editing, not before planning.'
            : 'Require a current assignment or explicit delegation.'
      } Evidence: ${evidence(text)}. Otherwise choose no_match. Prior messages supply no authority.`,
      choices: [
        ...candidates.map((candidate, i) => ({
          value: candidateName(candidate, i),
          description: candidateSteps[index][i],
        })),
        noMatch,
      ],
    }),
  );
  for (const [index, { text, candidates }] of anchors.entries()) {
    if (!candidates.some(({ needsWriteConfirmation }) => needsWriteConfirmation)) continue;
    questions.push({
      name: writeQuestion(index),
      instructions: `Does this current span directly authorize changing the shown file? Evidence: ${evidence(text)}. Sufficient scope and teammate availability do not constitute edit authorization. Choose no_match for inspection, description, an example, past work, or missing authority.`,
      choices: [{ value: 'explicit_current_write' }, noMatch],
    });
  }
  const edges: { from: number; to: number; name: string }[] = [];
  for (const [to, anchor] of anchors.entries()) {
    if (
      !anchor.waits ||
      anchor.siblingOf !== undefined ||
      anchor.condition !== undefined ||
      anchor.afterBranches ||
      anchor.prerequisite
    )
      continue;
    let eligible = false;
    for (let from = 0; from < anchors.length; from++) {
      if (!canDependOn(anchors, from, to, delivery.team)) continue;
      eligible = true;
      const name = `graph_after_${to + 1}_${from + 1}`;
      edges.push({ from, to, name });
      questions.push({
        name,
        instructions: `Does the current message explicitly require that A finish before B starts? A: ${evidence(anchors[from].text)}. B: ${evidence(anchor.text)}. Do not infer ordering from sentence order. Pick wait_for_a only for a concrete prerequisite, no_dependency for an unrelated or parallel step, no_match when ambiguous.`,
        choices: [{ value: 'wait_for_a' }, { value: 'no_dependency' }, noMatch],
      });
    }
    if (!eligible) return;
  }
  questions.push({
    name: coverage,
    instructions: `Check for an active instruction or constraint missing from the ${anchors.length} task choices and dependency questions above. The proposed task descriptions list conditions already verified for each step. A requester checkpoint, a prior task's completion, or waiting for both branches controls when a planned task starts. Those conditions do not require an answer before scheduling the plan. Reports, quotations, and explicitly withheld work do not add tasks. Additional current clauses: ${context.map(evidence).join('; ') || '(none)'}. Select no_match only when some current work or constraint has no corresponding choice or condition, or no tasks should be scheduled.`,
    choices: [
      {
        value: 'all_scoped_actions',
        description:
          'The offered task and dependency choices represent all current work and its restrictions.',
      },
      noMatch,
    ],
  });
  if (questions.length > 24) return;
  return {
    questions,
    candidateSteps,
    laterRequesterCheckpoint:
      anchors.some(({ style, waits }) => Boolean(style) && waits) &&
      anchors.some(({ style, waits }) => !style && !waits),
    compile(selections) {
      if (
        selections[coverage] !== 'all_scoped_actions' ||
        questions.some(
          ({ name, choices }) =>
            !choices.some(
              ({ value }) =>
                value === selections[name] &&
                (value !== 'no_match' || name.startsWith('graph_write_')),
            ),
        )
      )
        return;
      const selected = anchors.map(({ candidates }, index) =>
        candidates.find(
          (candidate, i) => candidateName(candidate, i) === selections[nodeQuestion(index)],
        ),
      );
      if (
        selected.some(
          (candidate, i) =>
            !candidate ||
            (candidate.needsWriteConfirmation &&
              selections[writeQuestion(i)] !== 'explicit_current_write'),
        )
      )
        return;
      const links = anchors.map(({ condition, prerequisite, afterBranches }) => {
        if (afterBranches) return [...afterBranches];
        const parent = condition?.source ?? prerequisite?.producer;
        return parent === undefined ? [] : [parent];
      });
      for (const { from, to, name } of edges)
        if (selections[name] === 'wait_for_a') links[to].push(from);
      return compileGraph(anchors, selected as Candidate[], links, delivery);
    },
  };
}

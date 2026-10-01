import type { ErrorCategory, Lesson, PracticeAttempt, StudentProfile } from './types';
import type { MergeSide } from './types';

/** 一次提交记录在并排核对中用到的摘要。 */
export interface MergeAttemptRef {
  id: string;
  lessonId: string;
  submittedAt: string;
  score: number;
  hasFeedback: boolean;
  classifiedErrors: number;
  sentenceCount: number;
}

/** 同一句在两份档案中的未交草稿；任一侧为空字符串视为该侧没有草稿。 */
export interface MergeDraftRow {
  lessonId: string;
  sentenceId: string;
  sentenceLabel: string;
  a: string;
  b: string;
  /** 两边都留有非空答案，归并前必须逐句二选一。 */
  conflict: boolean;
}

export interface MergeLessonRow {
  lessonId: string;
  lessonTitle: string;
  aProgressAt?: string;
  bProgressAt?: string;
  aActiveSentenceId?: string;
  bActiveSentenceId?: string;
  drafts: MergeDraftRow[];
  aAttempts: MergeAttemptRef[];
  bAttempts: MergeAttemptRef[];
  /** 课节（进度或记录）只在一份档案里出现。 */
  onlySide?: MergeSide;
}

export interface MergeErrorSummary {
  totalErrors: number;
  categories: Record<Exclude<ErrorCategory, 'unclassified'>, number>;
}

export interface MergeFeedbackRef {
  attemptId: string;
  lessonId: string;
  lessonTitle: string;
  submittedAt: string;
  feedback: string;
}

export interface MergeComparison {
  a: { id: string; name: string; createdAt: string };
  b: { id: string; name: string; createdAt: string };
  lessons: MergeLessonRow[];
  aErrors: MergeErrorSummary;
  bErrors: MergeErrorSummary;
  aFeedback: MergeFeedbackRef[];
  bFeedback: MergeFeedbackRef[];
}

/** 教师的归并决定：保留哪份，以及每个双草稿句选择哪一侧答案。 */
export interface MergePlan {
  keepSide: MergeSide | null;
  /** 键为 `${lessonId}:${sentenceId}`，仅在 conflict 行上需要。 */
  draftChoices: Record<string, MergeSide>;
  keptName: string;
}

export interface MergeDiffEntry {
  kind: 'meta' | 'lesson' | 'draft' | 'record' | 'feedback';
  text: string;
  side?: MergeSide;
  lessonId?: string;
}

export interface MergeResult {
  merged: StudentProfile;
  removedId: string;
  diffs: MergeDiffEntry[];
}

const CATEGORY_KEYS: Array<Exclude<ErrorCategory, 'unclassified'>> = ['spelling', 'omitted', 'extra', 'punctuation', 'grammar'];

function attemptRef(attempt: PracticeAttempt): MergeAttemptRef {
  const classifiedErrors = attempt.sentenceAttempts
    .flatMap((item) => item.tokens)
    .filter((token) => !token.correct && token.category !== 'unclassified').length;
  return {
    id: attempt.id,
    lessonId: attempt.lessonId,
    submittedAt: attempt.submittedAt,
    score: attempt.score,
    hasFeedback: attempt.teacherFeedback.trim().length > 0,
    classifiedErrors,
    sentenceCount: attempt.sentenceAttempts.length
  };
}

export function summarizeErrors(student: StudentProfile): MergeErrorSummary {
  const categories = { spelling: 0, omitted: 0, extra: 0, punctuation: 0, grammar: 0 };
  let totalErrors = 0;
  for (const token of student.attempts.flatMap((attempt) => attempt.sentenceAttempts).flatMap((item) => item.tokens)) {
    if (token.correct) continue;
    totalErrors += 1;
    if (token.category !== 'unclassified') categories[token.category] += 1;
  }
  return { totalErrors, categories };
}

function feedbackRefs(student: StudentProfile): MergeFeedbackRef[] {
  return student.attempts
    .filter((attempt) => attempt.teacherFeedback.trim().length > 0)
    .map((attempt) => ({
      attemptId: attempt.id,
      lessonId: attempt.lessonId,
      lessonTitle: attempt.lessonTitle,
      submittedAt: attempt.submittedAt,
      feedback: attempt.teacherFeedback
    }));
}

/** 并排核对：课节进度、未交草稿、练习记录、错词分类、教师反馈。 */
export function buildMergeComparison(a: StudentProfile, b: StudentProfile, lessons: Lesson[]): MergeComparison {
  const lessonIndex = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  const lessonIds = new Set<string>([
    ...Object.keys(a.progress),
    ...Object.keys(b.progress),
    ...a.attempts.map((attempt) => attempt.lessonId),
    ...b.attempts.map((attempt) => attempt.lessonId)
  ]);

  const rows: MergeLessonRow[] = [];
  for (const lessonId of lessonIds) {
    const lesson = lessonIndex.get(lessonId);
    const aProgress = a.progress[lessonId];
    const bProgress = b.progress[lessonId];
    const aAttempts = a.attempts.filter((attempt) => attempt.lessonId === lessonId).map(attemptRef);
    const bAttempts = b.attempts.filter((attempt) => attempt.lessonId === lessonId).map(attemptRef);

    const sentenceIds: string[] = [];
    const seen = new Set<string>();
    const pushSentence = (id: string) => {
      if (!seen.has(id)) {
        seen.add(id);
        sentenceIds.push(id);
      }
    };
    lesson?.sentences.forEach((sentence) => pushSentence(sentence.id));
    Object.keys(aProgress?.answers ?? {}).forEach(pushSentence);
    Object.keys(bProgress?.answers ?? {}).forEach(pushSentence);

    const drafts = sentenceIds.map((sentenceId, index) => {
      const answerA = aProgress?.answers[sentenceId] ?? '';
      const answerB = bProgress?.answers[sentenceId] ?? '';
      const label = lesson ? `第 ${index + 1} 句` : sentenceId;
      return {
        lessonId,
        sentenceId,
        sentenceLabel: label,
        a: answerA,
        b: answerB,
        conflict: answerA.trim().length > 0 && answerB.trim().length > 0 && answerA !== answerB
      };
    });

    const inA = !!aProgress || aAttempts.length > 0;
    const inB = !!bProgress || bAttempts.length > 0;
    rows.push({
      lessonId,
      lessonTitle: lesson?.title ?? aAttempts[0]?.lessonId ?? bAttempts[0]?.lessonId ?? lessonId,
      aProgressAt: aProgress?.updatedAt,
      bProgressAt: bProgress?.updatedAt,
      aActiveSentenceId: aProgress?.activeSentenceId,
      bActiveSentenceId: bProgress?.activeSentenceId,
      drafts,
      aAttempts,
      bAttempts,
      onlySide: inA && !inB ? 'a' : inB && !inA ? 'b' : undefined
    });
  }

  // 课节按课程目录顺序排列，目录外的课节排在最后。
  const order = new Map(lessons.map((lesson, index) => [lesson.id, index]));
  rows.sort((left, right) => (order.get(left.lessonId) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.lessonId) ?? Number.MAX_SAFE_INTEGER));

  return {
    a: { id: a.id, name: a.name, createdAt: a.createdAt },
    b: { id: b.id, name: b.name, createdAt: b.createdAt },
    lessons: rows,
    aErrors: summarizeErrors(a),
    bErrors: summarizeErrors(b),
    aFeedback: feedbackRefs(a),
    bFeedback: feedbackRefs(b)
  };
}

/** 默认决定：保留 A 档，双草稿句默认采用保留侧答案，教师可逐项改选。 */
export function defaultPlan(comparison: MergeComparison): MergePlan {
  const draftChoices: Record<string, MergeSide> = {};
  for (const row of comparison.lessons) {
    for (const draft of row.drafts) {
      if (draft.conflict) draftChoices[`${draft.lessonId}:${draft.sentenceId}`] = 'a';
    }
  }
  return { keepSide: 'a', draftChoices, keptName: comparison.a.name };
}

export function validatePlan(comparison: MergeComparison, plan: MergePlan): string | null {
  if (!plan.keepSide) return '请先选定要保留的档案。';
  if (!plan.keptName.trim()) return '归并后的学生姓名不能为空。';
  for (const row of comparison.lessons) {
    for (const draft of row.drafts) {
      if (!draft.conflict) continue;
      const choice = plan.draftChoices[`${draft.lessonId}:${draft.sentenceId}`];
      if (choice !== 'a' && choice !== 'b') return `还有双份草稿未选择：${row.lessonTitle} · ${draft.sentenceLabel}`;
    }
  }
  return null;
}

function latestTime(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/** 档案全部为可 JSON 序列化数据，深拷贝用 JSON 即可避开响应式代理。 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function describeSide(side: MergeSide): string {
  return side === 'a' ? 'A 档' : 'B 档';
}

/**
 * 按决定生成归并档案（纯函数，不落盘）：
 * - 已提交记录按原时间并入，教师反馈和错词分类随原记录保留，仍指回原课节；
 * - 同一课节两边都有未交答案时，逐句采用教师选定的那一份；
 * - 其余课节进度整体并入。
 */
export function executeMerge(plan: MergePlan, keep: StudentProfile, drop: StudentProfile): MergeResult {
  if (plan.keepSide !== 'a' && plan.keepSide !== 'b') throw new Error('merge plan incomplete');
  const keepSide: MergeSide = plan.keepSide;
  const dropSide: MergeSide = keepSide === 'a' ? 'b' : 'a';

  const diffs: MergeDiffEntry[] = [
    { kind: 'meta', text: `保留 ${describeSide(keepSide)}（${keep.name}），并入 ${describeSide(dropSide)}（${drop.name}），归并后姓名为「${plan.keptName.trim()}」。` }
  ];

  // 练习记录：按 id 去重后按原提交时间倒序并入。
  const byId = new Map<string, { attempt: PracticeAttempt; side: MergeSide }>();
  for (const attempt of keep.attempts) byId.set(attempt.id, { attempt, side: keepSide });
  for (const attempt of drop.attempts) {
    if (!byId.has(attempt.id)) byId.set(attempt.id, { attempt, side: dropSide });
  }
  const mergedAttempts = [...byId.values()]
    .sort((left, right) => right.attempt.submittedAt.localeCompare(left.attempt.submittedAt))
    .map((entry) => entry.attempt);
  for (const entry of [...byId.values()].sort((left, right) => left.attempt.submittedAt.localeCompare(right.attempt.submittedAt))) {
    diffs.push({
      kind: 'record',
      side: entry.side,
      lessonId: entry.attempt.lessonId,
      text: `${entry.attempt.lessonTitle} · ${entry.attempt.score} 分 · 提交于 ${entry.attempt.submittedAt}（来自${describeSide(entry.side)}）`
    });
  }
  const keepIds = new Set(keep.attempts.map((attempt) => attempt.id));
  for (const attempt of drop.attempts) {
    if (!keepIds.has(attempt.id) && attempt.teacherFeedback.trim()) {
      diffs.push({ kind: 'feedback', side: dropSide, lessonId: attempt.lessonId, text: `教师反馈随原记录保留：${attempt.lessonTitle}（${attempt.submittedAt}）。` });
    }
  }

  // 课节进度并草稿。
  const progress: StudentProfile['progress'] = {};
  const lessonIds = new Set([...Object.keys(keep.progress), ...Object.keys(drop.progress)]);
  for (const lessonId of lessonIds) {
    const base = keep.progress[lessonId];
    const other = drop.progress[lessonId];
    const chosen: NonNullable<StudentProfile['progress'][string]> = base
      ? clone(base)
      : { answers: {}, activeSentenceId: other!.activeSentenceId, updatedAt: other!.updatedAt };

    if (base && other) {
      for (const [sentenceId, answer] of Object.entries(other.answers)) {
        const key = `${lessonId}:${sentenceId}`;
        const baseAnswer = base.answers[sentenceId] ?? '';
        const bothHave = baseAnswer.trim().length > 0 && answer.trim().length > 0 && baseAnswer !== answer;
        if (!bothHave) {
          // 单边草稿直接补齐，不覆盖保留侧已有答案。
          if (!baseAnswer.trim()) chosen.answers[sentenceId] = answer;
        } else if (plan.draftChoices[key] === dropSide) {
          chosen.answers[sentenceId] = answer;
          diffs.push({ kind: 'draft', side: dropSide, lessonId, text: `${lessonId} 的 ${sentenceId} 句双份草稿选用了${describeSide(dropSide)}答案。` });
        } else {
          diffs.push({ kind: 'draft', side: keepSide, lessonId, text: `${lessonId} 的 ${sentenceId} 句双份草稿选用了${describeSide(keepSide)}答案。` });
        }
      }
    } else if (!base && other) {
      diffs.push({ kind: 'lesson', side: dropSide, lessonId, text: `课节 ${lessonId} 的进度只在${describeSide(dropSide)}，整体并入。` });
    }

    chosen.updatedAt = latestTime(base?.updatedAt, other?.updatedAt) ?? chosen.updatedAt;
    progress[lessonId] = chosen;
  }

  const mergedFrom = [...new Set([...keep.mergedFrom, ...drop.mergedFrom, drop.name])];

  return {
    merged: {
      id: keep.id,
      name: plan.keptName.trim(),
      createdAt: keep.createdAt,
      mergedFrom,
      attempts: mergedAttempts,
      progress
    },
    removedId: drop.id,
    diffs
  };
}

/** 用于导出/统计时按记录 id 去重，避免归并后重复计数。 */
export function deduplicateAttempts(attempts: PracticeAttempt[]): PracticeAttempt[] {
  const seen = new Set<string>();
  return attempts.filter((attempt) => {
    if (seen.has(attempt.id)) return false;
    seen.add(attempt.id);
    return true;
  });
}

export { CATEGORY_KEYS };

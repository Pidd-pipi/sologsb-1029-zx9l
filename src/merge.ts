import type { LessonProgress, PersistedState, PracticeAttempt } from './types';

export type DraftChoice = 'primary' | 'secondary';
export type DraftChoices = Record<string, DraftChoice>;

export interface ProgressConflict {
  lessonId: string;
  lessonTitle: string;
  primary: LessonProgress;
  secondary: LessonProgress;
}

export interface LessonDraftInfo {
  lessonId: string;
  lessonTitle: string;
  answers: Record<string, string>;
  updatedAt: string;
  activeSentenceId: string;
}

export interface AttemptSummary {
  id: string;
  lessonId: string;
  lessonTitle: string;
  courseTitle: string;
  submittedAt: string;
  score: number;
  hasFeedback: boolean;
  classifiedCount: number;
}

export interface StateComparison {
  conflicts: ProgressConflict[];
  primaryOnly: LessonDraftInfo[];
  secondaryOnly: LessonDraftInfo[];
  primaryAttempts: AttemptSummary[];
  secondaryAttempts: AttemptSummary[];
  duplicateAttemptIds: string[];
  primaryFeedbackCount: number;
  secondaryFeedbackCount: number;
  primaryClassifiedCount: number;
  secondaryClassifiedCount: number;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function lessonTitleFor(state: PersistedState, lessonId: string): string {
  for (const course of state.courses) {
    const lesson = course.lessons.find((item) => item.id === lessonId);
    if (lesson) return lesson.title;
  }
  return lessonId;
}

function hasDraft(progress: LessonProgress | undefined): boolean {
  if (!progress) return false;
  return Object.values(progress.answers).some((answer) => (answer ?? '').trim().length > 0);
}

function toDraftInfo(state: PersistedState, lessonId: string, progress: LessonProgress): LessonDraftInfo {
  return {
    lessonId,
    lessonTitle: lessonTitleFor(state, lessonId),
    answers: progress.answers,
    updatedAt: progress.updatedAt,
    activeSentenceId: progress.activeSentenceId
  };
}

function classifiedCountOf(attempts: PracticeAttempt[]): number {
  return attempts
    .flatMap((attempt) => attempt.sentenceAttempts)
    .flatMap((sentence) => sentence.tokens)
    .filter((token) => !token.correct && token.category !== 'unclassified').length;
}

function feedbackCountOf(attempts: PracticeAttempt[]): number {
  return attempts.filter((attempt) => (attempt.teacherFeedback ?? '').trim().length > 0).length;
}

function toAttemptSummary(attempt: PracticeAttempt): AttemptSummary {
  return {
    id: attempt.id,
    lessonId: attempt.lessonId,
    lessonTitle: attempt.lessonTitle,
    courseTitle: attempt.courseTitle,
    submittedAt: attempt.submittedAt,
    score: attempt.score,
    hasFeedback: (attempt.teacherFeedback ?? '').trim().length > 0,
    classifiedCount: attempt.sentenceAttempts
      .flatMap((sentence) => sentence.tokens)
      .filter((token) => !token.correct && token.category !== 'unclassified').length
  };
}

export function compareStates(primary: PersistedState, secondary: PersistedState): StateComparison {
  const conflicts: ProgressConflict[] = [];
  const primaryOnly: LessonDraftInfo[] = [];
  const secondaryOnly: LessonDraftInfo[] = [];

  const lessonIds = new Set<string>([...Object.keys(primary.progress), ...Object.keys(secondary.progress)]);
  for (const lessonId of lessonIds) {
    const primaryProgress = primary.progress[lessonId];
    const secondaryProgress = secondary.progress[lessonId];
    const primaryHas = hasDraft(primaryProgress);
    const secondaryHas = hasDraft(secondaryProgress);
    if (primaryHas && secondaryHas) {
      conflicts.push({
        lessonId,
        lessonTitle: lessonTitleFor(primary, lessonId),
        primary: primaryProgress!,
        secondary: secondaryProgress!
      });
    } else if (primaryHas) {
      primaryOnly.push(toDraftInfo(primary, lessonId, primaryProgress!));
    } else if (secondaryHas) {
      secondaryOnly.push(toDraftInfo(secondary, lessonId, secondaryProgress!));
    }
  }
  const byUpdatedAtDesc = (a: LessonDraftInfo, b: LessonDraftInfo) => +new Date(b.updatedAt) - +new Date(a.updatedAt);
  primaryOnly.sort(byUpdatedAtDesc);
  secondaryOnly.sort(byUpdatedAtDesc);

  const bySubmittedAtDesc = (a: PracticeAttempt, b: PracticeAttempt) => +new Date(b.submittedAt) - +new Date(a.submittedAt);
  const primaryAttempts = [...primary.attempts].sort(bySubmittedAtDesc).map(toAttemptSummary);
  const secondaryAttempts = [...secondary.attempts].sort(bySubmittedAtDesc).map(toAttemptSummary);
  const primaryIds = new Set(primary.attempts.map((attempt) => attempt.id));
  const duplicateAttemptIds = secondary.attempts.map((attempt) => attempt.id).filter((id) => primaryIds.has(id));

  return {
    conflicts,
    primaryOnly,
    secondaryOnly,
    primaryAttempts,
    secondaryAttempts,
    duplicateAttemptIds,
    primaryFeedbackCount: feedbackCountOf(primary.attempts),
    secondaryFeedbackCount: feedbackCountOf(secondary.attempts),
    primaryClassifiedCount: classifiedCountOf(primary.attempts),
    secondaryClassifiedCount: classifiedCountOf(secondary.attempts)
  };
}

// Two copies of the same attempt (e.g. a shared demo record) are folded into one.
// Teacher feedback and token classifications are merged onto the kept attempt while
// its lessonId / sentenceId / token indexes stay untouched, so they still point at
// the original lesson.
function mergeDuplicateAttempts(primary: PracticeAttempt, secondary: PracticeAttempt): PracticeAttempt {
  const out = clone(primary);
  if (!out.teacherFeedback && secondary.teacherFeedback) out.teacherFeedback = secondary.teacherFeedback;
  const secondarySentences = new Map(secondary.sentenceAttempts.map((sentence) => [sentence.sentenceId, sentence]));
  for (const sentence of out.sentenceAttempts) {
    const incoming = secondarySentences.get(sentence.sentenceId);
    if (!incoming) continue;
    const incomingTokens = new Map(incoming.tokens.map((token) => [token.index, token]));
    for (const token of sentence.tokens) {
      const incomingToken = incomingTokens.get(token.index);
      if (!incomingToken) continue;
      if (token.category === 'unclassified' && incomingToken.category !== 'unclassified') token.category = incomingToken.category;
      if (!token.reason && incomingToken.reason) token.reason = incomingToken.reason;
    }
  }
  return out;
}

export function mergeStates(primary: PersistedState, secondary: PersistedState, choices: DraftChoices): PersistedState {
  const merged = clone(primary);

  // Submitted practice records: combine both sides, dedupe by id, keep original lesson
  // references, and sort by submission time.
  const byId = new Map<string, PracticeAttempt>();
  for (const attempt of [...primary.attempts, ...secondary.attempts]) {
    const existing = byId.get(attempt.id);
    if (!existing) {
      byId.set(attempt.id, clone(attempt));
    } else {
      byId.set(attempt.id, mergeDuplicateAttempts(existing, attempt));
    }
  }
  merged.attempts = [...byId.values()].sort((a, b) => +new Date(b.submittedAt) - +new Date(a.submittedAt));

  // Lesson progress / unsent drafts: per-lesson, conflicts only resolve by explicit choice.
  const out: Record<string, LessonProgress> = { ...clone(primary.progress) };
  for (const [lessonId, secondaryProgress] of Object.entries(secondary.progress)) {
    const primaryProgress = out[lessonId];
    const primaryHas = hasDraft(primaryProgress);
    const secondaryHas = hasDraft(secondaryProgress);
    if (primaryHas && secondaryHas) {
      if (choices[lessonId] === 'secondary') out[lessonId] = clone(secondaryProgress);
    } else if (secondaryHas && !primaryHas) {
      out[lessonId] = clone(secondaryProgress);
    } else if (!primaryHas && !secondaryHas && !primaryProgress) {
      out[lessonId] = clone(secondaryProgress);
    }
  }
  merged.progress = out;

  // The course catalog stays as the primary side's; attempts carry their own
  // lessonTitle/courseTitle and keep pointing at the original lesson ids.
  return merged;
}

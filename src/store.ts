import { reactive, watch } from 'vue';
import { createInitialState } from './data';
import { deduplicateAttempts } from './merge';
import type { MergeResult } from './merge';
import type { Lesson, PersistedState, PersistedStateV1, PracticeAttempt, StudentProfile } from './types';

const STORAGE_KEY = 'sologsb-1029-dictation-state-v1';

function isV1State(parsed: unknown): parsed is PersistedStateV1 {
  const value = parsed as PersistedStateV1 | null;
  return !!value && value.schemaVersion === 1 && Array.isArray(value.attempts) && !Array.isArray((value as unknown as PersistedState).students);
}

/** 旧版（单学生）本地数据迁移为 v2 多学生结构，原记录时间与反馈保持不变。 */
function migrateV1(raw: unknown): PersistedState {
  const old = raw as PersistedStateV1;
  const student: StudentProfile = {
    id: 'student-migrated',
    name: '本机学生',
    createdAt: new Date().toISOString(),
    mergedFrom: [],
    attempts: old.attempts,
    progress: old.progress
  };
  return {
    schemaVersion: 2,
    courses: old.courses,
    students: [student],
    activeStudentId: student.id,
    activeLessonId: old.activeLessonId,
    activeSentenceId: old.activeSentenceId,
    theme: old.theme,
    fontScale: old.fontScale,
    role: old.role
  };
}

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isV1State(parsed)) return migrateV1(parsed);
      const state = parsed as unknown as PersistedState;
      if (state.schemaVersion === 2 && Array.isArray(state.students) && state.students.some((student) => student.id === state.activeStudentId)) return state;    }
  } catch {
    // Falls back to the sample course when the local draft is malformed.
  }
  return createInitialState();
}

export const state = reactive<PersistedState>(loadState());

/** 归并事务进行中暂停自动落盘，避免同步写入失败后 watcher 仍刷出半成品状态。 */
let persistGateOpen = true;

export const persist = (): boolean => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
};

watch(state, () => {
  if (persistGateOpen) persist();
}, { deep: true });

export const activeStudent = (): StudentProfile =>
  state.students.find((student) => student.id === state.activeStudentId) ?? state.students[0];

export function setActiveStudent(studentId: string) {
  if (state.students.some((student) => student.id === studentId)) state.activeStudentId = studentId;
}

export const lessons = (): Lesson[] => state.courses.flatMap((course) => course.lessons);
export const lessonById = (id: string): Lesson | undefined => lessons().find((lesson) => lesson.id === id);
export const courseForLesson = (lessonId: string) => state.courses.find((course) => course.id === lessonById(lessonId)?.courseId);

export function setDownloaded(lessonId: string, value: boolean) {
  const lesson = lessonById(lessonId);
  if (lesson) lesson.downloaded = value;
}

export function saveAttempt(attempt: PracticeAttempt) {
  activeStudent().attempts.unshift(attempt);
}

export function updateTokenClassification(attemptId: string, sentenceId: string, tokenIndex: number, patch: { category?: PracticeAttempt['sentenceAttempts'][number]['tokens'][number]['category']; reason?: string }) {
  const token = activeStudent().attempts
    .find((item) => item.id === attemptId)
    ?.sentenceAttempts.find((item) => item.sentenceId === sentenceId)
    ?.tokens.find((item) => item.index === tokenIndex);
  if (token) Object.assign(token, patch);
}

/**
 * 提交归并：先在内存中替换两份档案，再立即同步落盘。
 * 任一步失败都把两份档案恢复原样，返回 false 让界面允许重新尝试。
 */
export function commitMerge(result: MergeResult): boolean {
  const indexA = state.students.findIndex((student) => student.id === result.merged.id);
  const indexB = state.students.findIndex((student) => student.id === result.removedId);
  if (indexA < 0 || indexB < 0 || indexA === indexB) return false;

  // 事务开始前先深拷贝，保证恢复出来的两份档案与归并前逐字节一致。
  const snapshotA = JSON.parse(JSON.stringify(state.students[indexA])) as StudentProfile;
  const snapshotB = JSON.parse(JSON.stringify(state.students[indexB])) as StudentProfile;
  const snapshotActive = state.activeStudentId;
  persistGateOpen = false;
  try {
    state.students[indexA] = result.merged;
    state.students.splice(indexB, 1);
    state.activeStudentId = result.merged.id;
    if (!persist()) throw new Error('persist failed');
    return true;
  } catch {
    // 深拷贝恢复，确保失败后两份档案与归并前完全一致。
    state.students[indexA] = snapshotA;
    state.students.splice(indexB, 0, snapshotB);
    state.activeStudentId = snapshotActive;
    return false;
  } finally {
    // 恢复完成后再开门，随后的 watcher 刷盘只会写回原状态。
    persistGateOpen = true;
    persist();
  }
}

export function exportRecords(): string {
  // 导出按归并后的学生组织；同一记录 id 只出现一次，不因历史归并重复计数。
  const students = state.students.map((student) => ({
    id: student.id,
    name: student.name,
    mergedFrom: student.mergedFrom,
    attempts: deduplicateAttempts(student.attempts),
    progress: student.progress
  }));
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    application: 'EchoStep 移动听写',
    students,
    activeStudentId: state.activeStudentId,
    progress: Object.fromEntries(state.students.flatMap((student) => Object.entries(student.progress).map(([lessonId, value]) => [`${student.id}:${lessonId}`, value])))
  }, null, 2);
}

export function resetDemo() {
  Object.assign(state, createInitialState());
}

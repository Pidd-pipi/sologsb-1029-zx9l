import { reactive, ref, watch } from 'vue';
import { createInitialState } from './data';
import { compareStates, mergeStates, type DraftChoices } from './merge';
import type { PersistedState, PracticeAttempt } from './types';

const PROFILES_KEY = 'sologsb-1029-dictation-profiles-v1';
const LEGACY_KEY = 'sologsb-1029-dictation-state-v1';

export interface StudentProfile {
  id: string;
  name: string;
  state: PersistedState;
}

interface ProfilesEnvelope {
  version: 1;
  activeProfileId: string;
  profiles: StudentProfile[];
}

function clone<T>(value: T): T {
  // All persisted data is JSON-serializable; JSON cloning also safely traverses
  // Vue reactive proxies (which structuredClone rejects).
  return JSON.parse(JSON.stringify(value)) as T;
}

function newProfile(name: string, state: PersistedState, id?: string): StudentProfile {
  return {
    id: id ?? `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    state
  };
}

function loadEnvelope(): ProfilesEnvelope {
  const fallback = (): ProfilesEnvelope => {
    const profile = newProfile('学生', createInitialState());
    return { version: 1, activeProfileId: profile.id, profiles: [profile] };
  };
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ProfilesEnvelope;
      if (
        parsed.version === 1 &&
        Array.isArray(parsed.profiles) &&
        parsed.profiles.length > 0 &&
        parsed.profiles.every((profile) => profile && profile.state?.schemaVersion === 1)
      ) {
        const activeId = parsed.activeProfileId && parsed.profiles.some((profile) => profile.id === parsed.activeProfileId)
          ? parsed.activeProfileId
          : parsed.profiles[0].id;
        return { version: 1, activeProfileId: activeId, profiles: parsed.profiles };
      }
    }
  } catch {
    // Malformed envelope: fall through to legacy migration / seed.
  }
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as PersistedState;
      if (parsed.schemaVersion === 1) {
        const profile = newProfile('学生', parsed, 'profile-legacy');
        return { version: 1, activeProfileId: profile.id, profiles: [profile] };
      }
    }
  } catch {
    // Malformed legacy payload: seed a fresh profile.
  }
  return fallback();
}

const envelope = loadEnvelope();

export const profiles = reactive<StudentProfile[]>(
  envelope.profiles.map((profile) => ({ id: profile.id, name: profile.name, state: profile.state }))
);
export const activeProfileId = ref<string>(envelope.activeProfileId);

function findProfile(id: string): StudentProfile | undefined {
  return profiles.find((profile) => profile.id === id);
}

export function activeProfile(): StudentProfile {
  return findProfile(activeProfileId.value) ?? profiles[0];
}

// Reactive mirror of the active profile's state. Keeping a standalone object lets the
// rest of the app keep using `state.attempts` directly while profiles stay plain data.
export const state = reactive<PersistedState>(clone(activeProfile().state));

function syncStateToActive() {
  const profile = activeProfile();
  if (profile) profile.state = clone(state);
}

function writeEnvelope(): boolean {
  const payload: ProfilesEnvelope = {
    version: 1,
    activeProfileId: activeProfileId.value,
    profiles: clone(profiles)
  };
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function persist(): boolean {
  syncStateToActive();
  return writeEnvelope();
}

watch(state, () => {
  const profile = activeProfile();
  if (profile) profile.state = clone(state);
  writeEnvelope();
}, { deep: true });

export function setActiveProfile(id: string) {
  const profile = findProfile(id);
  if (!profile || profile.id === activeProfileId.value) return;
  activeProfileId.value = profile.id;
  Object.assign(state, clone(profile.state));
}

export function lessons(): PersistedState['courses'][number]['lessons'] {
  return state.courses.flatMap((course) => course.lessons);
}

export function lessonById(id: string) {
  return lessons().find((lesson) => lesson.id === id);
}

export function courseForLesson(lessonId: string) {
  return state.courses.find((course) => course.id === lessonById(lessonId)?.courseId);
}

export function setDownloaded(lessonId: string, value: boolean) {
  const lesson = lessonById(lessonId);
  if (lesson) lesson.downloaded = value;
}

export function saveAttempt(attempt: PracticeAttempt) {
  state.attempts.unshift(attempt);
}

export function updateTokenClassification(
  attemptId: string,
  sentenceId: string,
  tokenIndex: number,
  patch: { category?: PracticeAttempt['sentenceAttempts'][number]['tokens'][number]['category']; reason?: string }
) {
  const attempt = state.attempts.find((item) => item.id === attemptId);
  const token = attempt?.sentenceAttempts.find((item) => item.sentenceId === sentenceId)?.tokens.find((item) => item.index === tokenIndex);
  if (token) Object.assign(token, patch);
}

export function addProfile(name: string): string {
  const profile = newProfile((name ?? '').trim() || '学生', createInitialState());
  profiles.push(profile);
  persist();
  return profile.id;
}

export function renameProfile(id: string, name: string) {
  const profile = findProfile(id);
  if (!profile) return;
  profile.name = (name ?? '').trim() || profile.name;
  persist();
}

export interface MergeOutcome {
  ok: boolean;
  error?: string;
}

// Merges the secondary profile into the primary one. Both profiles are snapshotted
// first; if the write fails the snapshots are restored and the merge can be retried.
export function mergeStudentProfiles(primaryId: string, secondaryId: string, choices: DraftChoices, keptName?: string): MergeOutcome {
  const primary = findProfile(primaryId);
  const secondary = findProfile(secondaryId);
  if (!primary || !secondary || primaryId === secondaryId) {
    return { ok: false, error: '请选择两份不同的学生档案' };
  }

  const comparison = compareStates(primary.state, secondary.state);
  const unresolved = comparison.conflicts.filter((conflict) => !choices[conflict.lessonId]);
  if (unresolved.length > 0) {
    return { ok: false, error: `还有 ${unresolved.length} 个课节的未交草稿未选择保留哪份` };
  }

  const snapshot = clone(profiles);
  const snapshotActiveId = activeProfileId.value;

  try {
    const merged = mergeStates(primary.state, secondary.state, choices);
    if (keptName && keptName.trim()) primary.name = keptName.trim();
    primary.state = merged;

    const secondaryIndex = profiles.findIndex((profile) => profile.id === secondaryId);
    if (secondaryIndex >= 0) profiles.splice(secondaryIndex, 1);

    if (activeProfileId.value === secondaryId) {
      activeProfileId.value = primaryId;
      Object.assign(state, clone(merged));
    } else if (activeProfileId.value === primaryId) {
      Object.assign(state, clone(merged));
    }

    const ok = persist();
    if (!ok) throw new Error('写入失败');
    return { ok: true };
  } catch {
    profiles.splice(0, profiles.length, ...snapshot);
    activeProfileId.value = snapshotActiveId;
    const restored = findProfile(snapshotActiveId) ?? profiles[0];
    if (restored) Object.assign(state, clone(restored.state));
    writeEnvelope();
    return { ok: false, error: '写入失败，两份档案已恢复原样，可重新尝试合并' };
  }
}

export function exportRecords(): string {
  const profile = activeProfile();
  const byId = new Map<string, PracticeAttempt>();
  for (const attempt of state.attempts) {
    if (!byId.has(attempt.id)) byId.set(attempt.id, attempt);
  }
  const attempts = [...byId.values()].sort((a, b) => +new Date(b.submittedAt) - +new Date(a.submittedAt));
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    application: 'EchoStep 移动听写',
    student: profile.name,
    attempts,
    progress: state.progress
  }, null, 2);
}

export function resetDemo() {
  const fresh = createInitialState();
  Object.assign(state, fresh);
}

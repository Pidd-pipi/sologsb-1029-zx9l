<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { activeStudent, commitMerge, courseForLesson, exportRecords, lessonById, lessons, persist, saveAttempt, setActiveStudent, setDownloaded, state, updateTokenClassification } from './store';
import { buildMergeComparison, CATEGORY_KEYS, defaultPlan, executeMerge, validatePlan } from './merge';
import type { MergeComparison, MergeDiffEntry, MergePlan } from './merge';
import type { ErrorCategory, Lesson, MergeSide, PracticeAttempt, PracticeView, StudentProfile } from './types';
import { compareSentence, scoreAttempt, segmentText } from './utils';

const view = ref<PracticeView>(state.activeLessonId ? 'practice' : 'library');
const online = ref(navigator.onLine);
const toast = ref('');
const resultAttemptId = ref('');
const selectedResultSentence = ref(0);
const segmentStart = ref(0);
const segmentEnd = ref(1);
const teacherAttemptId = ref('');
const teacherDraft = ref('');
let toastTimer = 0;

const activeLesson = computed(() => lessonById(state.activeLessonId));
const activeCourse = computed(() => activeLesson.value ? courseForLesson(activeLesson.value.id) : undefined);
const student = computed<StudentProfile>(() => activeStudent());
const studentAttempts = computed<PracticeAttempt[]>(() => student.value?.attempts ?? []);
const currentSentence = computed(() => {
  const lesson = activeLesson.value;
  if (!lesson) return undefined;
  return lesson.sentences.find((sentence) => sentence.id === state.activeSentenceId) ?? lesson.sentences[0];
});
const activeProgress = computed(() => activeLesson.value ? student.value.progress[activeLesson.value.id] : undefined);
const currentAnswer = ref('');
const currentIndex = computed(() => {
  if (!activeLesson.value || !currentSentence.value) return 0;
  return activeLesson.value.sentences.findIndex((item) => item.id === currentSentence.value?.id);
});
const lessonCompletion = computed(() => {
  if (!activeLesson.value || !activeProgress.value) return 0;
  const answered = activeLesson.value.sentences.filter((sentence) => (activeProgress.value?.answers[sentence.id] ?? '').trim()).length;
  return Math.round((answered / activeLesson.value.sentences.length) * 100);
});
const resultAttempt = computed(() => studentAttempts.value.find((attempt) => attempt.id === resultAttemptId.value));
const resultSentence = computed(() => resultAttempt.value?.sentenceAttempts[selectedResultSentence.value]);
const teacherAttempt = computed(() => studentAttempts.value.find((attempt) => attempt.id === teacherAttemptId.value));
const totalWords = computed(() => studentAttempts.value.flatMap((attempt) => attempt.sentenceAttempts).flatMap((item) => item.tokens).length);
const correctedWords = computed(() => studentAttempts.value.flatMap((attempt) => attempt.sentenceAttempts).flatMap((item) => item.tokens).filter((token) => !token.correct && token.category !== 'unclassified').length);

const categoryOptions: Array<{ value: ErrorCategory; label: string }> = [
  { value: 'unclassified', label: '未分类' },
  { value: 'spelling', label: '拼写错误' },
  { value: 'omitted', label: '漏词' },
  { value: 'extra', label: '多词' },
  { value: 'punctuation', label: '标点' },
  { value: 'grammar', label: '语法' }
];
const categoryLabels: Record<Exclude<ErrorCategory, 'unclassified'>, string> = {
  spelling: '拼写',
  omitted: '漏词',
  extra: '多词',
  punctuation: '标点',
  grammar: '语法'
};

// ---------- 档案归并 ----------
const mergeAId = ref('');
const mergeBId = ref('');
const mergeComparison = ref<MergeComparison | null>(null);
const mergePlan = ref<MergePlan>({ keepSide: null, draftChoices: {}, keptName: '' });
const mergeDiffs = ref<MergeDiffEntry[]>([]);
const mergeCommitted = ref(false);
const mergeWriteFailed = ref(false);

const mergeProfileA = computed(() => state.students.find((item) => item.id === mergeAId.value));
const mergeProfileB = computed(() => state.students.find((item) => item.id === mergeBId.value));
const mergeReady = computed(() => !!mergeProfileA.value && !!mergeProfileB.value && mergeAId.value !== mergeBId.value);
const conflictDrafts = computed(() => mergeComparison.value?.lessons.flatMap((row) => row.drafts.filter((draft) => draft.conflict)) ?? []);
const unresolvedConflicts = computed(() => conflictDrafts.value.filter((draft) => {
  const choice = mergePlan.value.draftChoices[`${draft.lessonId}:${draft.sentenceId}`];
  return choice !== 'a' && choice !== 'b';
}));

watch(currentSentence, (sentence) => {
  currentAnswer.value = sentence && activeProgress.value ? activeProgress.value.answers[sentence.id] ?? '' : '';
  segmentStart.value = 0;
  segmentEnd.value = sentence ? Math.max(0, segmentText(sentence.text).length - 1) : 0;
}, { immediate: true });

watch(currentAnswer, (value) => {
  const lesson = activeLesson.value;
  const sentence = currentSentence.value;
  if (!lesson || !sentence) return;
  const progress = student.value.progress[lesson.id] ?? { answers: {}, activeSentenceId: sentence.id, updatedAt: new Date().toISOString() };
  progress.answers[sentence.id] = value;
  progress.activeSentenceId = sentence.id;
  progress.updatedAt = new Date().toISOString();
  student.value.progress[lesson.id] = progress;
});

watch(activeLesson, (lesson) => {
  if (!lesson) return;
  state.activeLessonId = lesson.id;
  state.activeSentenceId = currentSentence.value?.id ?? lesson.sentences[0].id;
  const progress = student.value.progress[lesson.id] ?? { answers: {}, activeSentenceId: lesson.sentences[0].id, updatedAt: new Date().toISOString() };
  if (!lesson.sentences.some((sentence) => sentence.id === progress.activeSentenceId)) progress.activeSentenceId = lesson.sentences[0].id;
  student.value.progress[lesson.id] = progress;
  state.activeSentenceId = progress.activeSentenceId;
  currentAnswer.value = progress.answers[state.activeSentenceId] ?? '';
});

watch(teacherAttemptId, (id) => {
  teacherDraft.value = studentAttempts.value.find((attempt) => attempt.id === id)?.teacherFeedback ?? '';
});

function notify(message: string) {
  toast.value = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.value = ''; }, 2400);
}

function startLesson(lesson: Lesson) {
  const progress = student.value.progress[lesson.id] ?? { answers: {}, activeSentenceId: lesson.sentences[0].id, updatedAt: new Date().toISOString() };
  student.value.progress[lesson.id] = progress;
  state.activeLessonId = lesson.id;
  state.activeSentenceId = progress.activeSentenceId || lesson.sentences[0].id;
  currentAnswer.value = progress.answers[state.activeSentenceId] ?? '';
  view.value = 'practice';
  persist();
}

function goToSentence(index: number) {
  const lesson = activeLesson.value;
  if (!lesson || !lesson.sentences[index]) return;
  const target = lesson.sentences[index];
  state.activeSentenceId = target.id;
  const progress = student.value.progress[lesson.id];
  if (progress) {
    progress.activeSentenceId = target.id;
    progress.updatedAt = new Date().toISOString();
  }
  currentAnswer.value = progress?.answers[target.id] ?? '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function submitLesson() {
  const lesson = activeLesson.value;
  const course = activeCourse.value;
  if (!lesson || !course) return;
  const progress = student.value.progress[lesson.id];
  const answeredCount = lesson.sentences.filter((sentence) => (progress?.answers[sentence.id] ?? '').trim()).length;
  if (!answeredCount) {
    notify('请至少输入一句话再提交');
    return;
  }
  if (answeredCount < lesson.sentences.length && !window.confirm(`还有 ${lesson.sentences.length - answeredCount} 句未作答，仍然提交吗？`)) return;
  const sentenceAttempts = lesson.sentences.map((sentence) => {
    const source = sentence.text;
    const answer = progress?.answers[sentence.id] ?? '';
    const tokens = compareSentence(source, answer);
    const correct = tokens.filter((token) => token.correct).length;
    return { sentenceId: sentence.id, source, answer, tokens, score: tokens.length ? Math.round((correct / tokens.length) * 100) : 0 };
  });
  const attempt: PracticeAttempt = {
    id: `attempt-${Date.now()}`,
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    courseTitle: course.title,
    submittedAt: new Date().toISOString(),
    score: scoreAttempt(sentenceAttempts),
    sentenceAttempts,
    teacherFeedback: ''
  };
  saveAttempt(attempt);
  resultAttemptId.value = attempt.id;
  selectedResultSentence.value = 0;
  syncSegment();
  view.value = 'result';
  persist();
  notify('已提交，逐词结果已生成');
}

function syncSegment() {
  const tokenCount = segmentText(resultSentence.value?.source ?? '').length;
  segmentStart.value = 0;
  segmentEnd.value = Math.max(0, tokenCount - 1);
}

function replay(text: string, rate = 0.82) {
  if (!('speechSynthesis' in window)) {
    notify('当前浏览器不支持语音播放');
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = rate;
  window.speechSynthesis.speak(utterance);
}

function replaySegment() {
  const tokens = segmentText(resultSentence.value?.source ?? '');
  const start = Math.min(segmentStart.value, segmentEnd.value);
  const end = Math.max(segmentStart.value, segmentEnd.value);
  replay(tokens.slice(start, end + 1).map((token) => token.display).join(' '), 0.72);
}

function selectResultSentence(index: number) {
  selectedResultSentence.value = index;
  syncSegment();
}

function saveClassification(attemptId: string, sentenceId: string, tokenIndex: number, category: ErrorCategory, reason: string) {
  updateTokenClassification(attemptId, sentenceId, tokenIndex, { category, reason });
  persist();
}

function saveTeacherFeedback() {
  const attempt = teacherAttempt.value;
  if (!attempt) return;
  attempt.teacherFeedback = teacherDraft.value.trim();
  persist();
  notify('教师反馈已保存');
}

function toggleTheme() {
  state.theme = state.theme === 'light' ? 'dark' : 'light';
}

function changeFont(delta: number) {
  state.fontScale = Math.min(1.25, Math.max(0.85, Number((state.fontScale + delta).toFixed(2))));
}

function downloadRecords() {
  const blob = new Blob([exportRecords()], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `echo-step-records-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  notify('练习记录已按归并后的学生导出');
}

function formatDate(value?: string): string {
  if (!value) return '—';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return value;
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function switchStudent(studentId: string) {
  setActiveStudent(studentId);
  teacherAttemptId.value = activeStudent().attempts[0]?.id ?? '';
  teacherDraft.value = activeStudent().attempts[0]?.teacherFeedback ?? '';
}

// ---------- 归并流程 ----------
function openMerge() {
  mergeAId.value = state.activeStudentId;
  mergeBId.value = state.students.find((item) => item.id !== state.activeStudentId)?.id ?? '';
  mergeComparison.value = null;
  mergeDiffs.value = [];
  mergeCommitted.value = false;
  mergeWriteFailed.value = false;
  view.value = 'merge';
}

function startCompare() {
  if (!mergeReady.value || !mergeProfileA.value || !mergeProfileB.value) return;
  mergeComparison.value = buildMergeComparison(mergeProfileA.value, mergeProfileB.value, lessons());
  mergePlan.value = defaultPlan(mergeComparison.value);
  mergePlan.value.keptName = mergeProfileA.value.name;
  mergeDiffs.value = [];
  mergeCommitted.value = false;
  mergeWriteFailed.value = false;
}

watch([mergeAId, mergeBId], () => {
  // 尚未开始核对或更换了配对时，旧的并排结果作废，保证“没选定前不写入”。
  mergeComparison.value = null;
  mergeDiffs.value = [];
  mergeCommitted.value = false;
  mergeWriteFailed.value = false;
});

function chooseKeep(side: MergeSide) {
  if (!mergeComparison.value) return;
  mergePlan.value.keepSide = side;
  mergePlan.value.keptName = side === 'a' ? mergeComparison.value.a.name : mergeComparison.value.b.name;
  // 双份草稿默认跟随保留侧，教师仍可逐句改选。
  for (const draft of conflictDrafts.value) {
    mergePlan.value.draftChoices[`${draft.lessonId}:${draft.sentenceId}`] = side;
  }
  mergeWriteFailed.value = false;
}

function setDraftChoice(lessonId: string, sentenceId: string, side: MergeSide) {
  mergePlan.value.draftChoices[`${lessonId}:${sentenceId}`] = side;
}

const mergeError = computed(() => mergeComparison.value ? validatePlan(mergeComparison.value, mergePlan.value) : null);

function lessonTitle(lessonId: string): string {
  const fromRow = mergeComparison.value?.lessons.find((row) => row.lessonId === lessonId)?.lessonTitle;
  return fromRow ?? lessonById(lessonId)?.title ?? lessonId;
}

const DIFF_KIND_LABELS: Record<MergeDiffEntry['kind'], string> = {
  meta: '档案',
  lesson: '课节',
  draft: '草稿',
  record: '记录',
  feedback: '反馈'
};
function diffKindLabel(kind: MergeDiffEntry['kind']): string {
  return DIFF_KIND_LABELS[kind];
}

function unclassifiedCount(side: MergeSide): number {
  const errors = side === 'a' ? mergeComparison.value?.aErrors : mergeComparison.value?.bErrors;
  if (!errors) return 0;
  return errors.totalErrors - CATEGORY_KEYS.reduce((sum, key) => sum + errors.categories[key], 0);
}

function confirmMerge() {
  const comparison = mergeComparison.value;
  if (!comparison || !mergeProfileA.value || !mergeProfileB.value) return;
  const error = validatePlan(comparison, mergePlan.value);
  if (error) {
    notify(error);
    return;
  }
  const keep = mergePlan.value.keepSide === 'a' ? mergeProfileA.value : mergeProfileB.value;
  const drop = mergePlan.value.keepSide === 'a' ? mergeProfileB.value : mergeProfileA.value;
  let result;
  try {
    result = executeMerge(mergePlan.value, keep, drop);
  } catch {
    notify('归并结果生成失败，两份档案均未改动');
    return;
  }
  // 真正落盘发生在这里；失败时 commitMerge 已把两份档案恢复原样。
  if (commitMerge(result)) {
    mergeDiffs.value = result.diffs;
    mergeCommitted.value = true;
    mergeWriteFailed.value = false;
    notify('档案已归并并写入本机');
    window.scrollTo({ top: 0 });
  } else {
    mergeWriteFailed.value = true;
    notify('写入失败，两份档案已恢复原样，可重新尝试');
  }
}

function finishMerge() {
  view.value = 'library';
  mergeComparison.value = null;
  mergeDiffs.value = [];
  mergeCommitted.value = false;
}

function onConnectionChange() {
  online.value = navigator.onLine;
  persist();
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') persist();
}

onMounted(() => {
  window.addEventListener('online', onConnectionChange);
  window.addEventListener('offline', onConnectionChange);
  window.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', persist);
  teacherAttemptId.value = studentAttempts.value[0]?.id ?? '';
  teacherDraft.value = studentAttempts.value[0]?.teacherFeedback ?? '';
});

onBeforeUnmount(() => {
  window.removeEventListener('online', onConnectionChange);
  window.removeEventListener('offline', onConnectionChange);
  window.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('pagehide', persist);
  persist();
});
</script>

<template>
  <var-app>
    <div class="app-shell" :data-theme="state.theme" :style="{ '--font-scale': state.fontScale }">
      <div v-if="view === 'library'" class="page">
        <header class="topbar">
          <div class="brand">
            <div class="brand-mark">E</div>
            <div><h1>EchoStep</h1><p>移动端语言听写</p></div>
          </div>
          <div class="icon-row">
            <button class="icon-button" :aria-label="state.theme === 'light' ? '切换到深色模式' : '切换到浅色模式'" @click="toggleTheme">{{ state.theme === 'light' ? '◐' : '☀' }}</button>
            <button class="icon-button" aria-label="减小字号" @click="changeFont(-0.05)">A−</button>
            <button class="icon-button" aria-label="增大字号" @click="changeFont(0.05)">A＋</button>
          </div>
        </header>

        <section class="student-bar panel">
          <div class="student-bar-row">
            <div class="dictation-label" style="margin: 0"><strong>当前学生</strong><span v-if="student.mergedFrom.length">已并入：{{ student.mergedFrom.join('、') }}</span></div>
            <var-select :model-value="state.activeStudentId" size="small" @update:model-value="switchStudent($event as string)">
              <var-option v-for="item in state.students" :key="item.id" :label="`${item.name}（${item.attempts.length} 条记录）`" :value="item.id" />
            </var-select>
          </div>
          <var-button block type="default" variant="outline" size="small" :disabled="state.students.length < 2" @click="openMerge">档案归并（同名 / 改名）</var-button>
        </section>

        <section class="hero">
          <h2>今天也把声音变成文字</h2>
          <p>下载课程后可离线作答，答案和当前位置会自动恢复。</p>
          <div class="hero-stats">
            <div class="hero-stat"><strong>{{ studentAttempts.length }}</strong><span>练习记录</span></div>
            <div class="hero-stat"><strong>{{ correctedWords }}</strong><span>已分类错误</span></div>
            <div class="hero-stat"><strong>{{ totalWords }}</strong><span>累计词数</span></div>
          </div>
        </section>

        <div class="offline-banner" :class="{ online }">
          <span>{{ online ? '● 在线 · 数据已保存到本机' : '● 离线模式 · 可继续已下载课程' }}</span>
          <span>{{ online ? '本地优先存储' : '恢复网络后继续保存' }}</span>
        </div>

        <div class="section-head">
          <h3>课程库</h3>
          <div class="segmented">
            <button :class="{ active: state.role === 'learner' }" @click="state.role = 'learner'; view = 'library'">学习</button>
            <button :class="{ active: state.role === 'teacher' }" @click="state.role = 'teacher'; view = 'teacher'">教师</button>
          </div>
        </div>

        <article v-for="course in state.courses" :key="course.id" class="course-card">
          <div class="course-title">
            <div><h3>{{ course.title }}</h3><p>{{ course.description }}</p></div>
            <span class="level-badge">{{ course.level }}</span>
          </div>
          <div v-for="lesson in course.lessons" :key="lesson.id" class="lesson-row">
            <div><h4>{{ lesson.title }}</h4><p>{{ lesson.subtitle }} · {{ lesson.sentences.length }} 句 · 约 {{ lesson.estimatedMinutes }} 分钟</p></div>
            <div class="lesson-actions">
              <var-switch :model-value="lesson.downloaded" @update:model-value="setDownloaded(lesson.id, $event as boolean)" />
              <var-button type="primary" size="small" @click="startLesson(lesson)">{{ lesson.downloaded ? '继续' : '开始' }}</var-button>
            </div>
          </div>
        </article>

        <div class="section-head"><h3>最近练习</h3><span>{{ studentAttempts.length }} 条记录 · {{ student.name }}</span></div>
        <article v-if="studentAttempts.length" class="panel">
          <div v-for="attempt in studentAttempts.slice(0, 4)" :key="attempt.id" class="history-card">
            <div class="history-top"><strong>{{ attempt.lessonTitle }}</strong><span class="history-score">{{ attempt.score }} 分</span></div>
            <p>{{ formatDate(attempt.submittedAt) }} · {{ attempt.teacherFeedback || '暂无教师反馈' }}</p>
          </div>
          <var-button block type="primary" variant="outline" @click="downloadRecords">导出全部练习记录</var-button>
        </article>
        <div v-else class="empty-state"><strong>还没有练习记录</strong>完成一次听写后，可在这里复核和导出。</div>
      </div>

      <div v-else-if="view === 'practice' && activeLesson" class="page">
        <header class="practice-header">
          <div class="practice-nav">
            <button class="back-button" aria-label="返回课程库" @click="view = 'library'">‹</button>
            <div><h2>{{ activeLesson.title }}</h2></div>
            <span class="status-chip">{{ online ? '在线' : '离线' }}</span>
          </div>
          <div class="progress-line">
            <div class="sentence-count"><span>第 {{ currentIndex + 1 }} / {{ activeLesson.sentences.length }} 句</span><span>{{ lessonCompletion }}% 已填写</span></div>
            <var-progress :value="lessonCompletion" color="#1769e0" />
          </div>
        </header>

        <section class="audio-card">
          <div class="audio-meta">
            <button class="play-button" aria-label="播放当前句子" @click="replay(currentSentence?.text ?? '')">▶</button>
            <div><strong>听写提示</strong><p>先完整播放，再输入你听到的英文。播放速度已放慢。</p></div>
          </div>
        </section>

        <div class="dictation-label"><strong>输入听到的内容</strong><span>答案在本机自动保存 · {{ student.name }}</span></div>
        <textarea v-model="currentAnswer" class="answer-box" :aria-label="`第 ${currentIndex + 1} 句听写答案`" placeholder="Type what you hear..." @keydown.ctrl.enter="submitLesson" @keydown.meta.enter="submitLesson"></textarea>
        <div class="practice-actions">
          <var-button block type="default" variant="outline" @click="replay(currentSentence?.text ?? '')">再听一次</var-button>
          <var-button block type="primary" @click="submitLesson">提交本次听写</var-button>
        </div>

        <div class="sentence-picker" aria-label="句子导航">
          <button v-for="(sentence, index) in activeLesson.sentences" :key="sentence.id" class="sentence-dot" :class="{ active: sentence.id === currentSentence?.id, done: !!activeProgress?.answers[sentence.id] }" :aria-label="`跳到第 ${index + 1} 句`" @click="goToSentence(index)">{{ index + 1 }}</button>
        </div>

        <section v-if="currentSentence" class="panel">
          <div class="detail-head"><div><h3>场景提示</h3><p>{{ currentSentence.translation }}</p></div></div>
          <div class="feedback-card">{{ currentSentence.note }}</div>
        </section>
      </div>

      <div v-else-if="view === 'result' && resultAttempt" class="page">
        <header class="topbar">
          <button class="back-button" aria-label="返回课程库" @click="view = 'library'">‹</button>
          <span class="status-chip">提交于 {{ formatDate(resultAttempt.submittedAt) }}</span>
          <button class="icon-button" @click="downloadRecords">导出</button>
        </header>

        <section class="panel result-score">
          <div class="score-ring" :style="{ '--score': `${resultAttempt.score}%` }"><strong>{{ resultAttempt.score }}</strong></div>
          <h2>{{ resultAttempt.score >= 90 ? '几乎完美' : resultAttempt.score >= 70 ? '继续打磨细节' : '再听一遍会更好' }}</h2>
          <p>{{ resultAttempt.lessonTitle }} · 点击红色词可单独重听，并记录错误原因。</p>
        </section>

        <div class="sentence-picker">
          <button v-for="(attempt, index) in resultAttempt.sentenceAttempts" :key="attempt.sentenceId" class="sentence-dot" :class="{ active: index === selectedResultSentence }" @click="selectResultSentence(index)">{{ index + 1 }}</button>
        </div>

        <section v-if="resultSentence" class="panel token-panel">
          <div class="detail-head">
            <div><h3>第 {{ selectedResultSentence + 1 }} 句逐词结果</h3><p>{{ resultSentence.source }}</p></div>
            <span class="history-score">{{ resultSentence.score }}%</span>
          </div>
          <div class="word-list">
            <button v-for="token in resultSentence.tokens" :key="`${token.index}-${token.expected}-${token.actual}`" class="word-chip" :class="{ wrong: !token.correct }" :title="token.correct ? '点击重听' : `你的答案：${token.actual || '未输入'}`" @click="replay(token.expected || token.actual, 0.7)">
              {{ token.expected || `[+${token.actual}]` }}<small v-if="!token.correct">{{ token.actual || '漏词' }}</small>
            </button>
          </div>

          <div v-if="resultSentence.tokens.some((token) => !token.correct)" style="margin-top: 18px">
            <div class="dictation-label"><strong>片段重听</strong><span>选择起止词后播放</span></div>
            <div style="display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; align-items: center">
              <select v-model.number="segmentStart" aria-label="片段起点"><option v-for="token in segmentText(resultSentence.source)" :key="`s-${token.index}`" :value="token.index">{{ token.index + 1 }} · {{ token.display }}</option></select>
              <select v-model.number="segmentEnd" aria-label="片段终点"><option v-for="token in segmentText(resultSentence.source)" :key="`e-${token.index}`" :value="token.index">{{ token.index + 1 }} · {{ token.display }}</option></select>
              <var-button type="primary" size="small" @click="replaySegment">播放片段</var-button>
            </div>
          </div>

          <div v-if="resultSentence.tokens.some((token) => !token.correct)" style="margin-top: 18px">
            <div class="dictation-label"><strong>错误分类与原因</strong><span>会被写入本地记录</span></div>
            <div v-for="token in resultSentence.tokens.filter((item) => !item.correct)" :key="`edit-${token.index}`" class="feedback-card">
              <strong>{{ token.expected || `多出的词：${token.actual}` }}</strong>
              <div style="display: grid; grid-template-columns: 120px 1fr; gap: 8px; margin-top: 9px">
                <select :value="token.category" @change="saveClassification(resultAttempt.id, resultSentence.sentenceId, token.index, ($event.target as HTMLSelectElement).value as ErrorCategory, token.reason)">
                  <option v-for="option in categoryOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
                <input :value="token.reason" placeholder="记录原因，如连读、词尾未听清" @change="saveClassification(resultAttempt.id, resultSentence.sentenceId, token.index, token.category, ($event.target as HTMLInputElement).value)" />
              </div>
            </div>
          </div>
        </section>

        <section v-if="resultAttempt.teacherFeedback" class="panel"><div class="feedback-card"><strong>教师反馈</strong><p>{{ resultAttempt.teacherFeedback }}</p></div></section>
        <var-button block type="primary" @click="startLesson(activeLesson!)">返回本次课程</var-button>
        <var-button block type="default" variant="outline" style="margin-top: 10px" @click="downloadRecords">导出练习记录</var-button>
      </div>

      <div v-else-if="view === 'teacher'" class="page">
        <header class="topbar">
          <button class="back-button" aria-label="返回课程库" @click="view = 'library'">‹</button>
          <div class="brand"><div class="brand-mark">T</div><div><h1>教师复核</h1><p>查看作答并写入反馈</p></div></div>
        </header>

        <section class="panel">
          <div class="dictation-label" style="margin-top: 0"><strong>选择学生</strong><span>{{ state.students.length }} 份档案</span></div>
          <var-select :model-value="state.activeStudentId" @update:model-value="switchStudent($event as string)">
            <var-option v-for="item in state.students" :key="item.id" :label="`${item.name}（${item.attempts.length} 条记录）`" :value="item.id" />
          </var-select>
        </section>

        <div v-if="studentAttempts.length" class="panel">
          <div class="dictation-label" style="margin-top: 0"><strong>选择一次作答</strong><span>{{ studentAttempts.length }} 条 · {{ student.name }}</span></div>
          <var-select v-model="teacherAttemptId" placeholder="选择作答">
            <var-option v-for="attempt in studentAttempts" :key="attempt.id" :label="`${attempt.lessonTitle} · ${attempt.score} 分 · ${formatDate(attempt.submittedAt)}`" :value="attempt.id" />
          </var-select>
          <template v-if="teacherAttempt">
            <div class="feedback-card"><strong>{{ teacherAttempt.courseTitle }}</strong><p>{{ teacherAttempt.lessonTitle }} · 总分 {{ teacherAttempt.score }}，完成 {{ teacherAttempt.sentenceAttempts.length }} 句。</p></div>
            <div class="teacher-editor">
              <textarea v-model="teacherDraft" placeholder="给学生一条具体、可执行的反馈..." aria-label="教师反馈"></textarea>
              <var-button block type="primary" style="margin-top: 10px" @click="saveTeacherFeedback">保存反馈</var-button>
            </div>
          </template>
        </div>
        <div v-else class="empty-state"><strong>该学生暂无作答</strong>学习端提交听写后，这里会出现练习记录。</div>

        <var-button block type="default" variant="outline" style="margin-top: 10px" :disabled="state.students.length < 2" @click="openMerge">归并改名前后的两份档案</var-button>
      </div>

      <div v-else-if="view === 'merge'" class="page">
        <header class="topbar">
          <button class="back-button" aria-label="返回课程库" @click="view = 'library'">‹</button>
          <div class="brand"><div class="brand-mark">合</div><div><h1>学生档案归并</h1><p>同一人改名前后的两份档案</p></div></div>
        </header>

        <section v-if="!mergeCommitted" class="panel">
          <div class="dictation-label" style="margin-top: 0"><strong>第一步 · 并排选择两份档案</strong><span>选定前不会写入任何数据</span></div>
          <div class="merge-pair">
            <div>
              <label class="merge-side-label side-a">A 档</label>
              <var-select v-model="mergeAId">
                <var-option v-for="item in state.students" :key="item.id" :label="`${item.name}（${item.attempts.length} 条）`" :value="item.id" />
              </var-select>
            </div>
            <div>
              <label class="merge-side-label side-b">B 档</label>
              <var-select v-model="mergeBId">
                <var-option v-for="item in state.students" :key="item.id" :label="`${item.name}（${item.attempts.length} 条）`" :value="item.id" />
              </var-select>
            </div>
          </div>
          <var-button block type="primary" :disabled="!mergeReady" @click="startCompare">并排核对</var-button>
          <p v-if="!mergeReady && state.students.length >= 2" class="merge-hint">请选择两名不同的学生档案开始核对。</p>
          <p v-if="state.students.length < 2" class="merge-hint">已没有可归并的第二份档案。</p>
        </section>

        <template v-if="mergeComparison && mergeProfileA && mergeProfileB && !mergeCommitted">
          <section class="panel">
            <div class="dictation-label" style="margin-top: 0"><strong>第二步 · 并排核对</strong><span>课节进度 / 未交草稿 / 练习记录 / 错词分类 / 教师反馈</span></div>
            <div class="merge-grid compare-head">
              <div class="merge-col side-a-bg">
                <strong>{{ mergeComparison.a.name }}</strong>
                <span>建档 {{ formatDate(mergeComparison.a.createdAt) }}</span>
                <span>{{ mergeProfileA.attempts.length }} 条记录 · 错词 {{ mergeComparison.aErrors.totalErrors }}</span>
              </div>
              <div class="merge-col side-b-bg">
                <strong>{{ mergeComparison.b.name }}</strong>
                <span>建档 {{ formatDate(mergeComparison.b.createdAt) }}</span>
                <span>{{ mergeProfileB.attempts.length }} 条记录 · 错词 {{ mergeComparison.bErrors.totalErrors }}</span>
              </div>
            </div>

            <div class="merge-grid">
              <div class="merge-col side-a-bg">
                <p class="merge-section-title">错词分类</p>
                <ul class="merge-meta-list">
                  <li v-for="key in CATEGORY_KEYS" :key="`a-${key}`"><span>{{ categoryLabels[key] }}</span><strong>{{ mergeComparison.aErrors.categories[key] }}</strong></li>
                  <li><span>未分类错词</span><strong>{{ unclassifiedCount('a') }}</strong></li>
                </ul>
                <p class="merge-section-title">教师反馈（{{ mergeComparison.aFeedback.length }}）</p>
                <div v-if="!mergeComparison.aFeedback.length" class="merge-empty">暂无反馈</div>
                <div v-for="item in mergeComparison.aFeedback" :key="item.attemptId" class="merge-feedback">
                  <strong>{{ item.lessonTitle }} · {{ formatDate(item.submittedAt) }}</strong>
                  <p>{{ item.feedback }}</p>
                </div>
              </div>
              <div class="merge-col side-b-bg">
                <p class="merge-section-title">错词分类</p>
                <ul class="merge-meta-list">
                  <li v-for="key in CATEGORY_KEYS" :key="`b-${key}`"><span>{{ categoryLabels[key] }}</span><strong>{{ mergeComparison.bErrors.categories[key] }}</strong></li>
                  <li><span>未分类错词</span><strong>{{ unclassifiedCount('b') }}</strong></li>
                </ul>
                <p class="merge-section-title">教师反馈（{{ mergeComparison.bFeedback.length }}）</p>
                <div v-if="!mergeComparison.bFeedback.length" class="merge-empty">暂无反馈</div>
                <div v-for="item in mergeComparison.bFeedback" :key="item.attemptId" class="merge-feedback">
                  <strong>{{ item.lessonTitle }} · {{ formatDate(item.submittedAt) }}</strong>
                  <p>{{ item.feedback }}</p>
                </div>
              </div>
            </div>
          </section>

          <section v-for="row in mergeComparison.lessons" :key="row.lessonId" class="panel merge-lesson">
            <div class="detail-head">
              <div>
                <h3>{{ row.lessonTitle }}</h3>
                <p v-if="row.onlySide === 'a'">仅 A 档有此课节，将整体并入</p>
                <p v-else-if="row.onlySide === 'b'">仅 B 档有此课节，将整体并入</p>
                <p v-else>两份档案都有此课节</p>
              </div>
            </div>

            <div class="merge-grid">
              <div class="merge-col side-a-bg">
                <p class="merge-section-title">课节进度</p>
                <p class="merge-muted">更新于 {{ formatDate(row.aProgressAt) }}</p>
                <p class="merge-section-title">未交草稿</p>
                <div v-if="!row.drafts.some((d) => d.a.trim())" class="merge-empty">无</div>
                <div v-for="d in row.drafts.filter((item) => item.a.trim())" :key="`da-${d.sentenceId}`" class="merge-draft"><span>{{ d.sentenceLabel }}</span><p>{{ d.a }}</p></div>
                <p class="merge-section-title">练习记录（{{ row.aAttempts.length }}）</p>
                <div v-if="!row.aAttempts.length" class="merge-empty">无</div>
                <div v-for="refItem in row.aAttempts" :key="`ra-${refItem.id}`" class="merge-attempt">
                  <strong>{{ refItem.score }} 分</strong><span>{{ formatDate(refItem.submittedAt) }} · {{ refItem.hasFeedback ? '有反馈' : '无反馈' }} · 已分类错词 {{ refItem.classifiedErrors }}</span>
                </div>
              </div>
              <div class="merge-col side-b-bg">
                <p class="merge-section-title">课节进度</p>
                <p class="merge-muted">更新于 {{ formatDate(row.bProgressAt) }}</p>
                <p class="merge-section-title">未交草稿</p>
                <div v-if="!row.drafts.some((d) => d.b.trim())" class="merge-empty">无</div>
                <div v-for="d in row.drafts.filter((item) => item.b.trim())" :key="`db-${d.sentenceId}`" class="merge-draft"><span>{{ d.sentenceLabel }}</span><p>{{ d.b }}</p></div>
                <p class="merge-section-title">练习记录（{{ row.bAttempts.length }}）</p>
                <div v-if="!row.bAttempts.length" class="merge-empty">无</div>
                <div v-for="refItem in row.bAttempts" :key="`rb-${refItem.id}`" class="merge-attempt">
                  <strong>{{ refItem.score }} 分</strong><span>{{ formatDate(refItem.submittedAt) }} · {{ refItem.hasFeedback ? '有反馈' : '无反馈' }} · 已分类错词 {{ refItem.classifiedErrors }}</span>
                </div>
              </div>
            </div>
          </section>

          <section v-if="conflictDrafts.length" class="panel">
            <div class="dictation-label" style="margin-top: 0"><strong>第三步 · 双份草稿逐句选择</strong><span>同一课节两边都有未交答案，两份都保留供选择</span></div>
            <div v-for="d in conflictDrafts" :key="`${d.lessonId}:${d.sentenceId}`" class="conflict-row">
              <p class="conflict-title">{{ lessonTitle(d.lessonId) }} · {{ d.sentenceLabel }}</p>
              <label class="conflict-option side-a-bg" :class="{ chosen: mergePlan.draftChoices[`${d.lessonId}:${d.sentenceId}`] === 'a' }">
                <input type="radio" :name="`draft-${d.lessonId}-${d.sentenceId}`" :checked="mergePlan.draftChoices[`${d.lessonId}:${d.sentenceId}`] === 'a'" @change="setDraftChoice(d.lessonId, d.sentenceId, 'a')" />
                <span class="merge-side-label side-a">A</span>
                <p>{{ d.a }}</p>
              </label>
              <label class="conflict-option side-b-bg" :class="{ chosen: mergePlan.draftChoices[`${d.lessonId}:${d.sentenceId}`] === 'b' }">
                <input type="radio" :name="`draft-${d.lessonId}-${d.sentenceId}`" :checked="mergePlan.draftChoices[`${d.lessonId}:${d.sentenceId}`] === 'b'" @change="setDraftChoice(d.lessonId, d.sentenceId, 'b')" />
                <span class="merge-side-label side-b">B</span>
                <p>{{ d.b }}</p>
              </label>
            </div>
            <p v-if="unresolvedConflicts.length" class="merge-hint danger">还有 {{ unresolvedConflicts.length }} 句双份草稿未选择。</p>
          </section>

          <section class="panel">
            <div class="dictation-label" style="margin-top: 0"><strong>第四步 · 选定保留档案并归并</strong><span>已提交记录按原时间并入，反馈与错词分类仍指回原课节</span></div>
            <div class="keep-grid">
              <button type="button" class="keep-card side-a-bg" :class="{ chosen: mergePlan.keepSide === 'a' }" @click="chooseKeep('a')">
                <span class="merge-side-label side-a">保留 A</span>
                <strong>{{ mergeComparison.a.name }}</strong>
                <span>保留其课节进度为基础，并入 B 的内容</span>
              </button>
              <button type="button" class="keep-card side-b-bg" :class="{ chosen: mergePlan.keepSide === 'b' }" @click="chooseKeep('b')">
                <span class="merge-side-label side-b">保留 B</span>
                <strong>{{ mergeComparison.b.name }}</strong>
                <span>保留其课节进度为基础，并入 A 的内容</span>
              </button>
            </div>
            <label class="name-field">
              <span>归并后学生姓名</span>
              <input v-model="mergePlan.keptName" placeholder="确认归并后的姓名" />
            </label>
            <p v-if="mergeError" class="merge-hint danger">{{ mergeError }}</p>
            <p v-else class="merge-hint">落盘后另一份档案将被移除；若写入失败，两份档案都会恢复原样。</p>
            <var-button block type="primary" :disabled="!!mergeError" @click="confirmMerge">确认归并并写入</var-button>
          </section>
        </template>

        <section v-if="mergeWriteFailed" class="panel merge-failed">
          <strong>写入失败</strong>
          <p>两份档案已恢复为归并前的原样，上面的选择仍然保留，可直接重新尝试。</p>
          <var-button block type="warning" @click="confirmMerge">重新尝试写入</var-button>
        </section>

        <template v-if="mergeCommitted">
          <section class="panel merge-done">
            <strong>归并完成</strong>
            <p>当前学生已切换为「{{ student.name }}」。下面是本次归并的差异清单。</p>
          </section>
          <section class="panel">
            <div class="dictation-label" style="margin-top: 0"><strong>归并差异清单</strong><span>{{ mergeDiffs.length }} 项</span></div>
            <ul class="diff-list">
              <li v-for="(diff, index) in mergeDiffs" :key="index" class="diff-item" :class="`diff-${diff.kind}`">
                <span class="diff-tag">{{ diff.side === 'a' ? 'A' : diff.side === 'b' ? 'B' : '合' }} · {{ diffKindLabel(diff.kind) }}</span>
                <p>{{ diff.text }}</p>
              </li>
            </ul>
            <var-button block type="primary" style="margin-top: 10px" @click="downloadRecords">导出归并后的练习记录</var-button>
            <var-button block type="default" variant="outline" style="margin-top: 10px" @click="finishMerge">完成，返回课程库</var-button>
          </section>
        </template>
      </div>

      <div v-if="toast" style="position: fixed; z-index: 30; left: 50%; bottom: 28px; transform: translateX(-50%); padding: 11px 16px; border-radius: 12px; background: #17233d; color: white; font-size: .78rem; box-shadow: 0 10px 30px rgb(0 0 0 / .2)">{{ toast }}</div>
    </div>
  </var-app>
</template>

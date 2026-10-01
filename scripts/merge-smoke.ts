// 纯逻辑冒烟测试：npx tsx scripts/merge-smoke.ts
import { createInitialState } from '../src/data';
import { buildMergeComparison, defaultPlan, executeMerge, validatePlan, deduplicateAttempts } from '../src/merge';
import type { MergeSide, PersistedState, StudentProfile } from '../src/types';

const state: PersistedState = createInitialState();
const coursesLessons = state.courses.flatMap((course) => course.lessons);
const a = state.students.find((student) => student.name === '林宁')!;
const b = state.students.find((student) => student.name === '林宁宁')!;

let failures = 0;
function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

console.log('1) 并排核对');
const comparison = buildMergeComparison(a, b, coursesLessons);
const airportRow = comparison.lessons.find((row) => row.lessonId === 'airport-01')!;
const meetingRow = comparison.lessons.find((row) => row.lessonId === 'meeting-01')!;
check('airport-01 两边都有', !airportRow.onlySide);
check('meeting-01 仅 B 档', meetingRow.onlySide === 'b');
check('airport-01 检出双份草稿句（s2）', airportRow.drafts.some((d) => d.sentenceId === 'airport-01-s2' && d.conflict));
check('s1 仅 A 档有草稿不冲突', airportRow.drafts.find((d) => d.sentenceId === 'airport-01-s1')?.conflict === false);
check('A 错词统计为 1（标点）', comparison.aErrors.totalErrors === 1, String(comparison.aErrors.totalErrors));
check('B 错词统计为 4（2 标点 + 2 漏词）', comparison.bErrors.totalErrors === 4, String(comparison.bErrors.totalErrors));
check('B 漏词分类为 2', comparison.bErrors.categories.omitted === 2);
check('教师反馈两边各有 1 条', comparison.aFeedback.length === 1 && comparison.bFeedback.length === 1);

console.log('2) 未选定前不允许归并');
const emptyPlan = { keepSide: null, draftChoices: {}, keptName: '' };
check('缺 keepSide 校验失败', validatePlan(comparison, emptyPlan) !== null);
const plan = defaultPlan(comparison);
check('默认保留 A', plan.keepSide === 'a');
check('默认计划可通过校验', validatePlan(comparison, plan) === null);
// 清空一个冲突选择后应失败
const broken: typeof plan = { ...plan, draftChoices: { ...plan.draftChoices } };
delete broken.draftChoices['airport-01:airport-01-s2'];
check('未选择的双份草稿会被拦下', validatePlan(comparison, broken) !== null);

console.log('3) 保留 A，双份草稿 s2 改选 B');
plan.draftChoices['airport-01:airport-01-s2'] = 'b';
plan.keptName = '林宁宁（归并）';
const result = executeMerge(plan, a, b);
const merged: StudentProfile = result.merged;
check('保留 A 的 id', merged.id === a.id);
check('归并后姓名生效', merged.name === '林宁宁（归并）');
check('mergedFrom 记录旧姓名', merged.mergedFrom.includes('林宁宁'));
check('练习记录总数为 3（1+2，按时间并入）', merged.attempts.length === 3, String(merged.attempts.length));
const times = merged.attempts.map((attempt) => attempt.submittedAt);
check('练习记录保持时间倒序', JSON.stringify(times) === JSON.stringify([...times].sort().reverse()));
check('s2 双份草稿采用 B 答案', merged.progress['airport-01'].answers['airport-01-s2'] === b.progress['airport-01'].answers['airport-01-s2']);
check('s1 A 档草稿保留', merged.progress['airport-01'].answers['airport-01-s1'] === a.progress['airport-01'].answers['airport-01-s1']);
check('meeting-01 仅 B 的进度并入', !!merged.progress['meeting-01']);
check('airport-02 仅 A 的进度并入', !!merged.progress['airport-02']);
check('教师反馈随原记录保留（A 旧记录）', merged.attempts.find((x) => x.id === 'attempt-lining-airport-01')?.teacherFeedback.includes('bags are'));
check('教师反馈随原记录保留（B 新记录）', merged.attempts.find((x) => x.id === 'attempt-linning-airport-01')?.teacherFeedback.includes('标点齐全'));
check('错词分类仍指回原记录', merged.attempts.find((x) => x.id === 'attempt-linning-meeting-01')?.sentenceAttempts[0].tokens.find((t) => t.reason.includes('sure')) !== undefined);
check('差异清单包含记录与反馈', result.diffs.some((d) => d.kind === 'record') && result.diffs.some((d) => d.kind === 'feedback'));

console.log('4) 反向：保留 B，草稿默认跟 B');
const planB = defaultPlan(comparison);
planB.keepSide = 'b';
planB.keptName = '林宁宁';
for (const row of comparison.lessons) for (const d of row.drafts) if (d.conflict) planB.draftChoices[`${d.lessonId}:${d.sentenceId}`] = 'b' as MergeSide;
const resultB = executeMerge(planB, b, a);
check('保留 B 的 id', resultB.merged.id === b.id);
check('记录仍为 3 条', resultB.merged.attempts.length === 3);
check('s2 草稿为 B 版', resultB.merged.progress['airport-01'].answers['airport-01-s2'] === b.progress['airport-01'].answers['airport-01-s2']);

console.log('5) 去重计数');
const dupes = [...merged.attempts, ...merged.attempts];
check('重复 id 只计一次', deduplicateAttempts(dupes).length === merged.attempts.length);

console.log('6) 原始档案未被纯函数改动（事务失败可恢复）');
check('A 档案仍为 1 条记录', a.attempts.length === 1);
check('B 档案仍为 2 条记录', b.attempts.length === 2);
check('A 档案仍保留自己的 s2 草稿（未被纯函数改动）', a.progress['airport-01'].answers['airport-01-s2'] === 'Could I have a window seat please');

if (failures) {
  console.error(`\n${failures} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');

// 事务回滚冒烟测试：模拟 localStorage.setItem 抛错，验证两份档案恢复原样且可重试。
// 运行：npx tsx scripts/store-rollback.ts
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { rmSync, writeFileSync } from 'node:fs';

class MemoryStorage {
  data = new Map<string, string>();
  failing = false;
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string) {
    if (this.failing) throw new Error('QuotaExceededError (simulated)');
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  clear() {
    this.data.clear();
  }
}

const storage = new MemoryStorage();
// @ts-expect-error - Node 环境注入最小浏览器垫片
globalThis.localStorage = storage;

// 将 store 与 merge 打包成单文件（vue external，随后提供解析别名）。
const result = await build({
  entryPoints: ['src/store.ts', 'src/merge.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false,
  external: ['vue'],
  outdir: 'scripts/.tmp'
});
for (const file of result.outputFiles) {
  const outName = file.path.split('/').pop() === 'store.js' ? '.store-bundle.mjs' : '.merge-bundle.mjs';
  writeFileSync(`scripts/${outName}`, file.text.replaceAll("from 'vue'", `from '${pathToFileURL(process.cwd() + '/node_modules/vue/dist/vue.runtime.esm-bundler.js').href}'`));
}

const { state, commitMerge } = await import('./.store-bundle.mjs');
const { buildMergeComparison, defaultPlan, executeMerge } = await import('./.merge-bundle.mjs');

let failures = 0;
function check(name: string, condition: boolean, detail = '') {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

const lessons = state.courses.flatMap((course: { lessons: unknown[] }) => course.lessons);
const snapshot = () => JSON.stringify({ count: state.students.length, ids: state.students.map((s: { id: string }) => s.id), active: state.activeStudentId });
const before = snapshot();
console.log('初始：', before);

function planMerge() {
  const a = state.students[0];
  const b = state.students[1];
  return executeMerge(defaultPlan(buildMergeComparison(a, b, lessons)), a, b);
}

console.log('1) 写入失败回滚');
storage.clear();
storage.failing = true;
const failed = commitMerge(planMerge());
storage.failing = false;
check('commitMerge 返回 false', failed === false);
check('两份档案都还在', state.students.length === 2);
check('档案与归并前完全一致', snapshot() === before, `\n     before=${before}\n     after =${snapshot()}`);
check('失败后没有留下半成品落盘', storage.data.size === 0, `size=${storage.data.size}`);

console.log('2) 失败后可重新尝试');
const ok = commitMerge(planMerge());
check('重试返回 true', ok === true);
check('只剩 1 份档案', state.students.length === 1);
check('当前学生为保留档案', state.activeStudentId === 'student-lining');
const persisted = JSON.parse(storage.getItem('sologsb-1029-dictation-state-v1'));
check('落盘内容同样只剩 1 份档案', persisted.students.length === 1);
check('落盘记录按原时间并入共 3 条', persisted.students[0].attempts.length === 3);
check('两条教师反馈都随原记录保留', persisted.students[0].attempts.filter((x: { teacherFeedback: string }) => x.teacherFeedback).length === 2);

rmSync('scripts/.tmp', { recursive: true, force: true });
rmSync('scripts/.store-bundle.mjs', { force: true });
rmSync('scripts/.merge-bundle.mjs', { force: true });

if (failures) {
  console.error(`\n${failures} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');

import type { Course, PersistedState, StudentProfile } from './types';

export const demoCourses: Course[] = [
  {
    id: 'daily-life',
    title: '日常英语 · 机场与出行',
    description: '围绕值机、安检、问路和登机场景进行短句听写。',
    level: 'A2',
    accent: '#1769e0',
    lessons: [
      {
        id: 'airport-01',
        courseId: 'daily-life',
        title: '办理值机',
        subtitle: 'Check-in conversation',
        level: '入门',
        estimatedMinutes: 6,
        downloaded: true,
        sentences: [
          { id: 'airport-01-s1', text: 'I would like to check in for my flight to London.', translation: '我想办理飞往伦敦的航班值机。', note: 'check in 连读时重音落在 check。' },
          { id: 'airport-01-s2', text: 'Could I have a window seat, please?', translation: '请问可以给我一个靠窗座位吗？', note: 'Could I 的 d 与 I 连读较轻。' },
          { id: 'airport-01-s3', text: 'How many bags are you checking in today?', translation: '您今天要托运几件行李？', note: 'bags are 中 s 与 a 连读。' },
          { id: 'airport-01-s4', text: 'Your gate is B twelve and boarding starts at six thirty.', translation: '您的登机口是 B12，六点半开始登机。', note: 'B twelve 按字母 B 加数字读。' }
        ]
      },
      {
        id: 'airport-02',
        courseId: 'daily-life',
        title: '安检提示',
        subtitle: 'Security screening',
        level: '入门',
        estimatedMinutes: 5,
        downloaded: false,
        sentences: [
          { id: 'airport-02-s1', text: 'Please place your laptop in a separate tray.', translation: '请把笔记本电脑单独放在一个托盘里。', note: 'place 的结尾辅音与 your 连读。' },
          { id: 'airport-02-s2', text: 'Remove any metal objects from your pockets.', translation: '请取出所有口袋里的金属物品。', note: 'objects from 中 t 可弱读。' },
          { id: 'airport-02-s3', text: 'You may proceed through the security checkpoint.', translation: '您可以通过安全检查点了。', note: 'proceed through 的 /d/ 与 /θ/ 相接。' }
        ]
      }
    ]
  },
  {
    id: 'workplace',
    title: '职场英语 · 会议沟通',
    description: '练习会议中的观点确认、追问和行动项复述。',
    level: 'B1',
    accent: '#7a3dc4',
    lessons: [
      {
        id: 'meeting-01',
        courseId: 'workplace',
        title: '确认行动项',
        subtitle: 'Confirming action items',
        level: '进阶',
        estimatedMinutes: 7,
        downloaded: false,
        sentences: [
          { id: 'meeting-01-s1', text: 'Let me make sure I understand the next step.', translation: '让我确认一下是否理解下一步。', note: 'make sure 常连读为 /meɪkʃʊr/。' },
          { id: 'meeting-01-s2', text: 'I will share the revised draft by Thursday afternoon.', translation: '我会在周四下午前分享修订稿。', note: 'revised draft 的 d 音相连。' },
          { id: 'meeting-01-s3', text: 'Who will follow up with the design team?', translation: '谁会和设计团队跟进？', note: 'follow up with 要连贯。' }
        ]
      }
    ]
  }
];

/** 同一学生改名前的旧档案：练习记录较早，课节进度停在办理值机。 */
const studentLining: StudentProfile = {
  id: 'student-lining',
  name: '林宁',
  createdAt: '2026-09-18T08:00:00.000Z',
  mergedFrom: [],
  attempts: [
    {
      id: 'attempt-lining-airport-01',
      lessonId: 'airport-01',
      lessonTitle: '办理值机',
      courseTitle: '日常英语 · 机场与出行',
      submittedAt: '2026-09-20T10:20:00.000Z',
      score: 92,
      teacherFeedback: '连读细节明显进步。注意 bags are 的词尾衔接，再听一遍第二句。',
      sentenceAttempts: [
        {
          sentenceId: 'airport-01-s1',
          source: 'I would like to check in for my flight to London.',
          answer: 'I would like to check in for my flight to London',
          score: 92,
          tokens: [
            { index: 0, expected: 'I', actual: 'I', correct: true, category: 'unclassified', reason: '' },
            { index: 1, expected: 'would', actual: 'would', correct: true, category: 'unclassified', reason: '' },
            { index: 2, expected: 'like', actual: 'like', correct: true, category: 'unclassified', reason: '' },
            { index: 3, expected: 'to', actual: 'to', correct: true, category: 'unclassified', reason: '' },
            { index: 4, expected: 'check', actual: 'check', correct: true, category: 'unclassified', reason: '' },
            { index: 5, expected: 'in', actual: 'in', correct: true, category: 'unclassified', reason: '' },
            { index: 6, expected: 'for', actual: 'for', correct: true, category: 'unclassified', reason: '' },
            { index: 7, expected: 'my', actual: 'my', correct: true, category: 'unclassified', reason: '' },
            { index: 8, expected: 'flight', actual: 'flight', correct: true, category: 'unclassified', reason: '' },
            { index: 9, expected: 'to', actual: 'to', correct: true, category: 'unclassified', reason: '' },
            { index: 10, expected: 'London', actual: 'London', correct: true, category: 'unclassified', reason: '' },
            { index: 11, expected: '.', actual: '', correct: false, category: 'punctuation', reason: '句末标点习惯性漏掉' }
          ]
        }
      ]
    }
  ],
  progress: {
    'airport-01': {
      answers: {
        'airport-01-s1': 'I would like to check in for my flight to London',
        'airport-01-s2': 'Could I have a window seat please'
      },
      activeSentenceId: 'airport-01-s2',
      updatedAt: '2026-09-20T10:10:00.000Z'
    },
    'airport-02': {
      answers: { 'airport-02-s1': 'Please place your laptop in a separate tray' },
      activeSentenceId: 'airport-02-s1',
      updatedAt: '2026-09-21T09:00:00.000Z'
    }
  }
};

/** 改名后的新档案：练习记录较新，课节进度推进到了确认行动项；办理值机一课两边都留有未交草稿。 */
const studentLinNing: StudentProfile = {
  id: 'student-lin-ning',
  name: '林宁宁',
  createdAt: '2026-09-25T08:00:00.000Z',
  mergedFrom: [],
  attempts: [
    {
      id: 'attempt-linning-airport-01',
      lessonId: 'airport-01',
      lessonTitle: '办理值机',
      courseTitle: '日常英语 · 机场与出行',
      submittedAt: '2026-09-26T03:30:00.000Z',
      score: 78,
      teacherFeedback: '第二次提交标点齐全，保持。',
      sentenceAttempts: [
        {
          sentenceId: 'airport-01-s2',
          source: 'Could I have a window seat, please?',
          answer: 'Could I have a window seat please',
          score: 78,
          tokens: [
            { index: 0, expected: 'Could', actual: 'Could', correct: true, category: 'unclassified', reason: '' },
            { index: 1, expected: 'I', actual: 'I', correct: true, category: 'unclassified', reason: '' },
            { index: 2, expected: 'have', actual: 'have', correct: true, category: 'unclassified', reason: '' },
            { index: 3, expected: 'a', actual: 'a', correct: true, category: 'unclassified', reason: '' },
            { index: 4, expected: 'window', actual: 'window', correct: true, category: 'unclassified', reason: '' },
            { index: 5, expected: 'seat', actual: 'seat', correct: true, category: 'unclassified', reason: '' },
            { index: 6, expected: ',', actual: '', correct: false, category: 'punctuation', reason: '' },
            { index: 7, expected: 'please', actual: 'please', correct: true, category: 'unclassified', reason: '' },
            { index: 8, expected: '?', actual: '', correct: false, category: 'punctuation', reason: '' }
          ]
        }
      ]
    },
    {
      id: 'attempt-linning-meeting-01',
      lessonId: 'meeting-01',
      lessonTitle: '确认行动项',
      courseTitle: '职场英语 · 会议沟通',
      submittedAt: '2026-09-28T07:05:00.000Z',
      score: 80,
      teacherFeedback: '',
      sentenceAttempts: [
        {
          sentenceId: 'meeting-01-s1',
          source: 'Let me make sure I understand the next step.',
          answer: 'Let me make I understand next step.',
          score: 80,
          tokens: [
            { index: 0, expected: 'Let', actual: 'Let', correct: true, category: 'unclassified', reason: '' },
            { index: 1, expected: 'me', actual: 'me', correct: true, category: 'unclassified', reason: '' },
            { index: 2, expected: 'make', actual: 'make', correct: true, category: 'unclassified', reason: '' },
            { index: 3, expected: 'sure', actual: '', correct: false, category: 'omitted', reason: 'make sure 连读没听出 sure' },
            { index: 4, expected: 'I', actual: 'I', correct: true, category: 'unclassified', reason: '' },
            { index: 5, expected: 'understand', actual: 'understand', correct: true, category: 'unclassified', reason: '' },
            { index: 6, expected: 'the', actual: '', correct: false, category: 'omitted', reason: '' },
            { index: 7, expected: 'next', actual: 'next', correct: true, category: 'unclassified', reason: '' },
            { index: 8, expected: 'step', actual: 'step', correct: true, category: 'unclassified', reason: '' },
            { index: 9, expected: '.', actual: '.', correct: true, category: 'unclassified', reason: '' }
          ]
        }
      ]
    }
  ],
  progress: {
    'airport-01': {
      answers: { 'airport-01-s2': 'Could I have a window seat?' },
      activeSentenceId: 'airport-01-s3',
      updatedAt: '2026-09-27T12:00:00.000Z'
    },
    'meeting-01': {
      answers: {
        'meeting-01-s1': 'Let me make sure I understand the next step.',
        'meeting-01-s2': 'I will share the revised draft by Thursday'
      },
      activeSentenceId: 'meeting-01-s2',
      updatedAt: '2026-09-29T02:10:00.000Z'
    }
  }
};

export const createInitialState = (): PersistedState => ({
  schemaVersion: 2,
  courses: structuredClone(demoCourses),
  students: [structuredClone(studentLining), structuredClone(studentLinNing)],
  activeStudentId: 'student-lin-ning',
  activeLessonId: '',
  activeSentenceId: '',
  theme: 'light',
  fontScale: 1,
  role: 'learner'
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractHeadings,
  extractCodeBlocks,
  normalizeText,
  searchCourses,
  slugify,
} from '../assets/learning-utils.mjs';

test('slugify creates stable ascii route keys', () => {
  assert.equal(slugify('第 2 课：Prompt 是工作委托'), '2-prompt');
  assert.equal(slugify('AI 输出验收法'), 'ai');
});

test('extractHeadings ignores headings inside fenced code blocks', () => {
  const markdown = [
    '# 第 5 课：Markdown 15 分钟入门',
    '',
    '## 一、先记住这三句话',
    '',
    '```markdown',
    '# 会议纪要',
    '## 行动项',
    '```',
    '',
    '## 二、为什么 AI 时代更需要 Markdown',
  ].join('\n');

  assert.deepEqual(extractHeadings(markdown), [
    { depth: 1, text: '第 5 课：Markdown 15 分钟入门', id: '5-markdown-15' },
    { depth: 2, text: '一、先记住这三句话', id: 'section-1' },
    { depth: 2, text: '二、为什么 AI 时代更需要 Markdown', id: 'ai-markdown' },
  ]);
});

test('extractCodeBlocks supports nested markdown examples with longer fences', () => {
  const markdown = [
    '````markdown',
    '```text',
    '原始材料',
    '```',
    '````',
  ].join('\n');

  assert.deepEqual(extractCodeBlocks(markdown), [
    { language: 'markdown', code: '```text\n原始材料\n```' },
  ]);
});

test('normalizeText makes Chinese and ascii search predictable', () => {
  assert.equal(normalizeText('Prompt 是工作委托，不是搜索框'), 'prompt 是工作委托 不是搜索框');
});

test('searchCourses searches title, tags, summary, publisher, primary category, and secondary category', () => {
  const courses = [
    {
      title: 'AI 输出验收法',
      summary: '审核 AI 输出，避免幻觉和过度承诺',
      publisher: '信息化中心',
      primaryCategory: '技能类',
      secondaryCategory: 'AI技能',
      tags: ['AI', '安全'],
      disabled: false,
    },
    {
      title: '新任管理者入门',
      summary: '团队目标和反馈',
      publisher: '组织发展中心',
      primaryCategory: '管理类',
      secondaryCategory: '管理基础',
      tags: ['管理'],
      disabled: true,
    },
  ];

  assert.equal(searchCourses(courses, '验收').length, 1);
  assert.equal(searchCourses(courses, '信息化').length, 1);
  assert.equal(searchCourses(courses, '管理类').length, 1);
  assert.equal(searchCourses(courses, 'AI技能').length, 1);
  assert.equal(searchCourses(courses, '', { primaryCategory: '技能类' }).length, 1);
  assert.equal(searchCourses(courses, '', { secondaryCategory: '管理基础' }).length, 1);
});

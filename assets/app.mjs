import { courses, platform, categories } from '../data/courses.mjs';
import {
  escapeHtml,
  extractHeadings,
  getNextLesson,
  getUniqueValues,
  isTableStart,
  renderInlineMarkdown,
  searchCourses,
  splitTableRow,
} from './learning-utils.mjs';

const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const markdownCache = new Map();
const progressKey = 'qingcong-learning-progress';
const lastLessonKey = 'qingcong-learning-last-lesson';
let shouldScrollCourseTop = false;

function getProgress() {
  try {
    return JSON.parse(localStorage.getItem(progressKey) || '{}');
  } catch {
    return {};
  }
}

function setProgress(courseId, done) {
  const progress = getProgress();
  progress[courseId] = Boolean(done);
  localStorage.setItem(progressKey, JSON.stringify(progress));
}

function getCurrentRoute() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  if (!hash) return { page: 'home' };
  const [page, id] = hash.split('/');
  return { page, id };
}

function goHome() {
  window.location.hash = '#/';
}

function goCourse(courseId) {
  shouldScrollCourseTop = true;
  const targetHash = `#/course/${courseId}`;
  if (window.location.hash === targetHash) {
    renderCourse(courseId);
  } else {
    window.location.hash = targetHash;
  }
}

function getPrimaryCategory(course) {
  return course.primaryCategory || course.category || '未分类';
}

function getSecondaryCategory(course) {
  return course.secondaryCategory || '未细分';
}

function getCategoryTrail(course) {
  return `${getPrimaryCategory(course)} / ${getSecondaryCategory(course)}`;
}

async function loadMarkdown(course) {
  if (!course?.path) return '';
  if (markdownCache.has(course.id)) return markdownCache.get(course.id);
  const response = await fetch(course.path);
  if (!response.ok) throw new Error(`无法加载课程内容：${course.title}`);
  const markdown = await response.text();
  markdownCache.set(course.id, markdown);
  return markdown;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.setTimeout(() => toast.classList.remove('is-visible'), 1800);
}

function renderShell(content) {
  app.innerHTML = `
    <header class="topbar">
      <button class="brand" type="button" data-home>
        <img src="${platform.logo}" alt="" class="brand-logo">
        <span>
          <strong>${platform.name}</strong>
          <small>${platform.heroTitle}</small>
        </span>
      </button>
      <nav class="topnav" aria-label="主导航">
        <a href="#/">首页</a>
      </nav>
    </header>
    ${content}
  `;
  document.querySelectorAll('[data-home]').forEach((button) => {
    button.addEventListener('click', goHome);
  });
}

function courseCard(course, progress) {
  const disabled = course.disabled;
  const done = progress[course.id];
  const tagHtml = course.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('');
  return `
    <article class="course-card ${disabled ? 'is-disabled' : ''}" data-course-card="${course.id}">
      <div class="course-card-top">
        <span class="pill">${escapeHtml(getPrimaryCategory(course))}</span>
        <span class="pill pill-secondary">${escapeHtml(getSecondaryCategory(course))}</span>
        <span class="status ${done ? 'is-done' : ''}">${disabled ? '即将开放' : done ? '已读' : '可学习'}</span>
      </div>
      <h3>${escapeHtml(course.title)}</h3>
      <p>${escapeHtml(course.summary)}</p>
      <div class="card-meta">
        <span>发行中心：${escapeHtml(course.publisher)}</span>
        <span>${escapeHtml(course.duration)}</span>
      </div>
      <div class="tag-row">${tagHtml}</div>
    </article>
  `;
}

function renderHome() {
  const progress = getProgress();
  const enabled = courses.filter((course) => !course.disabled);
  const completed = enabled.filter((course) => progress[course.id]).length;
  const lastLesson = localStorage.getItem(lastLessonKey) || enabled[0]?.id;
  const publishers = getUniqueValues(courses, 'publisher');
  const secondaryCategories = getUniqueValues(courses, 'secondaryCategory');
  const savedCategory = sessionStorage.getItem('home-category') || 'all';
  sessionStorage.removeItem('home-category');

  renderShell(`
    <main class="home-page">
      <section class="hero">
        <div class="hero-copy">
          <img src="${platform.logo}" alt="青丛成长实验室 Logo" class="hero-logo">
          <div>
            <p class="eyebrow">${escapeHtml(platform.name)}</p>
            <h1>${escapeHtml(platform.heroTitle)}</h1>
            <p class="hero-subtitle">${escapeHtml(platform.subtitle)}</p>
          </div>
        </div>
        <div class="hero-panel" aria-label="学习进度">
          <strong>${completed}/${enabled.length}</strong>
          <span>已完成课时</span>
          <button class="primary-action" type="button" data-continue>继续学习</button>
        </div>
      </section>

      <section class="controls" aria-label="课程检索">
        <label class="search-box">
          <span>搜索课程</span>
          <input id="searchInput" type="search" placeholder="输入标题、关键词、发行中心或二级类目">
        </label>
        <label>
          <span>一级类目</span>
          <select id="primaryCategoryFilter">
            <option value="all">全部一级类目</option>
            ${categories.map((category) => `<option value="${category}" ${category === savedCategory ? 'selected' : ''}>${category}</option>`).join('')}
          </select>
        </label>
        <label>
          <span>二级类目</span>
          <select id="secondaryCategoryFilter">
            <option value="all">全部二级类目</option>
            ${secondaryCategories.map((category) => `<option value="${category}">${category}</option>`).join('')}
          </select>
        </label>
        <label>
          <span>发行中心</span>
          <select id="publisherFilter">
            <option value="all">全部中心</option>
            ${publishers.map((publisher) => `<option value="${publisher}">${publisher}</option>`).join('')}
          </select>
        </label>
      </section>

      <section class="catalog">
        <div class="section-title">
          <div>
            <p class="eyebrow">课程分区</p>
            <h2>资料目录</h2>
          </div>
          <p>当前首批开放技能类 / AI技能 8 课，其他一级类目与二级类目以占位形式展示，便于后续扩展。</p>
        </div>
        <div id="courseGrid" class="course-grid"></div>
      </section>
    </main>
  `);

  const searchInput = document.querySelector('#searchInput');
  const primaryCategoryFilter = document.querySelector('#primaryCategoryFilter');
  const secondaryCategoryFilter = document.querySelector('#secondaryCategoryFilter');
  const publisherFilter = document.querySelector('#publisherFilter');
  const grid = document.querySelector('#courseGrid');

  function syncGrid() {
    const filtered = searchCourses(courses, searchInput.value, {
      primaryCategory: primaryCategoryFilter.value,
      secondaryCategory: secondaryCategoryFilter.value,
      publisher: publisherFilter.value,
    });
    grid.innerHTML = filtered.length
      ? filtered.map((course) => courseCard(course, progress)).join('')
      : '<div class="empty-state">没有找到匹配课程。可以换一个关键词或清空筛选条件。</div>';

    grid.querySelectorAll('[data-course-card]').forEach((card) => {
      const course = courses.find((item) => item.id === card.dataset.courseCard);
      if (course?.disabled) return;
      card.addEventListener('click', () => goCourse(course.id));
    });
  }

  document.querySelector('[data-continue]')?.addEventListener('click', () => goCourse(lastLesson));
  [searchInput, primaryCategoryFilter, secondaryCategoryFilter, publisherFilter].forEach((control) => {
    control.addEventListener('input', syncGrid);
    control.addEventListener('change', syncGrid);
  });
  syncGrid();
}

function filterMarkdown(markdown, mode) {
  if (mode === 'all') return markdown;
  const lines = markdown.split(/\r?\n/);
  const groups = [];
  let current = [];

  for (const line of lines) {
    if (/^##\s+/.test(line) && current.length) {
      groups.push(current.join('\n'));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length) groups.push(current.join('\n'));

  const tests = {
    templates: /(模板|可复制|Prompt|委托|验收表|通用)/i,
    examples: /(示例|原始|可能得到|场景|案例)/,
    exercises: /(自测|课后练习|题目|练习|答案)/,
  };
  const test = tests[mode];
  return groups.filter((group, index) => index === 0 || test.test(group)).join('\n\n');
}

function renderMarkdown(markdown) {
  const headings = extractHeadings(markdown);
  const lines = markdown.split(/\r?\n/);
  const html = [];
  let index = 0;
  let headingIndex = 0;

  function isAnswerText(text) {
    return /^(标准答案|参考答案|答案|解释|解析)：/.test(text);
  }

  function isParagraphBreak(position) {
    return (
      position >= lines.length ||
      !lines[position].trim() ||
      /^(#{1,4})\s+/.test(lines[position]) ||
      /^(`{3,})/.test(lines[position]) ||
      /^>\s+/.test(lines[position]) ||
      /^\s*[-*]\s+/.test(lines[position]) ||
      /^\s*\d+\.\s+/.test(lines[position]) ||
      isTableStart(lines, position)
    );
  }

  function renderIntroMeta(paragraph) {
    const meta = new Map();
    paragraph.forEach((line) => {
      const match = line.trim().match(/^([^：]+)：\s*(.+)$/);
      if (match) meta.set(match[1], match[2]);
    });
    if (!meta.has('版本日期') || !meta.has('预计阅读时间') || !meta.has('课程目标')) return '';

    return `
      <section class="lesson-intro-meta" aria-label="课程信息">
        ${['版本日期', '预计阅读时间', '课程目标'].map((label) => `
          <div class="meta-item">
            <span>${label}</span>
            <strong>${renderInlineMarkdown(meta.get(label))}</strong>
          </div>
        `).join('')}
      </section>
    `;
  }

  function flushParagraph(paragraph) {
    if (!paragraph.length) return;
    const metaHtml = renderIntroMeta(paragraph);
    if (metaHtml) {
      html.push(metaHtml);
      return;
    }
    const text = paragraph.join(' ').trim();
    html.push(`<p>${renderInlineMarkdown(text)}</p>`);
  }

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^(`{3,})([A-Za-z0-9_-]*)\s*$/);
    if (fence) {
      const fenceLength = fence[1].length;
      const language = fence[2] || 'text';
      const code = [];
      index += 1;
      while (index < lines.length) {
        const maybeClose = lines[index].match(/^(`{3,})\s*$/);
        if (maybeClose && maybeClose[1].length >= fenceLength) break;
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      const codeText = code.join('\n');
      html.push(`
        <div class="code-card">
          <div class="code-card-head">
            <span>${escapeHtml(language)}</span>
            <button type="button" data-copy="${escapeHtml(codeText)}">复制</button>
          </div>
          <pre><code>${escapeHtml(codeText)}</code></pre>
        </div>
      `);
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const depth = headingMatch[1].length;
      const heading = headings[headingIndex++] || { id: '', text: headingMatch[2] };
      const className = depth === 2 ? headingClass(heading.text) : '';
      html.push(`<h${depth} id="${heading.id}" class="${className}">${renderInlineMarkdown(heading.text)}</h${depth}>`);
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const header = splitTableRow(lines[index]);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      html.push(`
        <div class="table-wrap">
          <table>
            <thead><tr>${header.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join('')}</tr></thead>
            <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>
        </div>
      `);
      continue;
    }

    if (/^>\s+/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s+/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s+/, ''));
        index += 1;
      }
      html.push(`<blockquote>${quote.map(renderInlineMarkdown).join('<br>')}</blockquote>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        const item = lines[index].replace(/^\s*[-*]\s+/, '');
        const task = item.match(/^\[( |x)\]\s+(.+)$/i);
        items.push(task
          ? `<li class="task-item"><input type="checkbox" disabled ${task[1].toLowerCase() === 'x' ? 'checked' : ''}>${renderInlineMarkdown(task[2])}</li>`
          : `<li>${renderInlineMarkdown(item)}</li>`);
        index += 1;
      }
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(`<li>${renderInlineMarkdown(lines[index].replace(/^\s*\d+\.\s+/, ''))}</li>`);
        index += 1;
      }
      html.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    const paragraph = [];
    while (!isParagraphBreak(index)) {
      paragraph.push(lines[index]);
      index += 1;
    }
    const text = paragraph.join(' ').trim();
    if (isAnswerText(text)) {
      const answerParts = [text];
      let scan = index;
      while (scan < lines.length) {
        while (scan < lines.length && !lines[scan].trim()) scan += 1;
        if (isParagraphBreak(scan)) break;
        const nextParagraph = [];
        while (!isParagraphBreak(scan)) {
          nextParagraph.push(lines[scan]);
          scan += 1;
        }
        const nextText = nextParagraph.join(' ').trim();
        if (!isAnswerText(nextText)) break;
        answerParts.push(nextText);
        index = scan;
      }
      html.push(`
        <details class="answer">
          <summary>查看答案/解析</summary>
          ${answerParts.map((part) => `<p>${renderInlineMarkdown(part)}</p>`).join('')}
        </details>
      `);
    } else {
      flushParagraph(paragraph);
    }
  }

  return html.join('\n');
}

function headingClass(text) {
  if (/先记住/.test(text)) return 'heading-memory';
  if (/红线|风险|安全|验收|检查/.test(text)) return 'heading-risk';
  if (/模板|Prompt|可复制/.test(text)) return 'heading-template';
  if (/自测|练习|题目/.test(text)) return 'heading-practice';
  if (/总结/.test(text)) return 'heading-summary';
  return '';
}

async function renderCourse(courseId, mode = 'all') {
  const course = courses.find((item) => item.id === courseId && !item.disabled);
  if (!course) {
    renderHome();
    return;
  }
  localStorage.setItem(lastLessonKey, course.id);

  let markdown = '';
  try {
    markdown = await loadMarkdown(course);
  } catch (error) {
    renderShell(`<main class="error-page"><h1>课程加载失败</h1><p>${escapeHtml(error.message)}</p></main>`);
    return;
  }

  const filteredMarkdown = filterMarkdown(markdown, mode);
  const headings = extractHeadings(filteredMarkdown).filter((heading) => heading.depth === 2);
  const enabledCourses = courses.filter((item) => !item.disabled);
  const previous = getNextLesson(courses, course.id, -1);
  const next = getNextLesson(courses, course.id, 1);
  const progress = getProgress();

  renderShell(`
    <main class="lesson-layout">
      <aside class="lesson-sidebar" aria-label="课程导航">
        <button class="back-link" type="button" data-back-home>返回首页</button>
        <h2>课程列表</h2>
        <nav class="lesson-list">
          ${enabledCourses.map((item) => `
            <button type="button" class="${item.id === course.id ? 'is-active' : ''}" data-go-course="${item.id}">
              <span>第 ${item.lessonNo} 课</span>
              <strong>${escapeHtml(item.title)}</strong>
            </button>
          `).join('')}
        </nav>
      </aside>

      <article class="lesson-main">
        <header class="lesson-hero">
          <p class="eyebrow">${escapeHtml(course.publisher)} · ${escapeHtml(getCategoryTrail(course))}</p>
          <h1>${escapeHtml(course.title)}</h1>
          <p>${escapeHtml(course.summary)}</p>
          <div class="lesson-meta">
            <span>${escapeHtml(course.duration)}</span>
            <span>${escapeHtml(course.level)}</span>
            ${course.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}
          </div>
        </header>

        <div class="lesson-tools" aria-label="内容筛选">
          ${[
            ['all', '全部'],
            ['templates', '只看模板'],
            ['examples', '只看示例'],
            ['exercises', '只看习题'],
          ].map(([value, label]) => `<button type="button" class="${mode === value ? 'is-active' : ''}" data-mode="${value}">${label}</button>`).join('')}
          <button type="button" class="${progress[course.id] ? 'is-complete' : ''}" data-mark-read>${progress[course.id] ? '已标记完成' : '标记完成'}</button>
        </div>

        <div class="lesson-content">
          ${renderMarkdown(filteredMarkdown)}
        </div>

        <footer class="lesson-pager">
          ${previous ? `<button type="button" data-go-course="${previous.id}">上一课：${escapeHtml(previous.title)}</button>` : '<span></span>'}
          ${next ? `<button type="button" data-go-course="${next.id}">下一课：${escapeHtml(next.title)}</button>` : '<span></span>'}
        </footer>
      </article>

      <aside class="toc" aria-label="本课目录">
        <h2>本课目录</h2>
        ${headings.length ? headings.map((heading) => `<button type="button" data-scroll-target="${heading.id}">${escapeHtml(heading.text)}</button>`).join('') : '<p>当前筛选没有目录。</p>'}
      </aside>
    </main>
  `);

  document.querySelector('[data-back-home]')?.addEventListener('click', goHome);
  document.querySelectorAll('[data-go-course]').forEach((button) => {
    button.addEventListener('click', () => goCourse(button.dataset.goCourse));
  });
  document.querySelectorAll('[data-scroll-target]').forEach((button) => {
    button.addEventListener('click', () => {
      document.getElementById(button.dataset.scrollTarget)?.scrollIntoView({ block: 'start' });
    });
  });
  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => renderCourse(course.id, button.dataset.mode));
  });
  document.querySelector('[data-mark-read]')?.addEventListener('click', (event) => {
    const nextDone = !getProgress()[course.id];
    setProgress(course.id, nextDone);
    event.currentTarget.classList.toggle('is-complete', nextDone);
    event.currentTarget.textContent = nextDone ? '已标记完成' : '标记完成';
    showToast(nextDone ? '已记录阅读进度' : '已取消完成标记');
  });
  bindCopyButtons();
  observeToc();
  if (shouldScrollCourseTop) {
    shouldScrollCourseTop = false;
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  }
}

function bindCopyButtons() {
  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const value = button.getAttribute('data-copy') || '';
      try {
        await navigator.clipboard.writeText(value);
        showToast('已复制到剪贴板');
      } catch {
        showToast('复制失败，请手动选择文本');
      }
    });
  });
}

function observeToc() {
  const links = [...document.querySelectorAll('.toc [data-scroll-target]')];
  const headings = links
    .map((link) => document.getElementById(link.dataset.scrollTarget))
    .filter(Boolean);
  if (!headings.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      links.forEach((link) => link.classList.toggle('is-active', link.dataset.scrollTarget === entry.target.id));
    });
  }, { rootMargin: '-15% 0px -75% 0px' });

  headings.forEach((heading) => observer.observe(heading));
}

function renderRoute() {
  const route = getCurrentRoute();
  if (route.page === 'course') {
    renderCourse(route.id);
  } else {
    renderHome();
  }
}

window.addEventListener('hashchange', renderRoute);
renderRoute();

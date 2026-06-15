const HEADING_RE = /^(#{1,4})\s+(.+)$/;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

export function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugify(value, fallbackPrefix = 'section') {
  const ascii = String(value ?? '')
    .toLowerCase()
    .replace(/第\s*(\d+)\s*课/g, '$1 ')
    .replace(/[：:，,。！？、]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
  return ascii || fallbackPrefix;
}

export function extractCodeBlocks(markdown) {
  const blocks = [];
  const lines = String(markdown ?? '').split(/\r?\n/);
  let current = null;

  for (const line of lines) {
    const fence = line.match(/^(`{3,})([A-Za-z0-9_-]*)\s*$/);
    if (fence && current === null) {
      current = { fenceLength: fence[1].length, language: fence[2] || 'text', lines: [] };
      continue;
    }
    if (fence && current !== null && fence[1].length >= current.fenceLength) {
      blocks.push({ language: current.language, code: current.lines.join('\n') });
      current = null;
      continue;
    }
    if (current !== null) current.lines.push(line);
  }

  return blocks;
}

export function extractHeadings(markdown) {
  const headings = [];
  const usedIds = new Map();
  const lines = String(markdown ?? '').split(/\r?\n/);
  let fenceLength = 0;
  let fallbackIndex = 1;

  lines.forEach((line) => {
    const fence = line.match(/^(`{3,})/);
    if (fence && fenceLength === 0) {
      fenceLength = fence[1].length;
      return;
    }
    if (fence && fenceLength > 0 && fence[1].length >= fenceLength) {
      fenceLength = 0;
      return;
    }
    if (fenceLength > 0) return;

    const heading = line.match(HEADING_RE);
    if (!heading) return;

    const text = heading[2].trim();
    const asciiBase = slugify(text, '');
    const base = asciiBase || `section-${fallbackIndex++}`;
    const count = usedIds.get(base) ?? 0;
    usedIds.set(base, count + 1);
    headings.push({
      depth: heading[1].length,
      text,
      id: count === 0 ? base : `${base}-${count + 1}`,
    });
  });

  return headings;
}

export function searchCourses(courses, query, filters = {}) {
  const normalizedQuery = normalizeText(query);
  const primaryCategory = filters.primaryCategory || filters.category || 'all';
  const secondaryCategory = filters.secondaryCategory || 'all';
  const publisher = filters.publisher || 'all';

  return courses.filter((course) => {
    const coursePrimaryCategory = course.primaryCategory || course.category;
    const courseSecondaryCategory = course.secondaryCategory || '';
    if (primaryCategory !== 'all' && coursePrimaryCategory !== primaryCategory) return false;
    if (secondaryCategory !== 'all' && courseSecondaryCategory !== secondaryCategory) return false;
    if (publisher !== 'all' && course.publisher !== publisher) return false;
    if (!normalizedQuery) return true;

    const haystack = normalizeText([
      course.title,
      course.summary,
      course.publisher,
      coursePrimaryCategory,
      courseSecondaryCategory,
      ...(course.tags || []),
      ...(course.keywords || []),
    ].join(' '));
    return haystack.includes(normalizedQuery);
  });
}

export function getUniqueValues(items, key) {
  return [...new Set(items.map((item) => item[key]).filter(Boolean))];
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

export function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

export function isTableStart(lines, index) {
  return Boolean(lines[index]?.includes('|') && TABLE_SEPARATOR_RE.test(lines[index + 1] || ''));
}

export function getNextLesson(courses, currentId, direction) {
  const enabled = courses.filter((course) => !course.disabled);
  const index = enabled.findIndex((course) => course.id === currentId);
  if (index < 0) return null;
  return enabled[index + direction] || null;
}

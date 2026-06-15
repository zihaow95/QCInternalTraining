import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(siteRoot, '..');
const outputRoot = join(workspaceRoot, 'output', 'playwright');

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}

function findBrowser() {
  const candidates = [
    join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];

  const browser = candidates.find((candidate) => candidate && existsSync(candidate));
  assert.ok(browser, 'Chrome or Edge is required for browser smoke tests.');
  return browser;
}

async function waitForHttp(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep polling until the local preview server is ready.
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  let nextId = 1;
  const pending = new Map();

  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', rejectOpen, { once: true });
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolveMessage, rejectMessage } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      rejectMessage(new Error(message.error.message));
    } else {
      resolveMessage(message.result);
    }
  });

  return {
    send(method, params = {}) {
      const id = nextId;
      nextId += 1;
      const payload = JSON.stringify({ id, method, params });
      return new Promise((resolveMessage, rejectMessage) => {
        pending.set(id, { resolveMessage, rejectMessage });
        socket.send(payload);
      });
    },
    close() {
      socket.close();
    },
  };
}

async function openPage(chromePort, url) {
  let response = await fetch(`http://127.0.0.1:${chromePort}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  });
  if (!response.ok) {
    response = await fetch(`http://127.0.0.1:${chromePort}/json/new?${encodeURIComponent(url)}`);
  }
  assert.ok(response.ok, `Unable to open Chrome target for ${url}`);
  const target = await response.json();
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  return cdp;
}

async function waitForExpression(cdp, expression, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.result?.value) return;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for expression: ${expression}`);
}

async function getPageChecks(cdp) {
  const result = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const text = document.body.innerText;
      const rawText = document.body.textContent;
      return {
        title: document.title,
        text,
        rawText,
        tocText: document.querySelector('.toc')?.textContent || '',
        tocButtons: document.querySelectorAll('.toc [data-scroll-target]').length,
        introMetaText: document.querySelector('.lesson-intro-meta')?.innerText || '',
        introMetaItems: document.querySelectorAll('.lesson-intro-meta .meta-item').length,
        adjacentAnswerDetails: document.querySelectorAll('.lesson-content details.answer + details.answer').length,
        copyButtons: document.querySelectorAll('[data-copy]').length,
        details: document.querySelectorAll('details.answer').length,
        courseCards: document.querySelectorAll('.course-card').length,
        disabledCards: document.querySelectorAll('.course-card.is-disabled').length
      };
    })()`,
    returnByValue: true,
  });
  return result.result.value;
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return result.result?.value;
}

async function saveScreenshot(cdp, fileName) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  });
  await mkdir(outputRoot, { recursive: true });
  await writeFile(join(outputRoot, fileName), Buffer.from(result.data, 'base64'));
}

test('static learning site renders homepage and lesson interactions in a browser', async () => {
  const serverPort = await getFreePort();
  const chromePort = await getFreePort();
  const browser = findBrowser();
  const server = spawn(process.execPath, ['dev-server.mjs'], {
    cwd: siteRoot,
    env: { ...process.env, PORT: String(serverPort) },
    stdio: 'ignore',
  });
  const chrome = spawn(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${chromePort}`,
    `--user-data-dir=${join(outputRoot, `browser-smoke-${Date.now()}`)}`,
    'about:blank',
  ], {
    stdio: 'ignore',
  });

  try {
    await waitForHttp(`http://127.0.0.1:${serverPort}/`);
    await waitForHttp(`http://127.0.0.1:${chromePort}/json/version`);

    const home = await openPage(chromePort, `http://127.0.0.1:${serverPort}/`);
    await waitForExpression(home, `document.body.innerText.includes('AI 到底能帮我做什么')`);
    const homeChecks = await getPageChecks(home);
    assert.match(homeChecks.text, /青丛成长实验室资料架/);
    assert.match(homeChecks.text, /发行中心/);
    assert.match(homeChecks.text, /一级类目/);
    assert.match(homeChecks.text, /二级类目/);
    assert.match(homeChecks.text, /AI技能/);
    assert.match(homeChecks.text, /信息化中心/);
    assert.match(homeChecks.text, /新任管理者基础课/);
    assert.ok(homeChecks.courseCards >= 8);
    assert.ok(homeChecks.disabledCards >= 1);
    await saveScreenshot(home, 'home.png');
    home.close();

    const lesson = await openPage(chromePort, `http://127.0.0.1:${serverPort}/index.html#/course/ai-basics-01`);
    await waitForExpression(lesson, `document.body.innerText.includes('第一次使用 AI 的通用 Prompt')`);
    const lessonChecks = await getPageChecks(lesson);
    assert.match(lessonChecks.text, /课程列表/);
    assert.match(lessonChecks.text, /信息化中心 · 技能类 \/ AI技能/);
    assert.match(lessonChecks.tocText, /本课目录/);
    assert.equal(lessonChecks.tocButtons > 0, true);
    assert.equal(lessonChecks.introMetaItems, 3);
    assert.match(lessonChecks.introMetaText, /版本日期/);
    assert.match(lessonChecks.introMetaText, /预计阅读时间/);
    assert.match(lessonChecks.introMetaText, /课程目标/);
    assert.doesNotMatch(lessonChecks.introMetaText, /阅读对象/);
    assert.match(lessonChecks.text, /查看答案\/解析/);
    assert.equal(lessonChecks.adjacentAnswerDetails, 0);
    assert.ok(lessonChecks.copyButtons >= 1);
    assert.ok(lessonChecks.details >= 1);

    const hashBeforeToc = await evaluate(lesson, 'location.hash');
    await evaluate(lesson, `document.querySelector('.toc [data-scroll-target]').click()`);
    await waitForExpression(lesson, `window.scrollY > 100`);
    assert.equal(await evaluate(lesson, 'location.hash'), hashBeforeToc);

    await evaluate(lesson, `window.scrollTo(0, document.body.scrollHeight)`);
    await waitForExpression(lesson, `window.scrollY > 1000`);
    await evaluate(lesson, `document.querySelector('.lesson-pager [data-go-course]').click()`);
    await waitForExpression(lesson, `document.body.innerText.includes('Prompt 是工作委托，不是搜索框') && window.scrollY < 120`);

    await evaluate(lesson, `window.scrollTo(0, document.body.scrollHeight)`);
    await waitForExpression(lesson, `window.scrollY > 1000`);
    await evaluate(lesson, `[...document.querySelectorAll('.lesson-list [data-go-course]')].find((button) => button.dataset.goCourse === 'ai-basics-01').click()`);
    await waitForExpression(lesson, `document.body.innerText.includes('AI 到底能帮我做什么') && window.scrollY < 120`);

    await evaluate(lesson, `document.querySelector('[data-mark-read]').click()`);
    await waitForExpression(lesson, `document.querySelector('[data-mark-read]').classList.contains('is-complete')`);
    assert.match(await evaluate(lesson, `document.querySelector('[data-mark-read]').innerText`), /已标记完成/);
    await evaluate(lesson, `document.querySelector('[data-mark-read]').click()`);
    await waitForExpression(lesson, `!document.querySelector('[data-mark-read]').classList.contains('is-complete')`);
    assert.match(await evaluate(lesson, `document.querySelector('[data-mark-read]').innerText`), /标记完成/);
    await waitForExpression(lesson, `!document.querySelector('#toast').classList.contains('is-visible')`);

    await saveScreenshot(lesson, 'lesson-01.png');
    lesson.close();
  } finally {
    chrome.kill();
    server.kill();
  }
});

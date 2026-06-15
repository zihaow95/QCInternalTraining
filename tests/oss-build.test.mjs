import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOssBundle } from '../../scripts/build-oss.mjs';

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

test('buildOssBundle creates a root-ready static website package for Aliyun OSS', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'qingcong-oss-'));

  try {
    await buildOssBundle({ outputDir });

    assert.equal(await exists(join(outputDir, 'index.html')), true);
    assert.equal(await exists(join(outputDir, '404.html')), true);
    assert.equal(await exists(join(outputDir, 'assets', 'app.js')), true);
    assert.equal(await exists(join(outputDir, 'assets', 'learning-utils.js')), true);
    assert.equal(await exists(join(outputDir, 'assets', 'styles.css')), true);
    assert.equal(await exists(join(outputDir, 'assets', 'logo.png')), true);
    assert.equal(await exists(join(outputDir, 'data', 'courses.js')), true);
    assert.equal(await exists(join(outputDir, 'content', 'lessons', 'lesson-01.md')), true);

    assert.equal(await exists(join(outputDir, 'assets', 'app.mjs')), false);
    assert.equal(await exists(join(outputDir, 'data', 'courses.mjs')), false);
    assert.equal(await exists(join(outputDir, 'tests')), false);
    assert.equal(await exists(join(outputDir, 'dev-server.mjs')), false);

    const indexHtml = await readFile(join(outputDir, 'index.html'), 'utf8');
    const appJs = await readFile(join(outputDir, 'assets', 'app.js'), 'utf8');
    assert.match(indexHtml, /type="module" src="\.\/assets\/app\.js"/);
    assert.doesNotMatch(indexHtml, /\.mjs/);
    assert.match(appJs, /'\.\.\/data\/courses\.js'/);
    assert.match(appJs, /'\.\/learning-utils\.js'/);
    assert.doesNotMatch(appJs, /\.mjs/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

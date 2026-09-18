import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

test('keeps a wide widget inside the right desktop edge', async () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'webos-widget-bounds-'));
  try {
    execFileSync(process.execPath, [
      join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc'),
      'src/utils/desktopWidgetBounds.ts', '--target', 'ES2022',
      '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--outDir', outputDir,
    ], { cwd: process.cwd(), stdio: 'pipe' });
    const { clampWidgetPosition } = await import(pathToFileURL(join(outputDir, 'desktopWidgetBounds.js')).href);
    const position = clampWidgetPosition(
      { x: 820, y: 300 },
      { width: 360, height: 230 },
      { width: 1024, height: 768 },
      { left: 32, top: 28, right: 32, bottom: 96 },
    );

    assert.equal(position.x, 632);
    assert.equal(position.y, 300);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

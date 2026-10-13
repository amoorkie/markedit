import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { workspacePathKey, ancestorPaths } from '../src/workspace-path.mjs';
const { fileKey, workspaceRootForDirectory } = createRequire(import.meta.url)('../platform.cjs');

// Проверяем обе платформы даже при запуске тестов на одной из них.
test('Windows path comparisons ignore case; Mac comparisons preserve case', () => {
  assert.equal(fileKey('C:/Work/Note.md', 'win32'), fileKey('c:\\work\\note.md', 'win32'));
  assert.notEqual(fileKey('/Users/me/Case.md', 'darwin'), fileKey('/Users/me/case.md', 'darwin'));
  assert.equal(workspaceRootForDirectory('C:\\Work\\Notes', 'win32'), 'C:\\');
  assert.equal(workspaceRootForDirectory('/Users/me/Notes', 'darwin'), '/Users/me/Notes');
});

// Дерево раскрывает родителей, но не соседнюю папку с похожим префиксом.
test('sidebar reveals ancestors on Windows and Mac without crossing the root', () => {
  assert.equal(workspacePathKey('C:/Work/'), 'c:\\work');
  assert.equal(workspacePathKey('/Users/me/Case/'), '/Users/me/Case');
  assert.deepEqual(ancestorPaths('C:\\', 'c:\\Work\\Notes\\one.md'), ['c:\\work\\notes', 'c:\\work']);
  assert.deepEqual(ancestorPaths('/Users/me', '/Users/me/Case/Notes/one.md'), ['/Users/me/Case/Notes', '/Users/me/Case']);
  assert.deepEqual(ancestorPaths('/', '/Users/me/one.md'), ['/Users/me', '/Users']);
  assert.deepEqual(ancestorPaths('/Users/me', '/Users/member/one.md'), []);
  assert.deepEqual(ancestorPaths('/Users/me/Case', '/Users/me/case/one.md'), []);
});

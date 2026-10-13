// Проверки жизненного цикла документов с настоящими файлами и управляемыми ответами диалогов.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const { DocumentWorkspace } = createRequire(import.meta.url)('../document-workspace.cjs');

// Подменяется только отображение; чтение, запись и восстановление сессии остаются настоящими.
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markedit-tabs-unit-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const first = path.join(directory, 'first.md');
  const second = path.join(directory, 'second.md');
  await fs.writeFile(first, 'Первый документ');
  await fs.writeFile(second, 'Второй документ');
  let current = null;
  let answer = 2;
  let savePath;
  const window = { webContents: {
    send: () => {},
    executeJavaScript: async code => vm.runInNewContext(code, { window: { markEditWindows: {
      captureDocumentState: () => current,
      loadDocument: value => { current = value && { ...value }; },
      forgetDocument: () => {},
      refreshWorkspace: () => {},
      finishDocumentOperation: () => {},
    } } }),
  } };
  const workspace = new DocumentWorkspace({ getWindow: () => window, sessionPath: path.join(directory, 'open-tabs.json'), onActive: () => {}, onFile: async () => {}, supportsPath: file => typeof file === 'string' && path.isAbsolute(file) && file.endsWith('.md'), dialog: {
    showMessageBox: async () => ({ response: answer }),
    showSaveDialog: async () => ({ canceled: !savePath, filePath: savePath }),
  } });
  return { workspace, first, second, directory, edit: text => { current.text = text; current.mode = 'edit'; }, answer: value => { answer = value; }, savePath: value => { savePath = value; }, current: () => current };
}

test('unsaved tabs survive switching, duplicates activate once, saves target the selected file', async t => {
  const f = await fixture(t);
  const w = f.workspace;
  await w.run(() => w.open(f.first));
  const firstId = w.activeId;
  f.edit('Черновик первого');
  await w.run(() => w.open(f.second));
  const secondId = w.activeId;
  f.edit('Черновик второго');
  await w.run(() => w.open(f.first));
  assert.equal(w.tabs.length, 2);
  assert.equal(f.current().text, 'Черновик первого');
  assert.equal(w.activeId, firstId);
  await w.run(() => w.save());
  assert.equal(await fs.readFile(f.first, 'utf8'), 'Черновик первого');
  assert.equal(await fs.readFile(f.second, 'utf8'), 'Второй документ');
  await w.run(() => w.activate(secondId));
  assert.equal(f.current().text, 'Черновик второго');
});

test('cancel close retains inactive draft; save/discard apply only to the requested tab', async t => {
  const f = await fixture(t); const w = f.workspace;
  await w.run(() => w.open(f.first)); const id = w.activeId;
  f.edit('Несохранённый текст');
  await w.run(() => w.open(f.second));
  assert.equal(await w.run(() => w.close(id)), false);
  assert.equal(w.tabs.length, 2);
  f.answer(0);
  assert.equal(await w.run(() => w.close(id)), true);
  assert.equal(await fs.readFile(f.first, 'utf8'), 'Несохранённый текст');
  assert.equal(w.tabs.length, 1);
  f.edit('Не записывать'); f.answer(1);
  await w.run(() => w.close(w.activeId));
  assert.equal(await fs.readFile(f.second, 'utf8'), 'Второй документ');
  assert.equal(w.activeId, null);
});

test('save as rejects an already open target and leaves both documents intact', async t => {
  const f = await fixture(t); const w = f.workspace;
  await w.run(() => w.open(f.first)); await w.run(() => w.open(f.second));
  f.savePath(f.first);
  await assert.rejects(w.run(() => w.save(w.activeId, true)), /уже открыт/);
  assert.equal(await fs.readFile(f.first, 'utf8'), 'Первый документ');
  assert.equal(w.tabs.length, 2);
  await w.run(() => w.activate(w.tabs[0].id));
  assert.equal(f.current().text, 'Первый документ');
});

test('group color, names, compact width and pinning survive restart; missing files are skipped', async t => {
  const f = await fixture(t); const w = f.workspace;
  await w.run(() => w.open(f.first)); const firstId = w.activeId;
  await w.run(() => w.open(f.second)); const secondId = w.activeId;
  const group = await w.run(() => w.createGroup({ name: 'Работа', color: '#7656a8', tabId: firstId }));
  await w.run(() => w.updateTab(firstId, { width: 40 }));
  await w.run(() => w.updateTab(secondId, { pinned: true }));
  await w.run(() => w.updateGroup(group, { collapsed: true }));
  const saved = w.snapshot();
  w.tabs = []; w.groups = []; w.activeId = null;
  await w.run(() => w.restore());
  assert.deepEqual(w.snapshot(), saved);
  await fs.unlink(f.second);
  w.tabs = []; w.groups = []; w.activeId = null;
  await w.run(() => w.restore());
  assert.equal(w.tabs.length, 1);
  assert.equal(w.tabs[0].groupId, group);
});

test('queue orders rapid opens and has no tab-count ceiling; late dirty events target their own tab', async t => {
  const f = await fixture(t); const w = f.workspace;
  await Promise.all([w.run(() => w.open(f.first)), w.run(() => w.open(f.second)), w.run(() => w.open(f.first))]);
  assert.equal(w.tabs.length, 2);
  assert.equal(w.active.path, f.first);
  const other = w.tabs.find(tab => tab.id !== w.activeId);
  w.markDirty(other.id);
  assert.equal(other.dirty, true);
  assert.equal(w.active.dirty, false);
  for (let index = 0; index < 120; index++) await w.run(() => w.newDocument());
  assert.equal(w.tabs.length, 122);
  assert.equal(new Set(w.tabs.map(tab => tab.id)).size, 122);
});

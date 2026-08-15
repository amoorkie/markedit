const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, clipboard, ipcMain } = require('electron');

const projectDirectory = path.resolve(__dirname, '..');
let openedWorkspaceFile;
let revealActiveRequests = 0;
const moveRequests = [];

ipcMain.handle('clipboard:write', (_event, text) => clipboard.writeText(text));
ipcMain.handle('document:save', () => true);
ipcMain.handle('workspace:snapshot', () => ({
  root: 'C:\\',
  rootName: 'C:',
  drives: [
    { name: 'Рабочий стол', path: 'C:\\Users\\Test\\Desktop', kind: 'desktop' },
    { name: 'A:', path: 'A:\\' },
    { name: 'C:', path: 'C:\\' },
    { name: 'D:', path: 'D:\\' },
  ],
  currentFile: 'C:\\Archive\\old.md',
  recentFiles: [{ type: 'file', name: 'recent.md', path: 'C:\\Elsewhere\\recent.md' }],
  entries: [
    { type: 'directory', name: 'Archive', path: 'C:\\Archive' },
    { type: 'file', name: 'reader-demo.md', path: 'C:\\reader-demo.md' },
  ],
}));
ipcMain.handle('workspace:children', (_event, directory) => ({
  entries: directory === 'C:\\Archive'
    ? [{ type: 'file', name: 'old.md', path: 'C:\\Archive\\old.md' }]
    : [],
}));
ipcMain.handle('workspace:select-root', () => false);
ipcMain.handle('workspace:select-drive', () => false);
ipcMain.handle('workspace:reveal-active', () => {
  revealActiveRequests += 1;
  return true;
});
ipcMain.handle('workspace:create-folder', () => false);
ipcMain.handle('workspace:delete-entry', () => false);
ipcMain.handle('workspace:move-entry', (_event, source, destination) => {
  moveRequests.push({ source, destination });
  return false;
});
ipcMain.handle('workspace:choose-move-destination', () => false);
ipcMain.handle('workspace:remove-recent', () => false);
ipcMain.handle('workspace:create-file', () => false);
ipcMain.handle('workspace:open', (_event, filePath) => {
  openedWorkspaceFile = filePath;
  return true;
});

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1024,
    height: 760,
    show: false,
    webPreferences: {
      preload: path.join(projectDirectory, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    await window.loadFile(path.join(projectDirectory, 'editor.html'));
    const sample = await fs.readFile(
      path.join(projectDirectory, 'tests', 'fixtures', 'reader-demo.md'),
      'utf8',
    );
    await window.webContents.executeJavaScript(
      `window.webModules.core.resetEditor({text:${JSON.stringify(sample)},documentChanged:true})`,
    );
    await window.webContents.executeJavaScript('window.markEditWindows.refreshReader()');

    const readingState = await window.webContents.executeJavaScript(`({
      mode: document.documentElement.classList.contains('reading-mode'),
      readerHidden: document.getElementById('reader').hidden,
      editorHidden: document.getElementById('editor').hidden,
      copyButtons: document.querySelectorAll('.section-copy').length,
      inlineCopyButtons: document.querySelectorAll('h1 > .section-copy, h2 > .section-copy, h3 > .section-copy, h4 > .section-copy, h5 > .section-copy, h6 > .section-copy').length,
      readOnly: window.config.readOnlyMode,
    })`);
    assert.deepEqual(readingState, {
      mode: true,
      readerHidden: false,
      editorHidden: true,
      copyButtons: 4,
      inlineCopyButtons: 4,
      readOnly: true,
    });
    await window.webContents.executeJavaScript("document.getElementById('appearance-button').click()");
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(
      await window.webContents.executeJavaScript("document.getElementById('appearance-panel').hidden"),
      false,
    );
    await window.webContents.executeJavaScript("document.getElementById('font-toggle').click(); document.querySelector('[data-font=\"serif\"]').click()");
    const fontPickerState = await window.webContents.executeJavaScript(`(async () => {
      await document.fonts.load('18px "Zen Antique"', 'Статус Stage');
      return ({
      nativeSelect: Boolean(document.getElementById('font-control')),
      options: document.querySelectorAll('.font-option').length,
      label: document.getElementById('font-label').textContent,
      zenLoaded: document.fonts.check('18px "Zen Antique"', 'Статус Stage'),
      });
    })()`);
    assert.deepEqual(fontPickerState, {
      nativeSelect: false,
      options: 3,
      label: 'С засечками',
      zenLoaded: true,
    });
    await window.webContents.executeJavaScript("document.getElementById('font-toggle').click(); document.querySelector('[data-font=\"mono\"]').click()");
    const monoState = await window.webContents.executeJavaScript(`(async () => {
      await document.fonts.load('18px "JetBrains Mono"', 'const value = 1');
      return ({
      expanded: document.getElementById('font-toggle').getAttribute('aria-expanded'),
      label: document.getElementById('font-label').textContent,
      selected: document.querySelector('[data-font="mono"]').getAttribute('aria-selected'),
      family: getComputedStyle(document.getElementById('reader-content')).fontFamily,
      loaded: document.fonts.check('18px "JetBrains Mono"', 'const value = 1'),
      });
    })()`);
    assert.deepEqual(monoState, {
      expanded: 'false',
      label: 'Моноширинный',
      selected: 'true',
      family: '"JetBrains Mono", Consolas, monospace',
      loaded: true,
    });
    await window.webContents.executeJavaScript("document.getElementById('appearance-close').click()");

    clipboard.clear();
    await window.webContents.executeJavaScript("document.querySelectorAll('.section-copy')[1].click()");
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.match(clipboard.readText(), /^## Reading mode/);
    assert.match(clipboard.readText(), /### Semantic sections/);

    await window.webContents.executeJavaScript("document.getElementById('edit-button').click()");
    await new Promise(resolve => setTimeout(resolve, 50));
    const editingState = await window.webContents.executeJavaScript(`({
      mode: document.documentElement.classList.contains('editing-mode'),
      readerHidden: document.getElementById('reader').hidden,
      editorHidden: document.getElementById('editor').hidden,
      readOnly: window.config.readOnlyMode,
    })`);
    assert.deepEqual(editingState, {
      mode: true,
      readerHidden: true,
      editorHidden: false,
      readOnly: false,
    });

    assert.equal(
      await window.webContents.executeJavaScript("document.querySelector('#edit-button svg')?.classList.contains('lucide-check')"),
      true,
    );
    await window.webContents.executeJavaScript("document.getElementById('edit-button').click()");
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(
      await window.webContents.executeJavaScript("document.documentElement.classList.contains('reading-mode')"),
      true,
    );

    await window.webContents.executeJavaScript("document.getElementById('workspace-button').click()");
    await new Promise(resolve => setTimeout(resolve, 50));
    const workspaceState = await window.webContents.executeJavaScript(`({
      open: document.documentElement.classList.contains('sidebar-open'),
      sidebarHidden: document.getElementById('workspace-sidebar').hidden,
      sidebarDisplay: getComputedStyle(document.getElementById('workspace-sidebar')).display,
      toggleDisplay: getComputedStyle(document.getElementById('workspace-button')).display,
      title: document.getElementById('workspace-title').textContent,
      files: document.querySelectorAll('#workspace-tree .workspace-row').length,
      driveOptions: document.querySelectorAll('.workspace-drive-option').length,
      selectedDrive: document.getElementById('workspace-drive-label').textContent,
      desktopOption: document.querySelector('.workspace-drive-option')?.textContent.trim(),
      recentBeforeDrive: Boolean(document.querySelector('.workspace-recent + .workspace-drive-control')),
      newFolder: Boolean(document.getElementById('workspace-new-folder')),
      deleteButtons: document.querySelectorAll('.workspace-delete').length,
      draggableRows: document.querySelectorAll('.workspace-row[draggable="true"]').length,
      recentAccordion: Boolean(document.getElementById('workspace-recent-toggle')),
      recentFiles: document.querySelectorAll('.workspace-recent-row').length,
      selectChevron: document.querySelector('#font-toggle svg')?.classList.contains('lucide-chevron-down'),
      activePath: document.getElementById('workspace-active-path').textContent,
      activeVisible: !document.getElementById('workspace-active-file').hidden,
      revealIcon: document.querySelector('#workspace-reveal-active svg')?.classList.contains('lucide-locate-fixed'),
      activeExpanded: [...document.querySelectorAll('#workspace-tree .workspace-row')]
        .find(row => row.title === 'C:\\\\Archive')?.getAttribute('aria-expanded'),
    })`);
    assert.deepEqual(workspaceState, {
      open: true,
      sidebarHidden: false,
      sidebarDisplay: 'flex',
      toggleDisplay: 'none',
      title: 'C:',
      files: 3,
      driveOptions: 4,
      selectedDrive: 'C:',
      desktopOption: 'Рабочий стол',
      recentBeforeDrive: true,
      newFolder: true,
      deleteButtons: 3,
      draggableRows: 4,
      recentAccordion: true,
      recentFiles: 1,
      selectChevron: true,
      activePath: 'C:\\Archive\\old.md',
      activeVisible: true,
      revealIcon: true,
      activeExpanded: 'true',
    });

    await window.webContents.executeJavaScript("document.getElementById('workspace-reveal-active').click()");
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(revealActiveRequests, 1);

    await window.webContents.executeJavaScript("document.getElementById('workspace-recent-toggle').click()");
    const recentOpenState = await window.webContents.executeJavaScript(`({
      expanded: document.getElementById('workspace-recent-toggle').getAttribute('aria-expanded'),
      hidden: document.getElementById('workspace-recent-list').hidden,
    })`);
    assert.deepEqual(recentOpenState, { expanded: 'true', hidden: false });
    await window.webContents.executeJavaScript("document.querySelector('.workspace-recent-row').click()");
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(openedWorkspaceFile, 'C:\\Elsewhere\\recent.md');
    assert.equal(
      await window.webContents.executeJavaScript("document.querySelector('.workspace-recent-row').classList.contains('selected')"),
      true,
    );
    await window.webContents.executeJavaScript(`document.querySelector('.workspace-recent-row')
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 160 }))`);
    const recentMenuActions = await window.webContents.executeJavaScript(
      "[...document.querySelectorAll('.workspace-context-action')].map(button => button.textContent.trim())",
    );
    assert.deepEqual(recentMenuActions, ['Открыть', 'Копировать путь', 'Переместить…', 'Убрать из недавних']);
    clipboard.clear();
    await window.webContents.executeJavaScript("document.querySelectorAll('.workspace-context-action')[1].click()");
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(clipboard.readText(), 'C:\\Elsewhere\\recent.md');
    assert.match(
      await window.webContents.executeJavaScript("getComputedStyle(document.getElementById('workspace-context-menu')).fontFamily"),
      /Segoe UI/,
    );
    await window.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");

    await window.webContents.executeJavaScript(`document.querySelector('#workspace-tree .workspace-row:not([aria-expanded])')
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 200 }))`);
    const contextMenuState = await window.webContents.executeJavaScript(`({
      open: !document.getElementById('workspace-context-menu').hidden,
      actions: [...document.querySelectorAll('.workspace-context-action')].map(button => button.textContent.trim()),
      danger: document.querySelectorAll('.workspace-context-action.danger').length,
    })`);
    assert.deepEqual(contextMenuState, {
      open: true,
      actions: ['Открыть', 'Копировать путь', 'Переместить…', 'Удалить'],
      danger: 1,
    });
    await window.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    assert.equal(
      await window.webContents.executeJavaScript("document.getElementById('workspace-context-menu').hidden"),
      true,
    );

    assert.equal(
      await window.webContents.executeJavaScript("document.querySelector('#workspace-tree .workspace-row[aria-expanded]').getAttribute('aria-expanded')"),
      'true',
    );
    await window.webContents.executeJavaScript('window.markEditWindows.refreshWorkspace()');
    await new Promise(resolve => setTimeout(resolve, 50));
    const preservedTreeState = await window.webContents.executeJavaScript(`({
      expanded: document.querySelector('#workspace-tree .workspace-row[aria-expanded]').getAttribute('aria-expanded'),
      rows: document.querySelectorAll('#workspace-tree .workspace-row').length,
      selected: document.querySelectorAll('#workspace-tree .workspace-row.selected').length,
    })`);
    assert.deepEqual(preservedTreeState, { expanded: 'true', rows: 3, selected: 1 });

    await window.webContents.executeJavaScript(`(() => {
      const row = [...document.querySelectorAll('#workspace-tree .workspace-row')]
        .find(element => element.title === 'C:\\\\Archive\\\\old.md');
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', 'C:\\\\Archive\\\\old.md');
      row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
      document.querySelector('.workspace-drive-control')
        .dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
      document.querySelector('.workspace-drive-control')
        .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    })()`);
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.deepEqual(moveRequests.at(-1), { source: 'C:\\Archive\\old.md', destination: 'C:\\' });

    await window.webContents.executeJavaScript(`(() => {
      const fileRow = [...document.querySelectorAll('#workspace-tree .workspace-row')]
        .find(element => element.title === 'C:\\\\reader-demo.md');
      const folderRow = [...document.querySelectorAll('#workspace-tree .workspace-row')]
        .find(element => element.title === 'C:\\\\Archive');
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', 'C:\\\\reader-demo.md');
      fileRow.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
      folderRow.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
      folderRow.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    })()`);
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.deepEqual(moveRequests.at(-1), { source: 'C:\\reader-demo.md', destination: 'C:\\Archive' });

    await window.webContents.executeJavaScript(`(() => {
      const recentRow = document.querySelector('.workspace-recent-row');
      const folderRow = [...document.querySelectorAll('#workspace-tree .workspace-row')]
        .find(element => element.title === 'C:\\\\Archive');
      const dataTransfer = new DataTransfer();
      recentRow.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
      folderRow.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
      folderRow.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    })()`);
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.deepEqual(moveRequests.at(-1), { source: 'C:\\Elsewhere\\recent.md', destination: 'C:\\Archive' });

    console.log('Electron reader smoke test passed');
    window.destroy();
    app.quit();
  } catch (error) {
    console.error(error.stack ?? error);
    window.destroy();
    app.exit(1);
  }
});

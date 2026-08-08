const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, clipboard, ipcMain } = require('electron');

const projectDirectory = path.resolve(__dirname, '..');

ipcMain.handle('clipboard:write', (_event, text) => clipboard.writeText(text));
ipcMain.handle('document:save', () => true);
ipcMain.handle('workspace:snapshot', () => ({
  root: 'C:\\Notes',
  currentFile: 'C:\\Notes\\reader-demo.md',
  entries: [
    { type: 'file', name: 'reader-demo.md', path: 'C:\\Notes\\reader-demo.md' },
    {
      type: 'directory',
      name: 'Archive',
      path: 'C:\\Notes\\Archive',
      children: [{ type: 'file', name: 'old.md', path: 'C:\\Notes\\Archive\\old.md' }],
    },
  ],
}));
ipcMain.handle('workspace:open', () => true);

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
      readOnly: window.config.readOnlyMode,
    })`);
    assert.deepEqual(readingState, {
      mode: true,
      readerHidden: false,
      editorHidden: true,
      copyButtons: 4,
      readOnly: true,
    });
    await window.webContents.executeJavaScript("document.getElementById('appearance-button').click()");
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(
      await window.webContents.executeJavaScript("document.getElementById('appearance-panel').hidden"),
      false,
    );
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
      files: document.querySelectorAll('.workspace-row').length,
      selectChevron: document.querySelector('.select-control svg')?.classList.contains('lucide-chevron-down'),
    })`);
    assert.deepEqual(workspaceState, {
      open: true,
      sidebarHidden: false,
      sidebarDisplay: 'flex',
      toggleDisplay: 'none',
      title: 'Notes',
      files: 3,
      selectChevron: true,
    });

    console.log('Electron reader smoke test passed');
    window.destroy();
    app.quit();
  } catch (error) {
    console.error(error.stack ?? error);
    window.destroy();
    app.exit(1);
  }
});

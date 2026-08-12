const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

let mainWindow;
let currentFile;
let workspaceRoot;
let recentFiles = [];
let dirty = false;
let forceClose = false;

if (process.env.MARKEDIT_DEV_USER_DATA) {
  app.setPath('userData', process.env.MARKEDIT_DEV_USER_DATA);
}

const markdownFilters = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
  { name: 'Text', extensions: ['txt'] },
  { name: 'All files', extensions: ['*'] },
];
const supportedExtensions = new Set(['.md', '.markdown', '.mdown', '.mkd', '.txt']);

function fileFromArguments(argv) {
  return argv.find(argument => {
    if (argument.startsWith('-')) return false;
    return supportedExtensions.has(path.extname(argument).toLowerCase());
  });
}

function updateTitle() {
  if (!mainWindow) return;
  const name = currentFile ? path.basename(currentFile) : 'Untitled.md';
  mainWindow.setTitle(`${dirty ? '* ' : ''}${name} - MarkEdit`);
  mainWindow.setDocumentEdited(dirty);
}

async function editorText() {
  return mainWindow.webContents.executeJavaScript('window.webModules.core.getEditorText()');
}

async function resetEditor(text) {
  const serialized = JSON.stringify(text);
  await mainWindow.webContents.executeJavaScript(
    `window.webModules.core.resetEditor({text:${serialized},documentChanged:true})`,
  );
  await mainWindow.webContents.executeJavaScript('window.markEditWindows?.documentChanged()');
  dirty = false;
  updateTitle();
}

async function confirmDiscard() {
  if (!dirty) return true;
  const result = dialog.showMessageBoxSync(mainWindow, {
    type: 'warning',
    buttons: ['Save', 'Discard', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    title: 'MarkEdit',
    message: `Save changes to ${currentFile ? path.basename(currentFile) : 'Untitled.md'}?`,
    detail: 'Your changes will be lost if you do not save them.',
  });
  if (result === 2) return false;
  if (result === 0) return saveDocument();
  return true;
}

async function newDocument() {
  if (!await confirmDiscard()) return;
  currentFile = undefined;
  await resetEditor('');
}

function workspaceStatePath() {
  return path.join(app.getPath('userData'), 'workspace.json');
}

async function rememberWorkspaceRoot() {
  if (!workspaceRoot) return;
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(workspaceStatePath(), JSON.stringify({ root: workspaceRoot, recentFiles }), 'utf8');
}

async function setWorkspaceRoot(directory) {
  workspaceRoot = path.parse(path.resolve(directory)).root;
  await rememberWorkspaceRoot();
}

async function loadWorkspaceRoot() {
  try {
    const saved = JSON.parse(await fs.readFile(workspaceStatePath(), 'utf8'));
    recentFiles = Array.isArray(saved.recentFiles)
      ? saved.recentFiles.filter(file => typeof file === 'string' && isSupportedFilePath(file)).slice(0, 12)
      : [];
    if (typeof saved.root === 'string' && path.isAbsolute(saved.root)) {
      await fs.access(saved.root);
      return path.parse(path.resolve(saved.root)).root;
    }
  } catch {
    // Fall back to Documents when no saved folder is available.
  }
  return path.parse(app.getPath('documents')).root;
}

async function importSystemRecentFiles() {
  let shortcuts;
  try {
    shortcuts = await fs.readdir(app.getPath('recent'), { withFileTypes: true });
  } catch {
    return;
  }
  const candidates = await Promise.all(shortcuts
    .filter(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === '.lnk')
    .map(async entry => {
      const shortcutPath = path.join(app.getPath('recent'), entry.name);
      try {
        const [{ mtimeMs }, details] = await Promise.all([
          fs.stat(shortcutPath),
          Promise.resolve(shell.readShortcutLink(shortcutPath)),
        ]);
        const target = details.target && path.resolve(details.target);
        if (!target || !isSupportedFilePath(target)) return null;
        await fs.access(target);
        return { target, mtimeMs };
      } catch {
        return null;
      }
    }));
  const systemFiles = candidates.filter(Boolean).sort((left, right) => right.mtimeMs - left.mtimeMs).map(entry => entry.target);
  recentFiles = [...systemFiles, ...recentFiles].filter((file, index, files) => (
    files.findIndex(candidate => candidate.toLowerCase() === file.toLowerCase()) === index
  )).slice(0, 12);
  await rememberWorkspaceRoot();
}

async function recordRecentFile(filePath) {
  const resolved = path.resolve(filePath);
  recentFiles = [resolved, ...recentFiles.filter(file => file.toLowerCase() !== resolved.toLowerCase())].slice(0, 12);
  app.addRecentDocument(resolved);
  await rememberWorkspaceRoot();
}

async function availableRecentFiles() {
  const available = await Promise.all(recentFiles.map(async filePath => {
    try {
      await fs.access(filePath);
      return { type: 'file', name: path.basename(filePath), path: filePath };
    } catch {
      return null;
    }
  }));
  const filtered = available.filter(Boolean);
  if (filtered.length !== recentFiles.length) {
    recentFiles = filtered.map(entry => entry.path);
    await rememberWorkspaceRoot();
  }
  return filtered;
}

async function openDocument(filePath) {
  if (!filePath) {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: markdownFilters,
    });
    if (result.canceled) return;
    [filePath] = result.filePaths;
  }

  if (!await confirmDiscard()) return;
  try {
    const text = await fs.readFile(filePath, 'utf8');
    currentFile = path.resolve(filePath);
    await setWorkspaceRoot(path.dirname(currentFile));
    await resetEditor(text);
    await recordRecentFile(currentFile);
  } catch (error) {
    dialog.showErrorBox('Unable to open file', error.message);
  }
}

async function saveDocument(saveAs = false) {
  let target = currentFile;
  if (!target || saveAs) {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: target || 'Untitled.md',
      filters: markdownFilters,
    });
    if (result.canceled || !result.filePath) return false;
    target = result.filePath;
  }

  try {
    await fs.writeFile(target, await editorText(), 'utf8');
    currentFile = path.resolve(target);
    await setWorkspaceRoot(path.dirname(currentFile));
    dirty = false;
    await recordRecentFile(currentFile);
    updateTitle();
    await mainWindow.webContents.executeJavaScript('window.markEditWindows?.refreshWorkspace()');
    return true;
  } catch (error) {
    dialog.showErrorBox('Unable to save file', error.message);
    return false;
  }
}

async function workspaceSnapshot() {
  if (!workspaceRoot) workspaceRoot = await loadWorkspaceRoot();
  const contents = await readWorkspaceDirectory(workspaceRoot);
  return {
    root: workspaceRoot,
    drives: await availableDrives(),
    currentFile,
    recentFiles: await availableRecentFiles(),
    ...contents,
  };
}

async function selectWorkspaceDrive(drivePath) {
  const drives = await availableDrives();
  const drive = drives.find(entry => entry.path.toLowerCase() === String(drivePath).toLowerCase());
  if (!drive) throw new TypeError('Недопустимый диск');
  await setWorkspaceRoot(drive.path);
  return workspaceSnapshot();
}

async function selectWorkspaceRoot() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Выбрать папку',
    defaultPath: workspaceRoot || app.getPath('documents'),
    buttonLabel: 'Выбрать папку',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return false;
  await setWorkspaceRoot(result.filePaths[0]);
  return workspaceSnapshot();
}

function isInsideWorkspace(target) {
  if (!workspaceRoot || typeof target !== 'string' || !path.isAbsolute(target)) return false;
  const relative = path.relative(workspaceRoot, path.resolve(target));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isWorkspaceRootOrInside(target) {
  return typeof target === 'string'
    && path.isAbsolute(target)
    && (path.resolve(target).toLowerCase() === path.resolve(workspaceRoot).toLowerCase() || isInsideWorkspace(target));
}

async function createWorkspaceFolder(name) {
  const folderName = typeof name === 'string' ? name.trim() : '';
  if (!folderName || folderName === '.' || folderName === '..' || /[<>:"/\\|?*]/.test(folderName)) {
    dialog.showErrorBox('Не удалось создать папку', 'В имени папки есть недопустимые символы.');
    return false;
  }
  const target = path.join(workspaceRoot || app.getPath('documents'), folderName);
  if (!isInsideWorkspace(target)) throw new TypeError('Недопустимый путь папки');
  try {
    await fs.mkdir(target);
    return workspaceSnapshot();
  } catch (error) {
    dialog.showErrorBox('Не удалось создать папку', error.code === 'EEXIST' ? 'Папка с таким именем уже существует.' : error.message);
    return false;
  }
}

async function deleteWorkspaceEntry(target) {
  if (!isInsideWorkspace(target)) throw new TypeError('Недопустимый путь');
  const resolvedTarget = path.resolve(target);
  if (currentFile) {
    const relativeFile = path.relative(resolvedTarget, currentFile);
    if (relativeFile === '' || (!relativeFile.startsWith(`..${path.sep}`) && relativeFile !== '..' && !path.isAbsolute(relativeFile))) {
      dialog.showErrorBox('Нельзя удалить', 'Сначала откройте другой документ или создайте новый.');
      return false;
    }
  }
  const answer = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['В корзину', 'Отмена'],
    defaultId: 1,
    cancelId: 1,
    title: 'Удаление',
    message: `Переместить «${path.basename(resolvedTarget)}» в корзину?`,
    detail: 'Объект можно будет восстановить из корзины Windows.',
  });
  if (answer.response !== 0) return false;
  try {
    await shell.trashItem(resolvedTarget);
    recentFiles = recentFiles.filter(file => {
      const relative = path.relative(resolvedTarget, file);
      return relative !== '' && (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
    });
    await rememberWorkspaceRoot();
    return workspaceSnapshot();
  } catch (error) {
    dialog.showErrorBox('Не удалось удалить', error.message);
    return false;
  }
}

async function moveWorkspaceEntry(source, destinationDirectory) {
  if (!isInsideWorkspace(source) || !isWorkspaceRootOrInside(destinationDirectory)) {
    throw new TypeError('Недопустимый путь');
  }
  const resolvedSource = path.resolve(source);
  const resolvedDestination = path.resolve(destinationDirectory);
  const sourceKey = resolvedSource.toLowerCase();
  const destinationKey = resolvedDestination.toLowerCase();
  if (path.dirname(resolvedSource).toLowerCase() === destinationKey) return workspaceSnapshot();

  try {
    const [sourceStats, destinationStats] = await Promise.all([
      fs.stat(resolvedSource),
      fs.stat(resolvedDestination),
    ]);
    if (!destinationStats.isDirectory()) throw new Error('Цель переноса не является папкой.');
    if (sourceStats.isDirectory()) {
      const relativeDestination = path.relative(resolvedSource, resolvedDestination);
      if (relativeDestination === '' || (!relativeDestination.startsWith(`..${path.sep}`) && relativeDestination !== '..' && !path.isAbsolute(relativeDestination))) {
        throw new Error('Нельзя переместить папку внутрь самой себя.');
      }
    }

    const target = path.join(resolvedDestination, path.basename(resolvedSource));
    try {
      await fs.access(target);
      throw new Error('В целевой папке уже есть объект с таким именем.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    await fs.rename(resolvedSource, target);
    if (currentFile) {
      const currentKey = currentFile.toLowerCase();
      if (currentKey === sourceKey || currentKey.startsWith(`${sourceKey}${path.sep}`)) {
        currentFile = path.join(target, path.relative(resolvedSource, currentFile));
        updateTitle();
        await recordRecentFile(currentFile);
      }
    }
    recentFiles = recentFiles.map(file => {
      const key = file.toLowerCase();
      return key === sourceKey || key.startsWith(`${sourceKey}${path.sep}`)
        ? path.join(target, path.relative(resolvedSource, file))
        : file;
    });
    recentFiles = recentFiles.filter((file, index, files) => (
      files.findIndex(candidate => candidate.toLowerCase() === file.toLowerCase()) === index
    ));
    await rememberWorkspaceRoot();
    return workspaceSnapshot();
  } catch (error) {
    dialog.showErrorBox('Не удалось переместить', error.message);
    return false;
  }
}

async function chooseMoveDestination(source) {
  if (!isInsideWorkspace(source)) throw new TypeError('Недопустимый путь');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: `Куда переместить «${path.basename(source)}»?`,
    defaultPath: path.dirname(source),
    buttonLabel: 'Переместить',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return false;
  if (!isWorkspaceRootOrInside(result.filePaths[0])) {
    dialog.showErrorBox('Нельзя переместить', `Выберите папку на диске ${workspaceNameForPath(workspaceRoot)}.`);
    return false;
  }
  return moveWorkspaceEntry(source, result.filePaths[0]);
}

function workspaceNameForPath(target) {
  return path.parse(target).root.replace(/[\\/]+$/, '');
}

async function createWorkspaceFile() {
  if (!await confirmDiscard()) return false;

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Создать Markdown-файл',
    defaultPath: path.join(currentFile ? path.dirname(currentFile) : app.getPath('documents'), 'Новый документ.md'),
    buttonLabel: 'Создать',
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (result.canceled || !result.filePath) return false;

  let target = result.filePath;
  if (!path.extname(target)) target += '.md';

  try {
    await fs.writeFile(target, '', 'utf8');
    currentFile = path.resolve(target);
    await setWorkspaceRoot(path.dirname(currentFile));
    await resetEditor('');
    await recordRecentFile(currentFile);
    return true;
  } catch (error) {
    dialog.showErrorBox('Не удалось создать файл', error.message);
    return false;
  }
}

async function availableDrives() {
  const letters = Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`);
  const drives = await Promise.all(letters.map(async drivePath => {
    try {
      await fs.access(drivePath);
      return { name: drivePath.slice(0, 2), path: drivePath };
    } catch {
      return null;
    }
  }));
  return drives.filter(Boolean);
}

async function readWorkspaceDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    throw new TypeError('Invalid directory path');
  }
  let directoryEntries;
  try {
    directoryEntries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return { entries: [], inaccessible: true };
  }

  const entries = [];
  const sorted = directoryEntries.sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
  });

  for (const entry of sorted.slice(0, 1000)) {
    if (entry.isSymbolicLink()) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      entries.push({ type: 'directory', name: entry.name, path: entryPath });
    } else if (entry.isFile() && supportedExtensions.has(path.extname(entry.name).toLowerCase())) {
      entries.push({ type: 'file', name: entry.name, path: entryPath });
    }
  }
  return { entries, truncated: sorted.length > 1000 };
}

function isSupportedFilePath(filePath) {
  return typeof filePath === 'string'
    && path.isAbsolute(filePath)
    && supportedExtensions.has(path.extname(filePath).toLowerCase());
}

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: '&File',
      submenu: [
        { label: '&New', accelerator: 'Ctrl+N', click: newDocument },
        { label: '&Open...', accelerator: 'Ctrl+O', click: () => openDocument() },
        { type: 'separator' },
        { label: '&Save', accelerator: 'Ctrl+S', click: () => saveDocument() },
        { label: 'Save &As...', accelerator: 'Ctrl+Shift+S', click: () => saveDocument(true) },
        { type: 'separator' },
        { label: 'E&xit', accelerator: 'Alt+F4', click: () => mainWindow.close() },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '&View',
      submenu: [
        { role: 'reload' }, { type: 'separator' },
        { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
        { type: 'separator' }, { role: 'togglefullscreen' },
      ],
    },
    {
      label: '&Help',
      submenu: [
        { label: 'MarkEdit on GitHub', click: () => shell.openExternal('https://github.com/MarkEdit-app/MarkEdit') },
        { label: 'About MarkEdit', click: () => dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'About MarkEdit',
          message: 'MarkEdit for Windows',
          detail: `Unofficial Windows host using MarkEdit CoreEditor\nVersion ${app.getVersion()}\nMIT License`,
        }) },
      ],
    },
  ]);
}

async function createWindow(initialFile) {
  workspaceRoot = await loadWorkspaceRoot();
  await importSystemRecentFiles();
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 520,
    minHeight: 360,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  Menu.setApplicationMenu(buildMenu());
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
    }
  });
  mainWindow.on('close', async event => {
    if (forceClose || !dirty) return;
    event.preventDefault();
    if (await confirmDiscard()) {
      forceClose = true;
      mainWindow.close();
    }
  });

  await mainWindow.loadFile(path.join(__dirname, 'editor.html'));
  if (initialFile) await openDocument(initialFile);
  else updateTitle();
  mainWindow.show();
}

ipcMain.on('editor:dirty', () => {
  if (!dirty) {
    dirty = true;
    updateTitle();
  }
});

ipcMain.handle('clipboard:write', (_event, text) => {
  if (typeof text !== 'string' || text.length > 10_000_000) {
    throw new TypeError('Invalid clipboard content');
  }
  clipboard.writeText(text);
});

ipcMain.handle('document:save', () => saveDocument());
ipcMain.handle('workspace:snapshot', () => workspaceSnapshot());
ipcMain.handle('workspace:select-root', () => selectWorkspaceRoot());
ipcMain.handle('workspace:select-drive', (_event, drivePath) => selectWorkspaceDrive(drivePath));
ipcMain.handle('workspace:create-folder', (_event, name) => createWorkspaceFolder(name));
ipcMain.handle('workspace:delete-entry', (_event, target) => deleteWorkspaceEntry(target));
ipcMain.handle('workspace:move-entry', (_event, source, destination) => moveWorkspaceEntry(source, destination));
ipcMain.handle('workspace:choose-move-destination', (_event, source) => chooseMoveDestination(source));
ipcMain.handle('workspace:children', (_event, directory) => readWorkspaceDirectory(directory));
ipcMain.handle('workspace:create-file', () => createWorkspaceFile());
ipcMain.handle('workspace:open', async (_event, filePath) => {
  if (!isSupportedFilePath(filePath)) {
    throw new TypeError('Unsupported file path');
  }
  await openDocument(filePath);
  return true;
});

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      const filePath = fileFromArguments(argv);
      if (filePath) openDocument(filePath);
    }
  });
  app.whenReady().then(() => createWindow(fileFromArguments(process.argv)));
  app.on('window-all-closed', () => app.quit());
}

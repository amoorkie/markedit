const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, shell } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { DocumentWorkspace } = require('./document-workspace.cjs');

let mainWindow;
let currentFile;
let workspaceRoot;
let recentFiles = [];
const MAX_RECENT_FILES = 50;
let dirty = false;
let forceClose = false;
let closingWindow = false;

if (process.env.MARKEDIT_DEV_USER_DATA) {
  app.setPath('userData', process.env.MARKEDIT_DEV_USER_DATA);
}

// Один контроллер отвечает за документы; старые переменные служат проводнику и заголовку.
const documents = new DocumentWorkspace({
  getWindow: () => mainWindow,
  dialog,
  sessionPath: path.join(app.getPath('userData'), 'open-tabs.json'),
  supportsPath: filePath => isSupportedFilePath(filePath),
  onActive: tab => { currentFile = tab?.path || undefined; dirty = tab?.dirty === true; updateTitle(); },
  onFile: async (filePath, { active = true } = {}) => { if (active) await setWorkspaceRoot(path.dirname(filePath)); await recordRecentFile(filePath); },
});

// Ошибки файловых операций показываются пользователю и не разрывают очередь вкладок.
function documentAction(task) {
  return documents.run(task).catch(error => {
    dialog.showErrorBox('Не удалось выполнить действие', error.message);
    return false;
  });
}

const supportedExtensions = new Set(['.md', '.markdown', '.mdown', '.mkd', '.txt']);

function fileFromArguments(argv) {
  return argv.find(argument => {
    if (argument.startsWith('-')) return false;
    return supportedExtensions.has(path.extname(argument).toLowerCase());
  });
}

// Имя и признак изменений всегда принадлежат активной вкладке.
function updateTitle() {
  if (!mainWindow) return;
  const name = documents.active?.name || (currentFile ? path.basename(currentFile) : 'Untitled.md');
  mainWindow.setTitle(`${dirty ? '* ' : ''}${name} - MarkEdit`);
  mainWindow.setDocumentEdited(dirty);
}

async function newDocument() {
  // Новый документ становится отдельной вкладкой, не заменяя текущий черновик.
  return documentAction(() => documents.newDocument());
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

async function setWorkspaceLocation(directory) {
  workspaceRoot = path.resolve(directory);
  await rememberWorkspaceRoot();
}

async function loadWorkspaceRoot() {
  try {
    const saved = JSON.parse(await fs.readFile(workspaceStatePath(), 'utf8'));
    recentFiles = Array.isArray(saved.recentFiles)
      ? saved.recentFiles.filter(file => typeof file === 'string' && isSupportedFilePath(file)).slice(0, MAX_RECENT_FILES)
      : [];
    if (typeof saved.root === 'string' && path.isAbsolute(saved.root)) {
      await fs.access(saved.root);
      const savedRoot = path.resolve(saved.root);
      const desktop = path.resolve(app.getPath('desktop'));
      return savedRoot.toLowerCase() === desktop.toLowerCase() ? desktop : path.parse(savedRoot).root;
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
  recentFiles = [...recentFiles, ...systemFiles].filter((file, index, files) => (
    files.findIndex(candidate => candidate.toLowerCase() === file.toLowerCase()) === index
  )).slice(0, MAX_RECENT_FILES);
  await rememberWorkspaceRoot();
}

async function recordRecentFile(filePath) {
  const resolved = path.resolve(filePath);
  const alreadyListed = recentFiles.some(file => file.toLowerCase() === resolved.toLowerCase());
  if (!alreadyListed) recentFiles = [resolved, ...recentFiles].slice(0, MAX_RECENT_FILES);
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

async function removeRecentFile(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new TypeError('Недопустимый путь');
  recentFiles = recentFiles.filter(file => file.toLowerCase() !== path.resolve(filePath).toLowerCase());
  await rememberWorkspaceRoot();
  return workspaceSnapshot();
}

async function openDocument(filePath) {
  // Все входы — проводник, системная ассоциация и меню — используют одну дедупликацию.
  return documentAction(() => documents.open(filePath));
}

async function saveDocument(saveAs = false) {
  // Сохранение всегда относится к активному документу в очереди операций.
  return documentAction(() => documents.save(documents.activeId, saveAs));
}

async function workspaceSnapshot() {
  if (!workspaceRoot) workspaceRoot = await loadWorkspaceRoot();
  const contents = await readWorkspaceDirectory(workspaceRoot);
  const locations = await availableWorkspaceLocations();
  const selectedLocation = locations.find(entry => entry.path.toLowerCase() === workspaceRoot.toLowerCase());
  return {
    root: workspaceRoot,
    rootName: selectedLocation?.name ?? workspaceNameForPath(workspaceRoot),
    drives: locations,
    currentFile,
    recentFiles: await availableRecentFiles(),
    ...contents,
  };
}

async function revealActiveFile() {
  if (!currentFile) return false;
  await setWorkspaceRoot(path.dirname(currentFile));
  return true;
}

async function selectWorkspaceDrive(drivePath) {
  const drives = await availableWorkspaceLocations();
  const drive = drives.find(entry => entry.path.toLowerCase() === String(drivePath).toLowerCase());
  if (!drive) throw new TypeError('Недопустимый диск');
  await setWorkspaceLocation(drive.path);
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

function isRecentFile(target) {
  return typeof target === 'string'
    && path.isAbsolute(target)
    && supportedExtensions.has(path.extname(target).toLowerCase())
    && recentFiles.some(file => file.toLowerCase() === path.resolve(target).toLowerCase());
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
  if (documents.containsPath(target)) {
    dialog.showErrorBox('Нельзя удалить', 'Сначала закройте вкладки документов из этой папки.');
    return false;
  }
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

async function moveWorkspaceEntry(source, destinationDirectory, { allowRecent = false, allowExternalDestination = false } = {}) {
  const recentSource = allowRecent && isRecentFile(source);
  const validDestination = allowExternalDestination
    ? typeof destinationDirectory === 'string' && path.isAbsolute(destinationDirectory)
    : isWorkspaceRootOrInside(destinationDirectory);
  if ((!isInsideWorkspace(source) && !recentSource) || !validDestination) {
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

    try {
      await fs.rename(resolvedSource, target);
    } catch (error) {
      if (error.code !== 'EXDEV' || !sourceStats.isFile()) throw error;
      await fs.copyFile(resolvedSource, target);
      await fs.unlink(resolvedSource);
    }
    await documents.moved(resolvedSource, target);
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
  const recentSource = isRecentFile(source);
  if (!isInsideWorkspace(source) && !recentSource) throw new TypeError('Недопустимый путь');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: `Куда переместить «${path.basename(source)}»?`,
    defaultPath: path.dirname(source),
    buttonLabel: 'Переместить',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return false;
  if (!recentSource && !isWorkspaceRootOrInside(result.filePaths[0])) {
    dialog.showErrorBox('Нельзя переместить', `Выберите папку на диске ${workspaceNameForPath(workspaceRoot)}.`);
    return false;
  }
  return moveWorkspaceEntry(source, result.filePaths[0], {
    allowRecent: recentSource,
    allowExternalDestination: recentSource,
  });
}

function workspaceNameForPath(target) {
  return path.parse(target).root.replace(/[\\/]+$/, '');
}

async function createWorkspaceFile() {
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
    // Создание не перезаписывает существующий файл, даже если открыт такой же документ.
    await fs.writeFile(target, '', { encoding: 'utf8', flag: 'wx' });
    return documents.open(path.resolve(target));
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

async function availableWorkspaceLocations() {
  return [
    { name: 'Рабочий стол', path: path.resolve(app.getPath('desktop')), kind: 'desktop' },
    ...await availableDrives(),
  ];
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
        { type: 'separator' },
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
    if (forceClose) return;
    event.preventDefault();
    if (closingWindow) return;
    closingWindow = true;
    // Проверяются все вкладки, включая изменённые документы в свёрнутых группах.
    if (await documentAction(() => documents.confirmExit())) {
      forceClose = true;
      mainWindow.close();
    }
    closingWindow = false;
  });

  await mainWindow.loadFile(path.join(__dirname, 'editor.html'));
  // Восстановление редактора измеряет DOM: окно должно быть показано до ожидания кадра.
  mainWindow.show();
  await documents.run(() => documents.restore());
  if (initialFile) await openDocument(initialFile);
  else updateTitle();
}

ipcMain.on('editor:dirty', (event, id) => {
  if (event.sender === mainWindow?.webContents) documents.markDirty(id);
});

// Узкие IPC-команды не дают интерфейсу напрямую менять файлы или структуру сессии.
ipcMain.handle('tabs:snapshot', () => documents.snapshot());
ipcMain.handle('tabs:activate', (_event, id) => documentAction(() => documents.activate(id)));
ipcMain.handle('tabs:close', (_event, id) => documentAction(() => documents.close(id)));
ipcMain.handle('tabs:new', (_event, groupId) => documentAction(() => documents.newDocument(groupId)));
ipcMain.handle('tabs:open', (_event, groupId) => documentAction(() => documents.open(undefined, groupId)));
ipcMain.handle('tabs:update', (_event, id, patch) => documentAction(() => documents.updateTab(id, patch)));
ipcMain.handle('tabs:group-create', (_event, options) => documentAction(() => documents.createGroup(options)));
ipcMain.handle('tabs:group-update', (_event, id, patch) => documentAction(() => documents.updateGroup(id, patch)));
ipcMain.handle('tabs:ungroup', (_event, id) => documentAction(() => documents.ungroup(id)));

ipcMain.handle('clipboard:write', (_event, text) => {
  if (typeof text !== 'string' || text.length > 10_000_000) {
    throw new TypeError('Invalid clipboard content');
  }
  clipboard.writeText(text);
});

ipcMain.handle('document:save', () => saveDocument());
ipcMain.handle('clipboard:read', () => clipboard.readText());
ipcMain.handle('document:path', () => currentFile);
ipcMain.handle('workspace:snapshot', () => workspaceSnapshot());
ipcMain.handle('workspace:reveal-active', () => revealActiveFile());
ipcMain.handle('workspace:select-root', () => selectWorkspaceRoot());
ipcMain.handle('workspace:select-drive', (_event, drivePath) => selectWorkspaceDrive(drivePath));
ipcMain.handle('workspace:create-folder', (_event, name) => createWorkspaceFolder(name));
ipcMain.handle('workspace:delete-entry', (_event, target) => documentAction(() => deleteWorkspaceEntry(target)));
ipcMain.handle('workspace:move-entry', (_event, source, destination) => (
  documentAction(() => moveWorkspaceEntry(source, destination, { allowRecent: isRecentFile(source) }))
));
ipcMain.on('workspace:start-file-drag', (event, source) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || typeof source !== 'string' || !path.isAbsolute(source)) return;
  const resolvedSource = path.resolve(source);
  if ((!isInsideWorkspace(resolvedSource) && !isRecentFile(resolvedSource)) || !isSupportedFilePath(resolvedSource)) return;
  try {
    if (!fsSync.statSync(resolvedSource).isFile()) return;
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, 'drag-icon.png')
      : path.join(__dirname, 'build', 'icon.png');
    const dragIcon = nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 });
    event.sender.startDrag({ file: resolvedSource, icon: dragIcon });
  } catch {
    // The source may disappear while the drag gesture is starting.
  } finally {
    if (!event.sender.isDestroyed()) event.sender.send('workspace:file-drag-ended');
  }
});
ipcMain.handle('workspace:choose-move-destination', (_event, source) => documentAction(() => chooseMoveDestination(source)));
ipcMain.handle('workspace:remove-recent', (_event, filePath) => removeRecentFile(filePath));
ipcMain.handle('workspace:children', (_event, directory) => readWorkspaceDirectory(directory));
ipcMain.handle('workspace:create-file', () => documentAction(() => createWorkspaceFile()));
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

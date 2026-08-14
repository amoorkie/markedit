import DOMPurify from 'dompurify';
import { marked } from 'marked';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  createIcons,
  FileText,
  Folder,
  FolderOpen,
  FolderInput,
  FolderPlus,
  Monitor,
  Moon,
  Pencil,
  Plus,
  PanelLeft,
  PanelLeftClose,
  Settings,
  Sun,
  Trash2,
  X,
} from 'lucide';
import { createSectionTree, sectionSource } from './section-model.mjs';

const STORAGE_KEY = 'markedit-windows-appearance-v1';
const WORKSPACE_DRAG_TYPE = 'application/x-markedit-workspace-path';
const DEFAULT_SETTINGS = {
  scheme: 'system',
  accent: '#1769aa',
  font: 'serif',
  fontSize: 18,
  lineHeight: 1.72,
  contentWidth: 760,
};
const ICONS = {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Folder,
  FolderOpen,
  FolderInput,
  FolderPlus,
  Monitor,
  Moon,
  PanelLeft,
  PanelLeftClose,
  Pencil,
  Plus,
  Settings,
  Sun,
  Trash2,
  X,
};
const FONT_FAMILIES = {
  system: 'Segoe UI, system-ui, sans-serif',
  serif: 'Zen Antique, Georgia, serif',
  mono: 'JetBrains Mono, Consolas, monospace',
};
const FONT_OPTIONS = [
  { value: 'serif', label: 'С засечками' },
  { value: 'system', label: 'Системный' },
  { value: 'mono', label: 'Моноширинный' },
];

let settings = loadSettings();
let mode = 'read';
let reader;
let readerContent;
let editButton;
let settingsButton;
let settingsPanel;
let workspaceButton;
let workspaceSidebar;
let workspaceTree;
let workspaceTitle;
let draggedWorkspacePath;
let recentFilesOpen = false;
let driveMenuOpen = false;
let fontMenuOpen = false;
let renderedWorkspaceRoot;
const expandedWorkspacePaths = new Set();

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function actualScheme() {
  if (settings.scheme !== 'system') return settings.scheme;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applySettings() {
  const scheme = actualScheme();
  document.documentElement.dataset.appearance = scheme;
  document.documentElement.style.setProperty('--reader-accent', settings.accent);
  document.documentElement.style.setProperty('--reader-font', FONT_FAMILIES[settings.font]);
  document.documentElement.style.setProperty('--reader-font-size', `${settings.fontSize}px`);
  document.documentElement.style.setProperty('--reader-line-height', settings.lineHeight);
  document.documentElement.style.setProperty('--reader-width', `${settings.contentWidth}px`);
  window.webModules?.config.setTheme({ name: scheme === 'dark' ? 'github-dark' : 'github-light' });
  syncSettingsControls();
}

function icon(name, size = 18) {
  return `<i data-lucide="${name}" width="${size}" height="${size}" aria-hidden="true"></i>`;
}

function createInterface() {
  document.body.insertAdjacentHTML('beforeend', `
    <main id="reader" aria-label="Режим чтения" tabindex="-1">
      <article id="reader-content"></article>
    </main>
    <button class="icon-button standalone-control" id="workspace-button" type="button" title="Проводник" aria-label="Открыть проводник" aria-expanded="false">
      ${icon('panel-left')}
    </button>
    <aside id="workspace-sidebar" class="workspace-sidebar" aria-label="Проводник" hidden>
      <header class="workspace-header">
        <div class="workspace-heading">
          <span class="workspace-eyebrow">Проводник</span>
          <strong id="workspace-title">Нет папки</strong>
        </div>
        <div class="workspace-actions">
          <button class="icon-button icon-button-small" id="workspace-new-folder" type="button" title="Новая папка" aria-label="Создать папку">
            ${icon('folder-plus', 17)}
          </button>
          <button class="icon-button icon-button-small" id="workspace-new-file" type="button" title="Новый Markdown-файл" aria-label="Создать Markdown-файл">
            ${icon('plus', 17)}
          </button>
          <button class="icon-button icon-button-small" id="workspace-close" type="button" title="Скрыть проводник" aria-label="Скрыть проводник">
            ${icon('panel-left-close', 17)}
          </button>
        </div>
      </header>
      <section class="workspace-recent">
        <button class="workspace-accordion" id="workspace-recent-toggle" type="button" aria-expanded="false" aria-controls="workspace-recent-list">
          ${icon('chevron-right', 14)}<span>Недавние</span>
        </button>
        <ul id="workspace-recent-list" class="workspace-list workspace-recent-list" hidden></ul>
      </section>
      <div class="workspace-drive-control">
        <span>Диск</span>
        <div class="workspace-drive-picker">
          <button id="workspace-drive-toggle" type="button" aria-label="Выбрать диск" aria-haspopup="listbox" aria-expanded="false">
            <span id="workspace-drive-label">—</span>${icon('chevron-down', 14)}
          </button>
          <div id="workspace-drive-menu" class="workspace-drive-menu" role="listbox" aria-label="Диски" hidden></div>
        </div>
      </div>
      <nav id="workspace-tree" class="workspace-tree" aria-label="Файлы"></nav>
    </aside>
    <div id="workspace-context-menu" class="workspace-context-menu" role="menu" aria-label="Действия с файлом" hidden></div>
    <div class="floating-controls" aria-label="Управление документом">
      <button class="icon-button" id="new-file-button" type="button" title="Новый Markdown-файл" aria-label="Создать Markdown-файл">
        ${icon('plus')}
      </button>
      <button class="icon-button" id="appearance-button" type="button" title="Оформление" aria-label="Оформление" aria-expanded="false">
        ${icon('settings')}
      </button>
      <button class="icon-button" id="edit-button" type="button" title="Редактировать" aria-label="Редактировать" aria-pressed="false">
        ${icon('pencil')}
      </button>
    </div>
    <section id="appearance-panel" class="appearance-panel" aria-label="Настройки оформления" hidden>
      <header class="appearance-header">
        <h2>Оформление</h2>
        <button class="icon-button icon-button-small" id="appearance-close" type="button" title="Закрыть" aria-label="Закрыть настройки оформления">
          ${icon('x', 16)}
        </button>
      </header>
      <div class="setting-group">
        <span class="setting-label">Тема</span>
        <div class="segmented-control" id="scheme-control">
          <button type="button" data-scheme="light">${icon('sun', 15)}<span>Светлая</span></button>
          <button type="button" data-scheme="dark">${icon('moon', 15)}<span>Тёмная</span></button>
          <button type="button" data-scheme="system">${icon('monitor', 15)}<span>Система</span></button>
        </div>
      </div>
      <div class="setting-group">
        <span class="setting-label">Акцент</span>
        <div class="swatch-row" id="accent-control">
          ${['#1769aa', '#0f766e', '#68722c', '#9f3f5f', '#7656a8'].map(color => `
            <button type="button" class="color-swatch" data-accent="${color}" style="--swatch:${color}" title="Выбрать цвет" aria-label="Выбрать цвет ${color}"></button>
          `).join('')}
        </div>
      </div>
      <div class="setting-group">
        <span class="setting-label">Шрифт чтения</span>
        <div class="font-picker">
          <button id="font-toggle" type="button" aria-haspopup="listbox" aria-controls="font-menu" aria-expanded="false">
            <span id="font-label">С засечками</span>${icon('chevron-down', 16)}
          </button>
          <div id="font-menu" class="font-menu" role="listbox" aria-label="Шрифт чтения" hidden>
            ${FONT_OPTIONS.map(option => `<button class="font-option" type="button" role="option" data-font="${option.value}" aria-selected="false"><span>${option.label}</span>${icon('check', 15)}</button>`).join('')}
          </div>
        </div>
      </div>
      <label class="setting-group range-setting">
        <span class="setting-label">Размер текста <output id="font-size-output"></output></span>
        <input id="font-size-control" type="range" min="15" max="24" step="1">
      </label>
      <label class="setting-group range-setting">
        <span class="setting-label">Интервал <output id="line-height-output"></output></span>
        <input id="line-height-control" type="range" min="1.35" max="2" step="0.01">
      </label>
      <label class="setting-group range-setting">
        <span class="setting-label">Ширина текста <output id="width-output"></output></span>
        <input id="width-control" type="range" min="560" max="980" step="20">
      </label>
    </section>
  `);

  reader = document.getElementById('reader');
  readerContent = document.getElementById('reader-content');
  editButton = document.getElementById('edit-button');
  settingsButton = document.getElementById('appearance-button');
  settingsPanel = document.getElementById('appearance-panel');
  workspaceButton = document.getElementById('workspace-button');
  workspaceSidebar = document.getElementById('workspace-sidebar');
  workspaceTree = document.getElementById('workspace-tree');
  workspaceTitle = document.getElementById('workspace-title');
  createIcons({ icons: ICONS });
  bindInterface();
}

function bindInterface() {
  window.windowsHost.onFileDragEnded(clearWorkspaceDragState);
  editButton.addEventListener('click', async () => {
    if (mode === 'read') {
      await setMode('edit');
      return;
    }

    editButton.disabled = true;
    try {
      if (await window.windowsHost.saveDocument()) await setMode('read');
    } finally {
      editButton.disabled = false;
    }
  });
  settingsButton.addEventListener('click', () => setSettingsOpen(settingsPanel.hidden));
  document.getElementById('appearance-close').addEventListener('click', () => setSettingsOpen(false));
  workspaceButton.addEventListener('click', () => setWorkspaceOpen(true));
  document.getElementById('workspace-recent-toggle').addEventListener('click', () => {
    recentFilesOpen = !recentFilesOpen;
    syncRecentFilesAccordion();
  });
  document.getElementById('workspace-drive-toggle').addEventListener('click', () => setDriveMenuOpen(!driveMenuOpen));
  document.getElementById('font-toggle').addEventListener('click', () => setFontMenuOpen(!fontMenuOpen));
  document.getElementById('font-menu').addEventListener('click', event => {
    const option = event.target.closest('[data-font]');
    if (!option) return;
    updateSetting('font', option.dataset.font);
    setFontMenuOpen(false);
    document.getElementById('font-toggle').focus({ preventScroll: true });
  });
  document.getElementById('font-menu').addEventListener('keydown', event => {
    const options = [...document.querySelectorAll('.font-option')];
    const current = options.indexOf(document.activeElement);
    let next;
    if (event.key === 'ArrowDown') next = Math.min(options.length - 1, current + 1);
    if (event.key === 'ArrowUp') next = Math.max(0, current - 1);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = options.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    options[next].focus();
  });
  const driveControl = document.querySelector('.workspace-drive-control');
  bindWorkspaceDropTarget(driveControl, () => renderedWorkspaceRoot);
  bindWorkspaceDropTarget(workspaceTree, () => renderedWorkspaceRoot, { backgroundOnly: true });
  document.getElementById('workspace-new-folder').addEventListener('click', () => showNewFolderInput());
  bindCreateFileButton(document.getElementById('workspace-new-file'));
  bindCreateFileButton(document.getElementById('new-file-button'));
  document.getElementById('workspace-close').addEventListener('click', () => setWorkspaceOpen(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !settingsPanel.hidden) setSettingsOpen(false);
    if (event.key === 'Escape' && driveMenuOpen) setDriveMenuOpen(false);
    if (event.key === 'Escape' && fontMenuOpen) setFontMenuOpen(false);
    if (event.key === 'Escape') closeWorkspaceContextMenu();
  });
  document.addEventListener('pointerdown', event => {
    if (!settingsPanel.hidden && !settingsPanel.contains(event.target) && !settingsButton.contains(event.target)) {
      setSettingsOpen(false);
    }
    if (driveMenuOpen && !event.target.closest('.workspace-drive-picker')) setDriveMenuOpen(false);
    if (fontMenuOpen && !event.target.closest('.font-picker')) setFontMenuOpen(false);
    if (!event.target.closest('#workspace-context-menu')) closeWorkspaceContextMenu();
  });
  workspaceTree.addEventListener('scroll', closeWorkspaceContextMenu, { passive: true });

  document.getElementById('scheme-control').addEventListener('click', event => {
    const button = event.target.closest('[data-scheme]');
    if (button) updateSetting('scheme', button.dataset.scheme);
  });
  document.getElementById('accent-control').addEventListener('click', event => {
    const button = event.target.closest('[data-accent]');
    if (button) updateSetting('accent', button.dataset.accent);
  });
  document.getElementById('font-size-control').addEventListener('input', event => updateSetting('fontSize', Number(event.target.value)));
  document.getElementById('line-height-control').addEventListener('input', event => updateSetting('lineHeight', Number(event.target.value)));
  document.getElementById('width-control').addEventListener('input', event => updateSetting('contentWidth', Number(event.target.value)));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (settings.scheme === 'system') applySettings();
  });
}

function bindWorkspaceDropTarget(element, destinationPath, { backgroundOnly = false } = {}) {
  element.addEventListener('dragover', event => {
    if (!draggedWorkspacePath || (backgroundOnly && event.target.closest('.workspace-row'))) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    element.classList.add('drop-target');
  });
  element.addEventListener('dragleave', event => {
    if (!element.contains(event.relatedTarget)) element.classList.remove('drop-target');
  });
  element.addEventListener('drop', async event => {
    if (backgroundOnly && event.target.closest('.workspace-row')) return;
    event.preventDefault();
    event.stopPropagation();
    element.classList.remove('drop-target');
    const source = draggedWorkspacePath || event.dataTransfer.getData(WORKSPACE_DRAG_TYPE) || event.dataTransfer.getData('text/plain');
    clearWorkspaceDragState();
    const destination = destinationPath();
    if (!source || !destination) return;
    element.classList.add('loading');
    try {
      if (await window.windowsHost.moveWorkspaceEntry(source, destination)) await refreshWorkspace();
    } finally {
      element.classList.remove('loading');
    }
  });
}

function clearWorkspaceDragState() {
  draggedWorkspacePath = undefined;
  document.querySelectorAll('.workspace-row.dragging, .workspace-row.drop-target').forEach(row => {
    row.classList.remove('dragging', 'drop-target');
  });
  document.querySelectorAll('.workspace-drive-control.drop-target, .workspace-tree.drop-target').forEach(target => {
    target.classList.remove('drop-target');
  });
}

function bindWorkspaceDragSource(row, entry) {
  row.draggable = true;
  row.addEventListener('dragstart', event => {
    draggedWorkspacePath = entry.path;
    row.classList.add('dragging');
    if (entry.type === 'file') {
      event.preventDefault();
      window.windowsHost.startFileDrag(entry.path);
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(WORKSPACE_DRAG_TYPE, entry.path);
    event.dataTransfer.setData('text/plain', entry.path);
  });
  row.addEventListener('dragend', clearWorkspaceDragState);
}

function bindCreateFileButton(button) {
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      if (await window.windowsHost.createWorkspaceFile()) {
        await setMode('read');
        await refreshWorkspace();
      }
    } finally {
      button.disabled = false;
    }
  });
}

function updateSetting(key, value) {
  settings[key] = value;
  saveSettings();
  applySettings();
}

function syncSettingsControls() {
  if (!settingsPanel) return;
  settingsPanel.querySelectorAll('[data-scheme]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.scheme === settings.scheme));
  });
  settingsPanel.querySelectorAll('[data-accent]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.accent === settings.accent));
  });
  const fontOption = FONT_OPTIONS.find(option => option.value === settings.font) ?? FONT_OPTIONS[0];
  document.getElementById('font-label').textContent = fontOption.label;
  settingsPanel.querySelectorAll('[data-font]').forEach(option => {
    option.setAttribute('aria-selected', String(option.dataset.font === fontOption.value));
  });
  document.getElementById('font-size-control').value = settings.fontSize;
  document.getElementById('font-size-output').value = `${settings.fontSize}px`;
  document.getElementById('line-height-control').value = settings.lineHeight;
  document.getElementById('line-height-output').value = settings.lineHeight.toFixed(2);
  document.getElementById('width-control').value = settings.contentWidth;
  document.getElementById('width-output').value = `${settings.contentWidth}px`;
}

function setSettingsOpen(open) {
  settingsPanel.hidden = !open;
  settingsButton.setAttribute('aria-expanded', String(open));
  if (!open) setFontMenuOpen(false);
  if (open) document.getElementById('font-toggle').focus({ preventScroll: true });
}

function setFontMenuOpen(open) {
  fontMenuOpen = open;
  const toggle = document.getElementById('font-toggle');
  const menu = document.getElementById('font-menu');
  menu.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  toggle.classList.toggle('open', open);
  if (open) menu.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
}

async function setWorkspaceOpen(open) {
  workspaceSidebar.hidden = !open;
  workspaceButton.setAttribute('aria-expanded', String(open));
  document.documentElement.classList.toggle('sidebar-open', open);
  if (open) await refreshWorkspace();
}

async function setMode(nextMode) {
  mode = nextMode;
  const editing = mode === 'edit';
  document.documentElement.classList.toggle('editing-mode', editing);
  document.documentElement.classList.toggle('reading-mode', !editing);
  reader.hidden = editing;
  document.getElementById('editor').hidden = !editing;
  editButton.setAttribute('aria-pressed', String(editing));
  editButton.setAttribute('aria-label', editing ? 'Сохранить' : 'Редактировать');
  editButton.title = editing ? 'Сохранить' : 'Редактировать';
  editButton.innerHTML = icon(editing ? 'check' : 'pencil');
  createIcons({ icons: ICONS });
  window.webModules.config.setReadOnlyMode({ enabled: !editing });
  if (editing) {
    window.editor?.focus();
  } else {
    await refreshReader();
    reader.focus({ preventScroll: true });
  }
}

async function refreshWorkspace() {
  if (!workspaceTree || !window.windowsHost?.getWorkspace) return;
  const snapshot = await window.windowsHost.getWorkspace();
  workspaceTitle.textContent = snapshot.rootName ?? workspaceName(snapshot.root);
  workspaceTitle.title = snapshot.root;
  const rootChanged = renderedWorkspaceRoot?.toLowerCase() !== snapshot.root.toLowerCase();
  if (rootChanged) expandedWorkspacePaths.clear();
  renderedWorkspaceRoot = snapshot.root;
  const previousScrollTop = workspaceTree.scrollTop;
  workspaceTree.replaceChildren();
  renderDrivePicker(snapshot.drives, snapshot.root);
  renderRecentFiles(snapshot.recentFiles ?? [], snapshot.currentFile);

  const list = document.createElement('ul');
  list.className = 'workspace-list';
  if (snapshot.inaccessible) {
    list.append(workspaceMessage('Нет доступа к папке', 0));
  } else if (snapshot.entries.length === 0) {
    list.append(workspaceMessage('В папке нет Markdown-файлов', 0));
  } else {
    for (const entry of snapshot.entries) list.append(await renderWorkspaceEntry(entry, snapshot.currentFile, 0));
    if (snapshot.truncated) list.append(workspaceMessage('Показаны первые 1000 элементов', 0));
  }
  workspaceTree.append(list);
  if (!rootChanged) workspaceTree.scrollTop = previousScrollTop;
  createIcons({ icons: ICONS });
}

function renderDrivePicker(drives, selectedDrive) {
  const menu = document.getElementById('workspace-drive-menu');
  const selectedLocation = drives.find(drive => drive.path.toLowerCase() === selectedDrive.toLowerCase());
  document.getElementById('workspace-drive-label').textContent = selectedLocation?.name ?? workspaceName(selectedDrive);
  menu.replaceChildren(...drives.map(drive => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'workspace-drive-option';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(drive.path.toLowerCase() === selectedDrive.toLowerCase()));
    option.innerHTML = `<span>${escapeText(drive.name)}</span>${drive.path.toLowerCase() === selectedDrive.toLowerCase() ? icon('check', 14) : ''}`;
    option.addEventListener('click', async () => {
      setDriveMenuOpen(false);
      if (drive.path.toLowerCase() === renderedWorkspaceRoot?.toLowerCase()) return;
      const toggle = document.getElementById('workspace-drive-toggle');
      toggle.disabled = true;
      try {
        if (await window.windowsHost.selectWorkspaceDrive(drive.path)) await refreshWorkspace();
      } finally {
        toggle.disabled = false;
      }
    });
    return option;
  }));
  setDriveMenuOpen(false);
}

function setDriveMenuOpen(open) {
  driveMenuOpen = open;
  const toggle = document.getElementById('workspace-drive-toggle');
  const menu = document.getElementById('workspace-drive-menu');
  menu.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  toggle.classList.toggle('open', open);
  if (open) menu.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
}

function renderRecentFiles(files, currentFile) {
  const list = document.getElementById('workspace-recent-list');
  list.replaceChildren();
  if (files.length === 0) {
    list.append(workspaceMessage('Пока нет файлов', 0));
  } else {
    for (const entry of files) {
      const item = document.createElement('li');
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'workspace-row workspace-recent-row';
      row.title = entry.path;
      row.classList.toggle('selected', entry.path.toLowerCase() === currentFile?.toLowerCase());
      row.innerHTML = `<span class="workspace-spacer"></span>${icon('file-text', 15)}<span>${escapeText(entry.name)}</span>`;
      bindWorkspaceDragSource(row, entry);
      row.addEventListener('click', async () => {
        document.querySelectorAll('.workspace-row.selected').forEach(selected => selected.classList.remove('selected'));
        row.classList.add('selected');
        await window.windowsHost.openWorkspaceFile(entry.path);
      });
      row.addEventListener('contextmenu', event => showWorkspaceContextMenu(event, entry, { recent: true }));
      item.append(row);
      list.append(item);
    }
  }
  syncRecentFilesAccordion();
}

function syncRecentFilesAccordion() {
  const toggle = document.getElementById('workspace-recent-toggle');
  const list = document.getElementById('workspace-recent-list');
  list.hidden = !recentFilesOpen;
  toggle.setAttribute('aria-expanded', String(recentFilesOpen));
  toggle.innerHTML = `${icon(recentFilesOpen ? 'chevron-down' : 'chevron-right', 14)}<span>Недавние</span>`;
  createIcons({ icons: ICONS });
}

function workspaceName(directory) {
  if (!directory) return 'Нет папки';
  return directory.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || directory;
}

function showNewFolderInput() {
  if (workspaceTree.querySelector('.workspace-new-folder-row')) return;
  const row = document.createElement('div');
  row.className = 'workspace-new-folder-row';
  row.innerHTML = `${icon('folder', 15)}<input type="text" aria-label="Имя новой папки" placeholder="Новая папка" maxlength="120">`;
  workspaceTree.prepend(row);
  createIcons({ icons: ICONS });
  const input = row.querySelector('input');
  const finish = async create => {
    const name = input.value.trim();
    if (create && name) {
      input.disabled = true;
      try {
        if (await window.windowsHost.createWorkspaceFolder(name)) await refreshWorkspace();
      } finally {
        if (row.isConnected) input.disabled = false;
      }
      return;
    }
    row.remove();
  };
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') finish(true);
    if (event.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(false));
  input.focus();
}

function addDeleteAction(item, entry) {
  item.classList.add('workspace-item');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'workspace-delete';
  button.title = `Удалить ${entry.name}`;
  button.setAttribute('aria-label', `Удалить ${entry.name}`);
  button.innerHTML = icon('trash-2', 14);
  button.addEventListener('click', async event => {
    event.stopPropagation();
    button.disabled = true;
    try {
      if (await window.windowsHost.deleteWorkspaceEntry(entry.path)) await refreshWorkspace();
    } finally {
      button.disabled = false;
    }
  });
  item.append(button);
}

function showWorkspaceContextMenu(event, entry, { recent = false } = {}) {
  event.preventDefault();
  event.stopPropagation();
  setDriveMenuOpen(false);
  const menu = document.getElementById('workspace-context-menu');
  const actions = [];
  if (entry.type === 'file') {
    actions.push({
      label: 'Открыть',
      icon: 'file-text',
      run: () => window.windowsHost.openWorkspaceFile(entry.path),
    });
  }
  if (recent) {
    actions.push({
      label: 'Переместить…',
      icon: 'folder-input',
      run: async () => {
        if (await window.windowsHost.chooseMoveDestination(entry.path)) await refreshWorkspace();
      },
    });
    actions.push({
      label: 'Убрать из недавних',
      icon: 'x',
      run: async () => {
        if (await window.windowsHost.removeRecentFile(entry.path)) await refreshWorkspace();
      },
    });
  } else {
    actions.push({
      label: 'Переместить…',
      icon: 'folder-input',
      run: async () => {
        if (await window.windowsHost.chooseMoveDestination(entry.path)) await refreshWorkspace();
      },
    });
    actions.push({
      label: 'Удалить',
      icon: 'trash-2',
      danger: true,
      run: async () => {
        if (await window.windowsHost.deleteWorkspaceEntry(entry.path)) await refreshWorkspace();
      },
    });
  }

  menu.replaceChildren(...actions.map(action => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `workspace-context-action${action.danger ? ' danger' : ''}`;
    button.setAttribute('role', 'menuitem');
    button.innerHTML = `${icon(action.icon, 15)}<span>${action.label}</span>`;
    button.addEventListener('click', async () => {
      closeWorkspaceContextMenu();
      button.disabled = true;
      try {
        await action.run();
      } finally {
        button.disabled = false;
      }
    });
    return button;
  }));
  menu.hidden = false;
  const left = Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 8);
  const top = Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  createIcons({ icons: ICONS });
  menu.querySelector('button')?.focus({ preventScroll: true });
}

function closeWorkspaceContextMenu() {
  const menu = document.getElementById('workspace-context-menu');
  if (menu) menu.hidden = true;
}

async function renderWorkspaceEntry(entry, currentFile, depth) {
  const item = document.createElement('li');
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'workspace-row';
  row.style.setProperty('--workspace-depth', depth);
  row.addEventListener('contextmenu', event => showWorkspaceContextMenu(event, entry));
  bindWorkspaceDragSource(row, entry);
  item.append(row);

  if (entry.type === 'file') {
    row.innerHTML = `<span class="workspace-spacer"></span>${icon('file-text', 15)}<span>${escapeText(entry.name)}</span>`;
    row.title = entry.path;
    row.classList.toggle('selected', entry.path.toLowerCase() === currentFile?.toLowerCase());
    row.addEventListener('click', async () => {
      workspaceSidebar.querySelectorAll('.workspace-row.selected').forEach(selected => selected.classList.remove('selected'));
      row.classList.add('selected');
      await window.windowsHost.openWorkspaceFile(entry.path);
    });
    addDeleteAction(item, entry);
    return item;
  }

  let expanded = false;
  let loaded = false;
  const children = document.createElement('ul');
  children.className = 'workspace-list';
  children.hidden = true;
  item.append(children);

  const updateRow = () => {
    children.hidden = !expanded;
    row.setAttribute('aria-expanded', String(expanded));
    const folderIcon = expanded ? 'folder-open' : 'folder';
    row.innerHTML = `${icon(expanded ? 'chevron-down' : 'chevron-right', 14)}${icon(folderIcon, 15)}<span>${escapeText(entry.name)}</span>`;
    row.title = entry.path;
    createIcons({ icons: ICONS });
  };

  const setExpanded = async nextExpanded => {
    expanded = nextExpanded;
    const expansionKey = entry.path.toLowerCase();
    if (expanded) expandedWorkspacePaths.add(expansionKey);
    else expandedWorkspacePaths.delete(expansionKey);
    updateRow();
    if (!expanded || loaded) return;
    row.classList.add('loading');
    const result = await window.windowsHost.getWorkspaceChildren(entry.path);
    children.replaceChildren();
    if (result.inaccessible) {
      children.append(workspaceMessage('Нет доступа к папке', depth + 1));
    } else if (result.entries.length === 0) {
      children.append(workspaceMessage('Папка пуста', depth + 1));
    } else {
      for (const child of result.entries) {
        children.append(await renderWorkspaceEntry(child, currentFile, depth + 1));
      }
      if (result.truncated) children.append(workspaceMessage('Показаны первые 1000 элементов', depth + 1));
    }
    loaded = true;
    row.classList.remove('loading');
    createIcons({ icons: ICONS });
  };

  row.addEventListener('dragover', event => {
    if (!draggedWorkspacePath || draggedWorkspacePath.toLowerCase() === entry.path.toLowerCase()) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.workspace-row.drop-target').forEach(target => {
      if (target !== row) target.classList.remove('drop-target');
    });
    row.classList.add('drop-target');
  });
  row.addEventListener('dragleave', event => {
    event.stopPropagation();
    if (!row.contains(event.relatedTarget)) row.classList.remove('drop-target');
  });
  row.addEventListener('drop', async event => {
    event.preventDefault();
    event.stopPropagation();
    row.classList.remove('drop-target');
    const source = draggedWorkspacePath || event.dataTransfer.getData(WORKSPACE_DRAG_TYPE) || event.dataTransfer.getData('text/plain');
    clearWorkspaceDragState();
    if (!source) return;
    row.classList.add('loading');
    try {
      if (await window.windowsHost.moveWorkspaceEntry(source, entry.path)) {
        expandedWorkspacePaths.add(entry.path.toLowerCase());
        await refreshWorkspace();
      }
    } finally {
      row.classList.remove('loading');
    }
  });

  row.addEventListener('click', () => setExpanded(!expanded));
  addDeleteAction(item, entry);
  updateRow();
  if (expandedWorkspacePaths.has(entry.path.toLowerCase())) await setExpanded(true);
  return item;
}

function workspaceMessage(text, depth) {
  const message = document.createElement('li');
  message.className = 'workspace-inline-message';
  message.style.setProperty('--workspace-depth', depth);
  message.textContent = text;
  return message;
}

function escapeText(value) {
  const element = document.createElement('span');
  element.textContent = value;
  return element.innerHTML;
}

async function refreshReader() {
  if (!readerContent || !window.webModules?.core) return;
  if (mode === 'read') window.webModules.config.setReadOnlyMode({ enabled: true });
  const text = window.webModules.core.getEditorText();
  const root = createSectionTree(marked.lexer(text, { gfm: true }));
  readerContent.replaceChildren();

  if (root.tokens.length > 0) {
    const preamble = document.createElement('div');
    preamble.className = 'reader-preamble';
    setSanitizedMarkdown(preamble, root.tokens.map(token => token.raw ?? '').join(''));
    readerContent.append(preamble);
  }
  root.children.forEach(section => readerContent.append(renderSection(section)));
  createIcons({ icons: ICONS });

  if (root.tokens.length === 0 && root.children.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'reader-empty';
    empty.textContent = 'Пустой документ';
    readerContent.append(empty);
  }
}

function renderSection(section) {
  const element = document.createElement('section');
  element.className = 'reader-section';
  element.dataset.level = section.level;

  const copyButton = document.createElement('button');
  copyButton.className = 'section-copy';
  copyButton.type = 'button';
  copyButton.title = 'Копировать раздел';
  copyButton.setAttribute('aria-label', 'Копировать раздел');
  copyButton.innerHTML = icon('copy', 16);
  copyButton.addEventListener('click', async () => {
    await window.windowsHost.copyText(sectionSource(section).trimEnd());
    copyButton.innerHTML = icon('check', 16);
    copyButton.classList.add('copied');
    createIcons({ icons: ICONS });
    setTimeout(() => {
      copyButton.innerHTML = icon('copy', 16);
      copyButton.classList.remove('copied');
      createIcons({ icons: ICONS });
    }, 1400);
  });
  const ownContent = document.createElement('div');
  ownContent.className = 'section-content';
  setSanitizedMarkdown(ownContent, section.tokens.map(token => token.raw ?? '').join(''));
  const heading = ownContent.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6');
  if (heading) {
    heading.append(copyButton);
  } else {
    ownContent.prepend(copyButton);
  }
  element.append(ownContent);
  section.children.forEach(child => element.append(renderSection(child)));
  createIcons({ icons: ICONS });
  return element;
}

function setSanitizedMarkdown(element, source) {
  element.innerHTML = DOMPurify.sanitize(marked.parse(source, { gfm: true }), {
    USE_PROFILES: { html: true },
  });
}

async function initialize() {
  createInterface();
  applySettings();
  document.documentElement.classList.add('markedit-ready');
  await setMode('read');
  await refreshWorkspace();
}

async function documentChanged() {
  await Promise.all([refreshReader(), refreshWorkspace()]);
}

window.markEditWindows = { documentChanged, refreshReader, refreshWorkspace };
if (document.readyState === 'complete') initialize();
else window.addEventListener('load', initialize, { once: true });

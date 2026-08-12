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
  serif: 'Charter, Georgia, Cambria, serif',
  mono: 'Cascadia Mono, Consolas, monospace',
};

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
      <label class="workspace-drive-control">
        <span>Диск</span>
        <span class="workspace-drive-select">
          <select id="workspace-drive-select" aria-label="Выбрать диск"></select>
          ${icon('chevron-down', 14)}
        </span>
      </label>
      <section class="workspace-recent">
        <button class="workspace-accordion" id="workspace-recent-toggle" type="button" aria-expanded="false" aria-controls="workspace-recent-list">
          ${icon('chevron-right', 14)}<span>Недавние</span>
        </button>
        <ul id="workspace-recent-list" class="workspace-list workspace-recent-list" hidden></ul>
      </section>
      <nav id="workspace-tree" class="workspace-tree" aria-label="Файлы"></nav>
    </aside>
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
      <label class="setting-group">
        <span class="setting-label">Шрифт чтения</span>
        <span class="select-control">
          <select id="font-control">
            <option value="serif">С засечками</option>
            <option value="system">Системный</option>
            <option value="mono">Моноширинный</option>
          </select>
          ${icon('chevron-down', 16)}
        </span>
      </label>
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
  document.getElementById('workspace-drive-select').addEventListener('change', async event => {
    const select = event.currentTarget;
    select.disabled = true;
    try {
      if (await window.windowsHost.selectWorkspaceDrive(select.value)) await refreshWorkspace();
    } finally {
      select.disabled = false;
    }
  });
  document.getElementById('workspace-new-folder').addEventListener('click', () => showNewFolderInput());
  bindCreateFileButton(document.getElementById('workspace-new-file'));
  bindCreateFileButton(document.getElementById('new-file-button'));
  document.getElementById('workspace-close').addEventListener('click', () => setWorkspaceOpen(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !settingsPanel.hidden) setSettingsOpen(false);
  });
  document.addEventListener('pointerdown', event => {
    if (!settingsPanel.hidden && !settingsPanel.contains(event.target) && !settingsButton.contains(event.target)) {
      setSettingsOpen(false);
    }
  });

  document.getElementById('scheme-control').addEventListener('click', event => {
    const button = event.target.closest('[data-scheme]');
    if (button) updateSetting('scheme', button.dataset.scheme);
  });
  document.getElementById('accent-control').addEventListener('click', event => {
    const button = event.target.closest('[data-accent]');
    if (button) updateSetting('accent', button.dataset.accent);
  });
  document.getElementById('font-control').addEventListener('change', event => updateSetting('font', event.target.value));
  document.getElementById('font-size-control').addEventListener('input', event => updateSetting('fontSize', Number(event.target.value)));
  document.getElementById('line-height-control').addEventListener('input', event => updateSetting('lineHeight', Number(event.target.value)));
  document.getElementById('width-control').addEventListener('input', event => updateSetting('contentWidth', Number(event.target.value)));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (settings.scheme === 'system') applySettings();
  });
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
  document.getElementById('font-control').value = settings.font;
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
  if (open) document.getElementById('font-control').focus({ preventScroll: true });
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
  workspaceTitle.textContent = workspaceName(snapshot.root);
  workspaceTitle.title = snapshot.root;
  workspaceTree.replaceChildren();
  const driveSelect = document.getElementById('workspace-drive-select');
  driveSelect.replaceChildren(...snapshot.drives.map(drive => {
    const option = document.createElement('option');
    option.value = drive.path;
    option.textContent = drive.name;
    return option;
  }));
  driveSelect.value = snapshot.root;
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
  createIcons({ icons: ICONS });
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
      row.classList.toggle('active', entry.path.toLowerCase() === currentFile?.toLowerCase());
      row.innerHTML = `<span class="workspace-spacer"></span>${icon('file-text', 15)}<span>${escapeText(entry.name)}</span>`;
      row.addEventListener('click', () => window.windowsHost.openWorkspaceFile(entry.path));
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

async function renderWorkspaceEntry(entry, currentFile, depth) {
  const item = document.createElement('li');
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'workspace-row';
  row.style.setProperty('--workspace-depth', depth);
  row.draggable = true;
  row.addEventListener('dragstart', event => {
    draggedWorkspacePath = entry.path;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', entry.path);
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', () => {
    draggedWorkspacePath = undefined;
    row.classList.remove('dragging');
    document.querySelectorAll('.workspace-row.drop-target').forEach(target => target.classList.remove('drop-target'));
  });
  item.append(row);

  if (entry.type === 'file') {
    row.innerHTML = `<span class="workspace-spacer"></span>${icon('file-text', 15)}<span>${escapeText(entry.name)}</span>`;
    row.title = entry.path;
    row.classList.toggle('active', entry.path.toLowerCase() === currentFile?.toLowerCase());
    row.addEventListener('click', () => window.windowsHost.openWorkspaceFile(entry.path));
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
    event.dataTransfer.dropEffect = 'move';
    row.classList.add('drop-target');
  });
  row.addEventListener('dragleave', event => {
    if (!row.contains(event.relatedTarget)) row.classList.remove('drop-target');
  });
  row.addEventListener('drop', async event => {
    event.preventDefault();
    event.stopPropagation();
    row.classList.remove('drop-target');
    const source = draggedWorkspacePath || event.dataTransfer.getData('text/plain');
    draggedWorkspacePath = undefined;
    if (!source) return;
    row.classList.add('loading');
    try {
      if (await window.windowsHost.moveWorkspaceEntry(source, entry.path)) await refreshWorkspace();
    } finally {
      row.classList.remove('loading');
    }
  });

  row.addEventListener('click', () => setExpanded(!expanded));
  addDeleteAction(item, entry);
  updateRow();
  if (entry.expanded) await setExpanded(true);
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
  element.append(copyButton);

  const ownContent = document.createElement('div');
  ownContent.className = 'section-content';
  setSanitizedMarkdown(ownContent, section.tokens.map(token => token.raw ?? '').join(''));
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

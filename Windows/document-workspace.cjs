// Хранит документы отдельно от интерфейса: переключение вкладки не теряет черновик.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const GROUP_COLORS = ['#1769aa', '#0f766e', '#68722c', '#9f3f5f', '#7656a8', '#bd682a'];

class DocumentWorkspace {
  // Зависимости передаются явно, чтобы проверять сохранение и отмену без диалогов ОС.
  constructor({ getWindow, dialog, sessionPath, onActive, onFile, supportsPath }) {
    Object.assign(this, { getWindow, dialog, sessionPath, onActive, onFile, supportsPath });
    this.tabs = [];
    this.groups = [];
    this.activeId = null;
    this.sequence = Promise.resolve();
    this.untitledNumber = 0;
  }

  // Очередь исключает взаимное наложение быстрых кликов, сохранения и закрытия.
  run(task) {
    const result = this.sequence.then(task).finally(async () => {
      // Возвращаем возможность ввода также при отмене диалога и ошибке чтения/записи.
      const window = this.getWindow();
      if (window && !window.isDestroyed?.()) await window.webContents.executeJavaScript('window.markEditWindows?.finishDocumentOperation()').catch(() => {});
    });
    this.sequence = result.catch(() => {});
    return result;
  }

  get active() { return this.tabs.find(tab => tab.id === this.activeId); }

  // Интерфейсу не передаётся содержимое остальных документов через общий снимок.
  snapshot() {
    return {
      activeId: this.activeId,
      tabs: this.tabs.map(({ text, savedText, ...tab }) => ({ ...tab })),
      groups: this.groups.map(group => ({ ...group })),
    };
  }

  // Забирает актуальный текст перед переходом; renderer сохраняет историю CodeMirror.
  async capture() {
    const tab = this.active;
    if (!tab) return;
    const value = await this.getWindow().webContents.executeJavaScript('window.markEditWindows.captureDocumentState()');
    if (value?.id !== tab.id || typeof value.text !== 'string') throw new Error('Документ ещё переключается. Повторите действие.');
    tab.text = value.text;
    tab.mode = value.mode === 'edit' ? 'edit' : 'read';
    tab.dirty = tab.text !== tab.savedText;
    this.onActive(tab);
  }

  // Метаданные восстанавливают раскладку. Несохранённые тексты остаются в памяти,
  // а при штатном выходе каждый изменённый документ проходит диалог сохранения.
  async persist() {
    const data = { version: 1, activeId: this.activeId, groups: this.groups, tabs: this.tabs.filter(tab => tab.path).map(({ text, savedText, dirty, ...tab }) => tab) };
    await fs.mkdir(path.dirname(this.sessionPath), { recursive: true });
    await fs.writeFile(`${this.sessionPath}.tmp`, JSON.stringify(data), 'utf8');
    await fs.rename(`${this.sessionPath}.tmp`, this.sessionPath);
  }

  // Обновляет только панель вкладок; редактор при закреплении/группировке не сбрасывается.
  async notify() {
    this.onActive(this.active);
    this.getWindow().webContents.send('tabs:changed', this.snapshot());
    await this.persist();
  }

  // Устанавливает активный документ после сохранения предыдущего снимка.
  async display(id) {
    this.activeId = id;
    const tab = this.active;
    this.onActive(tab);
    await this.getWindow().webContents.executeJavaScript(`window.markEditWindows.loadDocument(${JSON.stringify(tab ? { id: tab.id, text: tab.text, mode: tab.mode, path: tab.path || undefined } : null)})`);
    await this.notify();
  }

  // Переключение никогда не требует сохранения: предыдущий буфер остаётся в сессии.
  async activate(id) {
    if (!this.tabs.some(tab => tab.id === id)) return false;
    if (id === this.activeId) return true;
    await this.capture();
    await this.display(id);
    return true;
  }

  // Один путь соответствует одной вкладке, независимо от регистра букв Windows.
  async open(filePath, groupId = null) {
    if (!filePath) {
      const answer = await this.dialog.showOpenDialog(this.getWindow(), { title: 'Открыть документы', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Документы', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }] });
      if (answer.canceled) return false;
      for (const file of answer.filePaths) await this.open(file, groupId);
      return true;
    }
    if (!this.supportsPath(filePath)) throw new TypeError('Неподдерживаемый путь документа');
    const resolved = path.resolve(filePath);
    const existing = this.tabs.find(tab => tab.path?.toLowerCase() === resolved.toLowerCase());
    if (existing) return this.activate(existing.id);
    // Сначала чтение: исчезнувший файл не меняет текущий документ.
    const text = await fs.readFile(resolved, 'utf8');
    await this.capture();
    const tab = this.makeTab({ path: resolved, text, groupId });
    this.tabs.push(tab);
    await this.onFile(resolved);
    await this.display(tab.id);
    return true;
  }

  // UUID отделяет идентичность буфера от пути, который может измениться при Save As.
  makeTab({ path: filePath = null, text = '', groupId = null } = {}) {
    return { id: randomUUID(), path: filePath, name: filePath ? path.basename(filePath) : `Новый документ ${++this.untitledNumber}.md`, text, savedText: text, dirty: false, mode: filePath ? 'read' : 'edit', width: 180, pinned: false, groupId: this.groups.some(group => group.id === groupId) ? groupId : null };
  }

  // Черновику не нужен файл на диске до первого явного сохранения.
  async newDocument(groupId = null) {
    await this.capture();
    const tab = this.makeTab({ groupId });
    this.tabs.push(tab);
    await this.display(tab.id);
    return true;
  }

  // Сохраняет и неактивную вкладку; закрытие одной вкладки не затрагивает остальные.
  async save(id = this.activeId, saveAs = false) {
    if (id === this.activeId) await this.capture();
    const tab = this.tabs.find(item => item.id === id);
    if (!tab) return false;
    let target = tab.path;
    if (!target || saveAs) {
      const answer = await this.dialog.showSaveDialog(this.getWindow(), { title: 'Сохранить документ', defaultPath: target || tab.name, filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Текст', extensions: ['txt'] }] });
      if (answer.canceled || !answer.filePath) return false;
      target = path.resolve(answer.filePath);
    }
    if (this.tabs.some(item => item.id !== id && item.path?.toLowerCase() === target.toLowerCase())) {
      throw new Error('Этот файл уже открыт в другой вкладке. Выберите другое имя.');
    }
    await fs.writeFile(target, tab.text, 'utf8');
    tab.path = target;
    tab.name = path.basename(target);
    tab.savedText = tab.text;
    tab.dirty = false;
    await this.onFile(target, { active: id === this.activeId });
    await this.notify();
    // Обновление дерева после записи не удерживает заблокированным редактор.
    await this.getWindow().webContents.executeJavaScript('void window.markEditWindows.refreshWorkspace()?.catch(error => console.error("Не удалось обновить проводник", error))');
    return true;
  }

  // Отмена диалога сохраняет вкладку и её историю; отказ от сохранения действует только на неё.
  async confirmClose(tab) {
    if (!tab.dirty) return true;
    const { response } = await this.dialog.showMessageBox(this.getWindow(), { type: 'warning', buttons: ['Сохранить', 'Не сохранять', 'Отмена'], defaultId: 0, cancelId: 2, title: 'MarkEdit', message: `Сохранить изменения в «${tab.name}»?`, detail: 'При закрытии несохранённые изменения этого документа будут потеряны.' });
    if (response === 2) return false;
    return response === 0 ? this.save(tab.id) : true;
  }

  // При закрытии активной вкладки выбирается соседняя, при закрытии фоновой — текущая.
  async close(id) {
    await this.capture();
    const index = this.tabs.findIndex(tab => tab.id === id);
    if (index === -1) return false;
    if (!await this.confirmClose(this.tabs[index])) return false;
    this.tabs.splice(index, 1);
    await this.getWindow().webContents.executeJavaScript(`window.markEditWindows.forgetDocument(${JSON.stringify(id)})`);
    if (this.activeId === id) await this.display(this.tabs[Math.min(index, this.tabs.length - 1)]?.id ?? null);
    else await this.notify();
    return true;
  }

  // Проверка всей сессии защищает черновики в фоновых и свёрнутых вкладках.
  async confirmExit() {
    await this.capture();
    for (const tab of this.tabs) if (!await this.confirmClose(tab)) return false;
    await this.persist();
    return true;
  }

  // Позднее событие редактирования привязано к id, а не к текущей активной вкладке.
  markDirty(id) {
    const tab = this.tabs.find(item => item.id === id);
    if (!tab) return;
    tab.dirty = true;
    this.onActive(this.active);
    this.getWindow().webContents.send('tabs:changed', this.snapshot());
  }

  // Изменяется только разрешённая метаинформация; путь и текст через этот IPC недоступны.
  async updateTab(id, patch) {
    const tab = this.tabs.find(item => item.id === id);
    if (!tab || !patch || typeof patch !== 'object') return false;
    if ('width' in patch && Number.isFinite(patch.width)) tab.width = Math.max(40, Math.min(360, Math.round(patch.width)));
    if ('pinned' in patch) { tab.pinned = patch.pinned === true; if (tab.pinned) tab.groupId = null; }
    if ('groupId' in patch) { tab.groupId = this.groups.some(group => group.id === patch.groupId) ? patch.groupId : null; if (tab.groupId) tab.pinned = false; }
    await this.notify();
    return true;
  }

  // Группа существует независимо от документов и может быть создана пустой.
  async createGroup({ name = 'Новая группа', color = GROUP_COLORS[0], tabId } = {}) {
    const group = { id: randomUUID(), name: String(name).trim().slice(0, 80) || 'Новая группа', color: GROUP_COLORS.includes(color) ? color : GROUP_COLORS[0], collapsed: false };
    this.groups.push(group);
    if (tabId) { const tab = this.tabs.find(item => item.id === tabId); if (tab) { tab.groupId = group.id; tab.pinned = false; } }
    await this.notify();
    return group.id;
  }

  // Палитра фиксирована, чтобы цвет оставался читаемым в обеих темах приложения.
  async updateGroup(id, patch) {
    const group = this.groups.find(item => item.id === id);
    if (!group || !patch || typeof patch !== 'object') return false;
    if (typeof patch.name === 'string') group.name = patch.name.trim().slice(0, 80) || group.name;
    if (GROUP_COLORS.includes(patch.color)) group.color = patch.color;
    if (typeof patch.collapsed === 'boolean') group.collapsed = patch.collapsed;
    await this.notify();
    return true;
  }

  // Разгруппировка удаляет только объединение, сохраняя открытые документы.
  async ungroup(id) {
    for (const tab of this.tabs) if (tab.groupId === id) tab.groupId = null;
    this.groups = this.groups.filter(group => group.id !== id);
    await this.notify();
  }

  // Переименование/перенос в проводнике обновляет все открытые документы, включая неактивные.
  async moved(source, target) {
    const key = source.toLowerCase();
    for (const tab of this.tabs) {
      if (tab.path && (tab.path.toLowerCase() === key || tab.path.toLowerCase().startsWith(`${key}${path.sep}`))) {
        tab.path = path.join(target, path.relative(source, tab.path));
        tab.name = path.basename(tab.path);
      }
    }
    await this.notify();
  }

  // Защищает также неактивные документы от удаления вместе с родительской папкой.
  containsPath(target) {
    const key = path.resolve(target).toLowerCase();
    return this.tabs.some(tab => tab.path && (tab.path.toLowerCase() === key || tab.path.toLowerCase().startsWith(`${key}${path.sep}`)));
  }

  // Восстановление терпимо к удалённым файлам и старым/повреждённым метаданным.
  async restore() {
    let saved;
    try { saved = JSON.parse(await fs.readFile(this.sessionPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') console.warn('Не удалось прочитать раскладку вкладок', error.message); return; }
    if (saved?.version !== 1 || !Array.isArray(saved.tabs)) return;
    this.groups = (Array.isArray(saved.groups) ? saved.groups : []).filter(group => typeof group.id === 'string' && typeof group.name === 'string' && GROUP_COLORS.includes(group.color)).map(group => ({ id: group.id, name: group.name.slice(0, 80), color: group.color, collapsed: group.collapsed === true }));
    for (const item of saved.tabs) {
      if (!this.supportsPath(item.path) || this.tabs.some(tab => tab.path.toLowerCase() === item.path.toLowerCase())) continue;
      try {
        const text = await fs.readFile(item.path, 'utf8');
        const tab = this.makeTab({ path: item.path, text, groupId: item.groupId });
        if (typeof item.id === 'string' && !this.tabs.some(other => other.id === item.id)) tab.id = item.id;
        tab.width = Number.isFinite(item.width) ? Math.max(40, Math.min(360, item.width)) : 180;
        tab.pinned = item.pinned === true;
        if (tab.pinned) tab.groupId = null;
        this.tabs.push(tab);
      } catch { /* Отсутствующий файл пропускается; остальные вкладки остаются доступными. */ }
    }
    await this.display(this.tabs.find(tab => tab.id === saved.activeId)?.id ?? this.tabs[0]?.id ?? null);
  }
}

module.exports = { DocumentWorkspace, GROUP_COLORS };

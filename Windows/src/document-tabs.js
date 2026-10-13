// Панель вкладок использует существующие цвета и иконки MarkEdit.
import { FileText, Plus, X, Pin, ChevronDown, createIcons } from 'lucide';

const COLORS = [
  ['#1769aa', 'Синий'], ['#0f766e', 'Бирюзовый'], ['#68722c', 'Зелёный'],
  ['#9f3f5f', 'Розовый'], ['#7656a8', 'Фиолетовый'], ['#bd682a', 'Оранжевый'],
];
const ICONS = { FileText, Plus, X, Pin, ChevronDown };

// Создаёт безопасную разметку без подстановки пользовательских имён в HTML.
function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// SVG создаёт Lucide; названия файлов и групп в иконку не подставляются.
function icon(name) {
  const node = document.createElement('i');
  node.dataset.lucide = name;
  node.setAttribute('width', '15');
  node.setAttribute('height', '15');
  node.setAttribute('aria-hidden', 'true');
  return node;
}

export function installDocumentTabs({ closeTextMenu }) {
  const bar = element('nav', 'document-tabs');
  bar.id = 'document-tabs';
  bar.setAttribute('aria-label', 'Документы');
  const strip = element('div', 'document-tab-strip');
  strip.setAttribute('role', 'tablist');
  strip.setAttribute('aria-label', 'Открытые документы');
  const plus = element('button', 'tab-add');
  plus.type = 'button';
  plus.setAttribute('aria-label', 'Добавить документ или группу');
  plus.setAttribute('aria-haspopup', 'menu');
  plus.append(icon('plus'));
  bar.append(strip, plus);
  document.body.append(bar);
  const menu = element('div', 'workspace-context-menu tab-context-menu');
  menu.id = 'tab-context-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  document.body.append(menu);
  const editor = element('dialog', 'tab-group-dialog');
  editor.innerHTML = `<form method="dialog"><h2>Группа вкладок</h2><label>Название<input name="name" maxlength="80" required autocomplete="off"></label><fieldset><legend>Цвет</legend><div class="tab-group-colors"></div></fieldset><div class="tab-group-dialog-actions"><button type="button" data-cancel>Отмена</button><button type="submit" class="tab-group-submit">Сохранить</button></div><p class="tab-group-error" role="alert" hidden></p></form>`;
  document.body.append(editor);
  let snapshot = { tabs: [], groups: [], activeId: null };
  let menuAnchor;
  let resize;
  let editingGroup;
  let groupTabId;
  let groupColor = COLORS[0][0];

  // Ошибки видимы пользователю, а повторный клик не создаёт неявных операций.
  async function perform(task) {
    bar.setAttribute('aria-busy', 'true');
    try { return await task(); }
    catch (error) { showMenu([{ label: error.message || 'Не удалось выполнить действие', disabled: true }], plus); }
    finally { bar.removeAttribute('aria-busy'); }
  }

  // Escape возвращает фокус к источнику меню, если вкладка ещё существует.
  function closeMenu(focus = false) {
    menu.hidden = true;
    plus.setAttribute('aria-expanded', 'false');
    if (focus && menuAnchor?.isConnected) menuAnchor.focus({ preventScroll: true });
  }

  // В меню группировки показываются и существующие группы, и создание новой.
  function grouping(tab, anchor) {
    const actions = [{ label: 'Новая группа…', run: () => editGroup(null, tab.id) }];
    for (const group of snapshot.groups) actions.push({ label: group.name, color: group.color, run: () => window.windowsHost.updateTab(tab.id, { groupId: group.id }) });
    if (tab.groupId) actions.push({ label: 'Убрать из группы', run: () => window.windowsHost.updateTab(tab.id, { groupId: null }) });
    showMenu(actions, anchor);
  }

  // Действия обращаются к выбранной вкладке, даже если активен другой документ.
  function tabMenu(tab, anchor, event) {
    showMenu([
      { label: 'Закрыть', run: () => window.windowsHost.closeTab(tab.id) },
      { label: tab.pinned ? 'Открепить' : 'Закрепить', run: () => window.windowsHost.updateTab(tab.id, { pinned: !tab.pinned }) },
      { label: 'Объединить в группу…', run: () => grouping(tab, anchor) },
      { label: tab.width <= 56 ? 'Развернуть вкладку' : 'Сжать до иконки', run: () => window.windowsHost.updateTab(tab.id, { width: tab.width <= 56 ? 180 : 40 }) },
    ], anchor, event);
  }

  // Общее меню поддерживает мышь, клавиатуру и размещение в пределах окна.
  function showMenu(actions, anchor, event) {
    closeTextMenu();
    menuAnchor = anchor;
    menu.replaceChildren();
    for (const action of actions) {
      const button = element('button', 'workspace-context-action tab-menu-action', action.label);
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.disabled = action.disabled === true;
      if (action.color) { const dot = element('span', 'tab-menu-color'); dot.style.background = action.color; button.prepend(dot); }
      button.addEventListener('click', () => { closeMenu(); void perform(action.run); });
      menu.append(button);
    }
    menu.hidden = false;
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(event?.clientX ?? rect.left, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(event?.clientY ?? rect.bottom + 5, innerHeight - menu.offsetHeight - 8))}px`;
    menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }

  // Группа редактируется в собственном диалоге с названием и фиксированной палитрой.
  function editGroup(group = null, tabId = null) {
    closeMenu();
    editingGroup = group;
    groupTabId = tabId;
    groupColor = group?.color || COLORS[0][0];
    editor.querySelector('input').value = group?.name || 'Новая группа';
    editor.querySelector('h2').textContent = group ? 'Настроить группу' : 'Новая группа';
    editor.querySelector('.tab-group-error').hidden = true;
    renderColors();
    editor.showModal();
    editor.querySelector('input').select();
  }

  // Цвет выбирается явным элементом управления, доступным также с клавиатуры.
  function renderColors() {
    const colors = editor.querySelector('.tab-group-colors');
    colors.replaceChildren();
    for (const [color, label] of COLORS) {
      const button = element('button', 'tab-group-color');
      button.type = 'button';
      button.style.setProperty('--group-color', color);
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', String(groupColor === color));
      button.addEventListener('click', () => { groupColor = color; renderColors(); });
      colors.append(button);
    }
  }

  editor.querySelector('[data-cancel]').addEventListener('click', () => editor.close());
  editor.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const name = editor.querySelector('input').value.trim();
    if (!name) return;
    const submit = editor.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      const result = editingGroup
        ? await window.windowsHost.updateTabGroup(editingGroup.id, { name, color: groupColor })
        : await window.windowsHost.createTabGroup({ name, color: groupColor, tabId: groupTabId });
      if (result === false) throw new Error('Не удалось сохранить группу');
      editor.close();
    } catch (error) {
      const message = editor.querySelector('.tab-group-error');
      message.textContent = error.message;
      message.hidden = false;
    } finally { submit.disabled = false; }
  });

  // Отдельная ручка меняет ширину; закрепление оставляет размер иконки независимо от неё.
  function startResize(event, tab, node) {
    if (event.button !== 0 || tab.pinned) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    resize = { id: tab.id, node, startX: event.clientX, startWidth: node.offsetWidth, width: node.offsetWidth };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish, { once: true });
    handle.addEventListener('pointercancel', finish, { once: true });
    function move(next) {
      if (!resize) return;
      resize.width = Math.max(40, Math.min(360, resize.startWidth + next.clientX - resize.startX));
      node.style.width = `${resize.width}px`;
      node.classList.toggle('tab-compact', resize.width <= 56);
      handle.setAttribute('aria-valuenow', String(Math.round(resize.width)));
    }
    function finish() {
      const value = resize;
      resize = null;
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      if (value) void perform(() => window.windowsHost.updateTab(value.id, { width: value.width }));
    }
  }

  // Вкладка содержит независимые переключение, закрытие и ручку изменения ширины.
  function tabNode(tab) {
    const node = element('div', 'document-tab');
    node.dataset.tabId = tab.id;
    node.classList.toggle('tab-active', tab.id === snapshot.activeId);
    node.classList.toggle('tab-compact', tab.pinned || tab.width <= 56);
    node.classList.toggle('tab-pinned', tab.pinned);
    node.style.width = `${tab.pinned ? 40 : tab.width}px`;
    const select = element('button', 'document-tab-select');
    select.type = 'button';
    select.setAttribute('role', 'tab');
    select.setAttribute('aria-selected', String(tab.id === snapshot.activeId));
    select.setAttribute('aria-controls', 'reader editor');
    select.setAttribute('aria-label', `${tab.name}${tab.dirty ? ', не сохранён' : ''}${tab.pinned ? ', закреплён' : ''}`);
    select.title = `${tab.path || tab.name}${tab.dirty ? '\nЕсть несохранённые изменения' : ''}${tab.pinned ? '\nЗакреплена' : ''}`;
    select.append(icon('file-text'), element('span', 'document-tab-label', tab.name));
    if (tab.dirty) select.append(element('span', 'document-tab-dirty'));
    if (tab.pinned) select.append(icon('pin'));
    select.addEventListener('click', () => void perform(() => window.windowsHost.activateTab(tab.id)));
    select.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation(); tabMenu(tab, select, event); });
    select.addEventListener('keydown', event => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); tabMenu(tab, select); }
      const tabs = [...strip.querySelectorAll('[role=tab]')];
      let index = tabs.indexOf(select);
      if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = tabs.length - 1;
      else return;
      event.preventDefault();
      tabs[index]?.focus();
    });
    node.append(select);
    const close = element('button', 'document-tab-close');
    close.type = 'button';
    close.setAttribute('aria-label', `Закрыть ${tab.name}`);
    close.append(icon('x'));
    close.addEventListener('click', () => void perform(() => window.windowsHost.closeTab(tab.id)));
    node.append(close);
    const handle = element('div', 'document-tab-resize');
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', `Ширина вкладки ${tab.name}`);
    handle.setAttribute('aria-valuemin', '40');
    handle.setAttribute('aria-valuemax', '360');
    handle.setAttribute('aria-valuenow', String(tab.width));
    handle.tabIndex = tab.pinned ? -1 : 0;
    handle.addEventListener('pointerdown', event => startResize(event, tab, node));
    handle.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const width = event.key === 'Home' ? 40 : event.key === 'End' ? 360 : tab.width + (event.key === 'ArrowRight' ? 20 : -20);
      void perform(() => window.windowsHost.updateTab(tab.id, { width }));
    });
    node.append(handle);
    node.addEventListener('auxclick', event => { if (event.button === 1) { event.preventDefault(); void perform(() => window.windowsHost.closeTab(tab.id)); } });
    return node;
  }

  // Закреплённые вкладки слева. Группы собраны вместе; пустая группа остаётся доступной.
  function render(value) {
    snapshot = value;
    if (resize) return;
    const scrollLeft = strip.scrollLeft;
    const focusedId = document.activeElement?.closest('[data-tab-id]')?.dataset.tabId;
    strip.replaceChildren();
    for (const tab of snapshot.tabs.filter(tab => tab.pinned)) strip.append(tabNode(tab));
    for (const tab of snapshot.tabs.filter(tab => !tab.pinned && !tab.groupId)) strip.append(tabNode(tab));
    for (const group of snapshot.groups) {
      const container = element('div', 'document-tab-group');
      container.dataset.groupId = group.id;
      container.style.setProperty('--group-color', group.color);
      const members = snapshot.tabs.filter(tab => tab.groupId === group.id);
      const toggle = element('button', 'tab-group-toggle');
      toggle.type = 'button';
      toggle.title = `${group.name}: ${members.length} · ПКМ для настройки`;
      toggle.setAttribute('aria-label', `Группа ${group.name}, вкладок: ${members.length}`);
      toggle.setAttribute('aria-expanded', String(!group.collapsed));
      toggle.append(element('span', 'tab-group-dot'), element('span', 'tab-group-name', group.name), element('span', 'tab-group-count', String(members.length)), icon('chevron-down'));
      toggle.addEventListener('click', () => void perform(() => window.windowsHost.updateTabGroup(group.id, { collapsed: !group.collapsed })));
      const actions = [
        { label: 'Название и цвет…', run: () => editGroup(group) },
        { label: 'Новый документ в группе', run: () => window.windowsHost.newTab(group.id) },
        { label: 'Открыть документ в группе…', run: () => window.windowsHost.openTab(group.id) },
        { label: 'Разгруппировать', run: () => window.windowsHost.ungroupTabs(group.id) },
      ];
      toggle.addEventListener('contextmenu', event => { event.preventDefault(); showMenu(actions, toggle, event); });
      toggle.addEventListener('keydown', event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); showMenu(actions, toggle); } });
      container.append(toggle);
      for (const tab of members) if (!group.collapsed || tab.id === snapshot.activeId) container.append(tabNode(tab));
      strip.append(container);
    }
    strip.scrollLeft = scrollLeft;
    createIcons({ icons: ICONS, root: bar });
    if (focusedId) [...strip.querySelectorAll('[data-tab-id]')].find(node => node.dataset.tabId === focusedId)?.querySelector('[role=tab]')?.focus({ preventScroll: true });
  }

  plus.addEventListener('click', () => {
    if (!menu.hidden && menuAnchor === plus) { closeMenu(); return; }
    plus.setAttribute('aria-expanded', 'true');
    showMenu([
      { label: 'Новый документ', run: () => window.windowsHost.newTab() },
      { label: 'Открыть документ…', run: () => window.windowsHost.openTab() },
      { label: 'Новая группа…', run: () => editGroup() },
    ], plus);
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); closeMenu(true); return; }
    const items = [...menu.querySelectorAll('button:not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (delta) { event.preventDefault(); items[(index + delta + items.length) % items.length]?.focus(); }
  });
  document.addEventListener('pointerdown', event => { if (!menu.contains(event.target) && !plus.contains(event.target)) closeMenu(); });
  window.addEventListener('resize', () => closeMenu());
  strip.addEventListener('scroll', () => closeMenu(), { passive: true });
  strip.addEventListener('wheel', event => {
    if (strip.scrollWidth <= strip.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    event.preventDefault();
    strip.scrollLeft += event.deltaY;
  }, { passive: false });
  document.addEventListener('keydown', event => {
    if (!event.ctrlKey || event.altKey || editor.open || event.target.closest('input,textarea')) return;
    if (event.key.toLowerCase() === 'w' && snapshot.activeId) { event.preventDefault(); void perform(() => window.windowsHost.closeTab(snapshot.activeId)); }
    if (event.key === 'Tab' && snapshot.tabs.length) {
      event.preventDefault();
      const index = snapshot.tabs.findIndex(tab => tab.id === snapshot.activeId);
      const next = snapshot.tabs[(index + (event.shiftKey ? -1 : 1) + snapshot.tabs.length) % snapshot.tabs.length];
      void perform(() => window.windowsHost.activateTab(next.id));
    }
  });
  window.windowsHost.onTabsChanged(value => {
    const switched = snapshot.activeId !== value.activeId;
    render(value);
    if (switched) strip.querySelector('.tab-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  createIcons({ icons: ICONS, root: bar });
  return { refresh: async () => render(await window.windowsHost.getTabs()), closeMenu };
}

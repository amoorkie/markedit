import { Bold, Italic, Strikethrough, Code, Heading2, List, ListOrdered, Quote, Copy, Scissors, ClipboardPaste, Trash2, Undo2, Redo2, TextSelect, createIcons } from 'lucide';

const icons = { Bold, Italic, Strikethrough, Code, Heading2, List, ListOrdered, Quote, Copy, Scissors, ClipboardPaste, Trash2, Undo2, Redo2, TextSelect };

export function installTextContextMenu({ isEditing, closeOtherMenus }) {
  const menu = document.createElement('div');
  menu.id = 'text-context-menu';
  menu.className = 'workspace-context-menu text-context-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Действия с текстом');
  menu.hidden = true;
  document.body.append(menu);
  const status = document.createElement('div');
  status.className = 'text-action-status';
  status.setAttribute('role', 'status');
  status.hidden = true;
  document.body.append(status);
  let context;
  let statusTimer;

  function close(restoreFocus = false) {
    if (menu.hidden) return;
    menu.hidden = true;
    if (restoreFocus) context?.focus();
    context = undefined;
  }

  function capture(target) {
    if (target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && ['text', 'search', 'url'].includes(target.type))) {
      const start = target.selectionStart ?? 0;
      const end = target.selectionEnd ?? start;
      const value = target.value;
      return {
        editable: !target.readOnly && !target.disabled, selected: value.slice(start, end),
        valid: () => target.isConnected && target.value === value,
        focus: () => { target.focus({ preventScroll: true }); target.setSelectionRange(start, end); },
        replace: text => { target.setRangeText(text, start, end, 'end'); target.dispatchEvent(new Event('input', { bubbles: true })); },
        selectAll: () => target.select(),
      };
    }
    const editor = window.editor;
    if (isEditing() && target.closest('#editor') && editor?.state) {
      const { doc, selection } = editor.state;
      return {
        editor, editable: !editor.state.readOnly,
        selected: selection.ranges.map(range => editor.state.sliceDoc(range.from, range.to)).join('\n'),
        valid: () => isEditing() && window.editor === editor && editor.state.doc === doc && editor.state.selection.eq(selection),
        focus: () => editor.focus(),
        replace: text => editor.dispatch(editor.state.replaceSelection(text), { userEvent: text ? 'input.paste' : 'delete.cut', scrollIntoView: true }),
        selectAll: () => editor.dispatch({ selection: { anchor: 0, head: editor.state.doc.length } }),
      };
    }
    const article = target.closest('#reader-content');
    if (!isEditing() && article && !article.classList.contains('reader-content-start')) {
      const selection = window.getSelection();
      const inside = selection?.rangeCount && article.contains(selection.anchorNode) && article.contains(selection.focusNode);
      const range = inside ? selection.getRangeAt(0).cloneRange() : undefined;
      return {
        editable: false, selected: inside ? selection.toString() : '', valid: () => !isEditing() && article.isConnected,
        focus: () => {
          document.getElementById('reader').focus({ preventScroll: true });
          if (range?.startContainer.isConnected) { selection.removeAllRanges(); selection.addRange(range); }
        },
        selectAll: () => { const all = document.createRange(); all.selectNodeContents(article); selection.removeAllRanges(); selection.addRange(all); },
      };
    }
  }

  async function run(action, snapshot) {
    close(true);
    if (!snapshot.valid()) return;
    const before = snapshot.editor?.state.doc;
    try {
      if (action === 'copy' || action === 'cut') {
        await window.windowsHost.copyText(snapshot.selected);
        if (action === 'cut' && snapshot.valid()) snapshot.replace('');
      } else if (action === 'paste') {
        const text = await window.windowsHost.readClipboardText();
        // Clipboard IPC may finish after the user edits or opens another document.
        if (text && snapshot.valid()) snapshot.replace(text);
      } else if (action === 'delete') snapshot.replace('');
      else if (action === 'selectAll') snapshot.selectAll();
      else if (action === 'undo' || action === 'redo') window.webModules.history[action]();
      else if (action === 'toggleHeading') window.webModules.format.toggleHeading({ level: 2 });
      else window.webModules.format[action]();
      if (snapshot.editor && before !== snapshot.editor.state.doc) window.windowsHost.markDocumentDirty();
    } catch (error) {
      console.error('Text action failed', error);
      status.textContent = 'Не удалось выполнить действие. Попробуйте ещё раз.';
      status.hidden = false;
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => { status.hidden = true; }, 4000);
    }
  }

  function button(action, label, icon, disabled = false, compact = false) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = compact ? 'text-format-action' : 'workspace-context-action';
    item.dataset.action = action;
    item.setAttribute('role', 'menuitem');
    item.setAttribute('aria-label', label);
    item.title = label;
    item.disabled = disabled;
    item.innerHTML = `<i data-lucide="${icon}" width="16" height="16" aria-hidden="true"></i>${compact ? '' : `<span>${label}</span>`}`;
    item.addEventListener('click', () => { if (context) void run(action, context); });
    return item;
  }

  function divider() {
    const line = document.createElement('div');
    line.className = 'text-menu-divider';
    line.setAttribute('role', 'separator');
    menu.append(line);
  }

  function show(event, target) {
    const snapshot = capture(target);
    if (!snapshot) return;
    event.preventDefault();
    event.stopPropagation();
    close();
    closeOtherMenus();
    context = snapshot;
    menu.replaceChildren();
    if (snapshot.editor && snapshot.editable) {
      const formats = document.createElement('div');
      formats.className = 'text-format-grid';
      for (const [action, label, icon] of [
        ['toggleBold', 'Жирный', 'bold'], ['toggleItalic', 'Курсив', 'italic'],
        ['toggleStrikethrough', 'Зачёркнутый', 'strikethrough'], ['toggleInlineCode', 'Код', 'code'],
        ['toggleHeading', 'Заголовок', 'heading-2'], ['toggleBullet', 'Маркированный список', 'list'],
        ['toggleNumbering', 'Нумерованный список', 'list-ordered'], ['toggleBlockquote', 'Цитата', 'quote'],
      ]) formats.append(button(action, label, icon, false, true));
      menu.append(formats);
      divider();
      menu.append(button('undo', 'Отменить', 'undo-2', !window.webModules.history.canUndo()));
      menu.append(button('redo', 'Повторить', 'redo-2', !window.webModules.history.canRedo()));
      divider();
    }
    if (snapshot.editable) menu.append(button('cut', 'Вырезать', 'scissors', !snapshot.selected));
    menu.append(button('copy', 'Копировать', 'copy', !snapshot.selected));
    if (snapshot.editable) {
      menu.append(button('paste', 'Вставить', 'clipboard-paste'));
      menu.append(button('delete', 'Удалить', 'trash-2', !snapshot.selected));
    }
    divider();
    menu.append(button('selectAll', 'Выделить всё', 'text-select'));
    createIcons({ icons, root: menu });
    menu.hidden = false;
    const rect = target.getBoundingClientRect();
    const caret = snapshot.editor?.coordsAtPos(snapshot.editor.state.selection.main.head);
    const x = event.clientX || caret?.left || rect.left;
    const y = event.clientY || caret?.bottom || rect.top;
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
    menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }

  document.addEventListener('contextmenu', event => show(event, event.target), true);
  document.addEventListener('keydown', event => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) show(event, event.target);
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    const items = [...menu.querySelectorAll('button:not(:disabled)')];
    const current = items.indexOf(document.activeElement);
    const direction = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (direction || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + direction + items.length) % items.length;
      items[next]?.focus({ preventScroll: true });
    }
  });
  document.addEventListener('pointerdown', event => { if (!menu.contains(event.target)) close(); }, true);
  document.addEventListener('scroll', event => { if (!menu.contains(event.target)) close(); }, true);
  window.addEventListener('resize', () => close());
  window.addEventListener('blur', () => close());
  return close;
}

// Проверяет настоящие main/preload, редактор, диалоги закрытия и восстановление сессии.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { app, BrowserWindow, dialog } = require('electron');
const artifacts = path.resolve(__dirname, '../tests/artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const manifest = path.join(artifacts, 'tabs-lifecycle.json');
const restoring = process.argv.includes('--restore');
const directory = restoring ? JSON.parse(fs.readFileSync(manifest, 'utf8')).directory : fs.mkdtempSync(path.join(os.tmpdir(), 'markedit-tabs-real-'));
process.env.MARKEDIT_DEV_USER_DATA = path.join(directory, 'profile');
let closeAnswer = 2;
let saveTarget;
// Подменяется только выбор пользователя в диалоге; файловые операции настоящие.
dialog.showMessageBox = async () => ({ response: closeAnswer });
dialog.showSaveDialog = async () => ({ canceled: !saveTarget, filePath: saveTarget });
dialog.showErrorBox = (_title, message) => { throw new Error(message); };
require('../main.js');
const pause = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const watchdog = setTimeout(() => { console.error('Проверка вкладок превысила допустимое время'); app.exit(1); }, 120000);
  let window;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      window = BrowserWindow.getAllWindows()[0];
      if (window && !window.webContents.isLoading() && / - MarkEdit$/.test(window.getTitle())) break;
      await pause();
    }
    const evaluate = code => window.webContents.executeJavaScript(code);
    window.once('closed', () => clearTimeout(watchdog));
    // Фоновое окно теста не должно замедлять очередь операций Chromium.
    window.webContents.setBackgroundThrottling(false);
    const invoke = (method, ...args) => evaluate('window.windowsHost.' + method + '(' + args.map(value => JSON.stringify(value)).join(',') + ')');
    const tabs = () => invoke('getTabs');
    const text = () => evaluate('window.editor.state.doc.toString()');
    await pause(250);
    console.log('Tabs test: window ready');
    if (restoring) {
      const saved = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      await invoke('activateTab', saved.snapshot.activeId);
      assert.deepEqual(await tabs(), saved.snapshot);
      assert.equal(await text(), 'Второй документ');
      assert.equal(await evaluate('document.querySelector(".tab-pinned [role=tab]").title.includes("one.md")'), true);
      console.log('Tabs restart: files, active tab, compact width, pin, group name/color/collapse restored');
      window.close();
      return;
    }
    const first = path.join(directory, 'one.md');
    const second = path.join(directory, 'two.md');
    fs.writeFileSync(first, 'Первый документ');
    fs.writeFileSync(second, 'Второй документ');
    await invoke('openWorkspaceFile', first);
    console.log('Tabs test: first file opened');
    let state = await tabs();
    const firstId = state.activeId;
    assert.equal(state.tabs[0].name, 'one.md');
    await evaluate('document.getElementById("edit-button").click();window.editor.dispatch({changes:{from:0,to:window.editor.state.doc.length,insert:"Черновик первого"},selection:{anchor:3,head:7}});window.windowsHost.markDocumentDirty()');
    await invoke('openWorkspaceFile', second);
    state = await tabs();
    const secondId = state.activeId;
    assert.equal(state.tabs.find(tab => tab.id === firstId).dirty, true);
    await invoke('openWorkspaceFile', first);
    assert.equal((await tabs()).tabs.length, 2);
    assert.equal(await text(), 'Черновик первого');
    assert.equal(await evaluate('window.editor.state.selection.main.from'), 3);
    assert.equal(await evaluate('window.webModules.history.canUndo()'), true);
    await evaluate('window.webModules.history.undo()');
    assert.equal(await text(), 'Первый документ');
    await evaluate('window.webModules.history.redo()');
    assert.equal(await text(), 'Черновик первого');
    await invoke('activateTab', secondId);
    console.log('Tabs test: drafts and history checked');
    assert.equal(await invoke('closeTab', firstId), false);
    assert.equal((await tabs()).tabs.length, 2);
    assert.equal(await text(), 'Второй документ');
    // Группа создаётся через собственный диалог приложения.
    await evaluate('document.querySelector(".tab-add").click();[...document.querySelectorAll("#tab-context-menu button")].find(b=>b.textContent==="Новая группа…").click()');
    assert.equal(await evaluate('document.querySelector(".tab-group-dialog").open'), true);
    await evaluate('document.querySelector(".tab-group-dialog input").value="Рабочие заметки";document.querySelector(".tab-group-color[aria-label=Фиолетовый]").click();document.querySelector(".tab-group-dialog form").requestSubmit()');
    await pause();
    state = await tabs();
    const groupId = state.groups[0].id;
    assert.equal(state.groups[0].color, '#7656a8');
    await invoke('updateTab', secondId, { groupId });
    await invoke('updateTab', firstId, { pinned: true });
    console.log('Tabs test: groups checked');
    assert.equal(await evaluate('document.querySelector(".document-tab-strip > .document-tab").dataset.tabId'), firstId);
    // Ресайз получает реальные события указателя через Chromium.
    const handle = await evaluate('(()=>{const r=document.querySelector(".document-tab:not(.tab-pinned) .document-tab-resize").getBoundingClientRect();return {x:Math.round(r.left+2),y:Math.round(r.top+10)};})()');
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...handle });
    window.webContents.sendInputEvent({ type: 'mouseMove', x: handle.x - 140, y: handle.y, movementX: -140, movementY: 0 });
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: handle.x - 140, y: handle.y });
    await pause();
    assert.equal((await tabs()).tabs.find(tab => tab.id === secondId).width, 40);
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".document-tab:not(.tab-pinned) .document-tab-label")).display'), 'none');
    await invoke('updateTab', secondId, { width: 180 });
    await evaluate('document.querySelector(".tab-group-toggle").click()'); await pause();
    assert.equal((await tabs()).groups[0].collapsed, true);
    assert.equal(await evaluate('document.querySelector(".tab-active")!==null'), true);
    await evaluate('document.querySelector(".tab-active [role=tab]").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:150,clientY:30}))');
    assert.deepEqual(await evaluate('[...document.querySelectorAll("#tab-context-menu button")].map(b=>b.textContent)'), ['Закрыть', 'Закрепить', 'Объединить в группу…', 'Сжать до иконки']);
    assert.equal(await evaluate('document.getElementById("text-context-menu").hidden'), true);
    await evaluate('document.querySelector("#tab-context-menu button:last-child").click()'); await pause();
    // Новый буфер после Save As получает имя созданного файла.
    await invoke('newTab');
    console.log('Tabs test: resize checked');
    assert.equal(await evaluate('document.documentElement.classList.contains("editing-mode")'), true);
    await evaluate('window.editor.dispatch({changes:{from:0,insert:"Новый текст"}});window.windowsHost.markDocumentDirty()');
    saveTarget = path.join(directory, 'saved-new.md');
    assert.equal(await invoke('saveDocument'), true);
    console.log('Tabs test: new file saved');
    assert.equal((await tabs()).tabs.at(-1).name, 'saved-new.md');
    assert.equal(fs.readFileSync(saveTarget, 'utf8'), 'Новый текст');
    await invoke('closeTab', (await tabs()).activeId);
    console.log('Tabs test: new tab closed');
    closeAnswer = 0;
    await invoke('closeTab', firstId);
    console.log('Tabs test: inactive draft saved and closed');
    assert.equal(fs.readFileSync(first, 'utf8'), 'Черновик первого');
    await invoke('openWorkspaceFile', first);
    console.log('Tabs test: first reopened');
    const reopenedId = (await tabs()).activeId;
    await invoke('updateTab', reopenedId, { pinned: true });
    await invoke('activateTab', secondId);
    // Нет верхнего предела количества; лишние пустые буферы удаляются после проверки.
    for (let index = 0; index < 55; index++) {
      await invoke('newTab');
      if (index % 10 === 0) console.log('Tabs test: extra tabs', index + 1);
    }
    console.log('Tabs test: 57 tabs opened');
    assert.equal((await tabs()).tabs.length, 57);
    assert.equal(await evaluate('document.querySelector(".document-tab-strip").scrollWidth>document.querySelector(".document-tab-strip").clientWidth'), true);
    for (const tab of (await tabs()).tabs.filter(tab => !tab.path)) await invoke('closeTab', tab.id);
    await invoke('activateTab', secondId);
    for (const [scheme, width, height] of [['light', 1040, 760], ['dark', 520, 360]]) {
      window.setContentSize(width, height);
      await evaluate('document.querySelector("[data-scheme=' + scheme + ']").click()');
      await invoke('updateTab', secondId, { width: 180 });
      await pause();
      await evaluate('document.querySelector(".tab-active [role=tab]").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:180,clientY:35}))');
      await pause();
      const bounds = await evaluate('(()=>{const r=document.getElementById("tab-context-menu").getBoundingClientRect();return {fits:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,bar:document.getElementById("document-tabs").getBoundingClientRect().bottom};})()');
      assert.equal(bounds.fits, true);
      assert.equal(bounds.bar, 44);
      fs.writeFileSync(path.join(artifacts, 'tabs-' + scheme + '.png'), (await window.webContents.capturePage()).toPNG());
      await evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    }
    await invoke('updateTab', secondId, { width: 40 });
    fs.writeFileSync(manifest, JSON.stringify({ directory, snapshot: await tabs() }));
    console.log('Tabs lifecycle: drafts/undo, duplicates, inactive cancel/save, groups, pin, native resize, new-file save and 57 tabs passed');
    window.close();
  } catch (error) {
    console.error(error.stack || error);
    window?.destroy();
    app.exit(1);
  }
});

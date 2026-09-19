const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'markedit-context-'));
const documentPath = path.join(directory, 'context-test.md');
fs.writeFileSync(documentPath, 'Alpha beta\nSecond line');
process.env.MARKEDIT_DEV_USER_DATA = path.join(directory, 'profile');
require('../main.js');
const pause = () => new Promise(resolve => setTimeout(resolve, 100));

app.whenReady().then(async () => {
  let window;
  try {
    for (let retry = 0; retry < 100; retry++) {
      window = BrowserWindow.getAllWindows()[0];
      if (window?.getTitle() === 'Untitled.md - MarkEdit' && !window.webContents.isLoading()) break;
      await pause();
    }
    assert.equal(window.getTitle(), 'Untitled.md - MarkEdit');
    const evaluate = code => window.webContents.executeJavaScript(code);
    await pause();
    await evaluate(`window.windowsHost.openWorkspaceFile(${JSON.stringify(documentPath)})`);
    await evaluate(`document.getElementById('edit-button').click();window.editor.dispatch({selection:{anchor:0,head:5}})`);
    await pause();
    const point = await evaluate(`(() => { const r=window.editor.coordsAtPos(2);return {x:Math.round(r.left),y:Math.round((r.top+r.bottom)/2)}; })()`);
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...point });
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...point });
    await pause();
    assert.equal(await evaluate(`document.getElementById('text-context-menu').hidden`), false);
    assert.equal(await evaluate('window.editor.state.selection.main.to'), 5);
    await evaluate(`document.querySelector('#text-context-menu [data-action="toggleBold"]').click()`);
    await pause();
    assert.equal(window.getTitle(), '* context-test.md - MarkEdit');
    assert.equal(await evaluate('window.windowsHost.saveDocument()'), true);
    assert.equal(fs.readFileSync(documentPath, 'utf8').replace(/\r\n/g, '\n'), '**Alpha** beta\nSecond line');
    assert.equal(window.getTitle(), 'context-test.md - MarkEdit');
    await evaluate(`window.windowsHost.openWorkspaceFile(${JSON.stringify(documentPath)})`);
    assert.equal(await evaluate('window.editor.state.doc.toString()'), '**Alpha** beta\nSecond line');
    console.log('Real main/preload: native right-click preserves selection; format marks dirty; save and reopen preserve Markdown');
    window.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    window?.destroy();
    app.exit(1);
  }
});

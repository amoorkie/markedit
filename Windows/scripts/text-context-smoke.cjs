const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function testTextContextMenu(window, clipboard) {
  const evaluate = code => window.webContents.executeJavaScript(code);
  const settle = () => new Promise(resolve => setTimeout(resolve, 80));
  const reset = async (text = 'Alpha beta\nSecond line') => {
    await evaluate(`window.webModules.core.resetEditor({ text: ${JSON.stringify(text)}, documentChanged: true }); window.webModules.config.setReadOnlyMode({enabled:false}); window.editor.dispatch({selection:{anchor:0,head:5}});`);
    await settle();
  };
  const open = async () => {
    await evaluate(`window.editor.contentDOM.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,cancelable:true,clientX:350,clientY:180}))`);
    assert.equal(await evaluate(`document.getElementById('text-context-menu').hidden`), false);
    assert.equal(await evaluate(`document.getElementById('text-context-menu').getBoundingClientRect().width > 100`), true);
  };
  const click = async action => {
    await evaluate(`document.querySelector('#text-context-menu [data-action="${action}"]').click()`);
    await settle();
  };
  const text = () => evaluate('window.editor.state.doc.toString()');
  await evaluate(`document.getElementById('workspace-close').click(); document.getElementById('edit-button').click()`);
  await reset();
  for (const [action, expected] of [
    ['toggleBold', '**Alpha** beta\nSecond line'], ['toggleItalic', '*Alpha* beta\nSecond line'],
    ['toggleStrikethrough', '~~Alpha~~ beta\nSecond line'], ['toggleInlineCode', '`Alpha` beta\nSecond line'],
    ['toggleHeading', '## Alpha beta\nSecond line'], ['toggleBullet', '- Alpha beta\nSecond line'],
    ['toggleNumbering', '1. Alpha beta\nSecond line'], ['toggleBlockquote', '> Alpha beta\nSecond line'],
  ]) {
    await reset(); await open(); await click(action);
    assert.equal(await text(), expected, action);
    await open(); await click('undo');
    assert.equal(await text(), 'Alpha beta\nSecond line', `${action} undo`);
    await open(); await click('redo');
    assert.equal(await text(), expected, `${action} redo`);
  }
  await reset(); await open(); await click('copy');
  assert.equal(clipboard.readText(), 'Alpha');
  assert.equal(await text(), 'Alpha beta\nSecond line');
  await open(); await click('cut');
  assert.equal(clipboard.readText(), 'Alpha');
  assert.equal(await text(), ' beta\nSecond line');
  await open(); await click('undo');
  assert.equal(await text(), 'Alpha beta\nSecond line');
  await reset(); clipboard.writeText('Привет\nмир'); await open(); await click('paste');
  assert.equal(await text(), 'Привет\nмир beta\nSecond line');
  await reset(); await open(); await click('delete');
  assert.equal(await text(), ' beta\nSecond line');
  await reset(); await open(); await click('selectAll');
  assert.equal(await evaluate('window.editor.state.selection.main.to'), 22);
  await reset();
  await evaluate('window.editor.dispatch({selection:{anchor:2}})');
  await open();
  assert.equal(await evaluate(`document.querySelector('#text-context-menu [data-action="copy"]').disabled`), true);
  clipboard.writeText('!'); await click('paste');
  assert.equal(await text(), 'Al!pha beta\nSecond line');
  await reset(); await open();
  await evaluate(`document.querySelector('#text-context-menu [data-action="paste"]').click();window.webModules.core.resetEditor({text:'Another document',documentChanged:true});`);
  await settle();
  assert.equal(await text(), 'Another document', 'Late clipboard result must not edit another document');
  await reset(); await open();
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))`);
  assert.equal(await evaluate('document.activeElement.dataset.action'), 'selectAll');
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  assert.equal(await evaluate(`document.getElementById('text-context-menu').hidden`), true);
  assert.equal(await evaluate('window.editor.contentDOM.contains(document.activeElement)'), true);

  const artifacts = path.join(__dirname, '../tests/artifacts');
  await fs.mkdir(artifacts, { recursive: true });
  window.show();
  await settle();
  for (const [scheme, width, height] of [['light', 1040, 760], ['dark', 520, 360]]) {
    window.setContentSize(width, height);
    await evaluate(`document.querySelector('[data-scheme="${scheme}"]').click()`);
    await settle();
    await evaluate(`window.editor.contentDOM.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:innerWidth-3,clientY:innerHeight-3}))`);
    const bounds = await evaluate(`(() => { const r=document.getElementById('text-context-menu').getBoundingClientRect(); return {fits:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight, icons:document.querySelectorAll('#text-context-menu svg').length}; })()`);
    assert.equal(bounds.fits, true);
    assert.equal(bounds.icons, 15);
    await settle();
    assert.equal(await evaluate(`document.getElementById('text-context-menu').hidden`), false);
    await fs.writeFile(path.join(artifacts, `text-menu-${scheme}.png`), (await window.webContents.capturePage()).toPNG());
    await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  }
  window.setContentSize(1040, 760);
  await evaluate(`document.documentElement.dataset.appearance='light'; document.getElementById('edit-button').click()`);
  await settle();
  await evaluate(`(() => {const node=document.querySelector('#reader-content p').firstChild;const range=document.createRange();range.setStart(node,0);range.setEnd(node,5);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);node.parentElement.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:350,clientY:180}));})()`);
  assert.equal(await evaluate(`document.querySelector('#text-context-menu [data-action="paste"]')===null`), true);
  await click('copy');
  assert.equal(clipboard.readText(), 'Alpha');
  console.log('Text context menu: formatting, history, clipboard, cursor, keyboard, reader and viewport checks passed');
};

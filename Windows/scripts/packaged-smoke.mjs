// Запускает готовое приложение и проверяет вкладки/сохранение через локальный протокол Chromium.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

const executable = process.argv[2];
if (!executable) throw new Error('Укажите путь к собранному исполняемому файлу MarkEdit');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markedit-packaged-'));
const profile = path.join(directory, 'profile');
const first = path.join(directory, 'first.md');
const second = path.join(directory, 'second.md');
await fs.writeFile(first, '# Первый документ');
await fs.writeFile(second, '# Второй документ');
const portServer = net.createServer();
await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
const port = portServer.address().port;
await new Promise(resolve => portServer.close(resolve));
const child = spawn(executable, ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port], {
  env: { ...process.env, MARKEDIT_DEV_USER_DATA: profile }, stdio: ['ignore', 'pipe', 'pipe'],
});
let errors = '';
child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-10000); });
child.on('error', error => { errors += error.message; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
let sequence = 0;
const pending = new Map();

// Каждая команда имеет ограничение по времени, чтобы зависший запуск не блокировал CI.
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Таймаут ' + method)); }, 20000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

// Ждём результат async-операции интерфейса; исключение в редакторе проваливает тест.
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

try {
  let target;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null) throw new Error('Приложение завершилось при запуске: ' + errors);
    try {
      const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      target = targets.find(value => value.type === 'page' && value.url.endsWith('/editor.html'));
      if (target) break;
    } catch { /* Сервер отладки ещё запускается. */ }
    await pause(200);
  }
  assert.ok(target, 'Собранное приложение не открыло редактор: ' + errors);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const task = pending.get(message.id);
    if (!task) return;
    clearTimeout(task.timeout); pending.delete(message.id);
    if (message.error) task.reject(new Error(JSON.stringify(message.error)));
    else task.resolve(message.result);
  });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    ready = await evaluate('Boolean(window.windowsHost && window.editor && document.querySelector(".tab-add"))');
    if (ready) break;
    await pause(100);
  }
  assert.ok(ready, 'Интерфейс не загрузился');
  await pause(300);
  const invoke = (method, ...args) => evaluate('window.windowsHost.' + method + '(' + args.map(value => JSON.stringify(value)).join(',') + ')');
  await invoke('openWorkspaceFile', first);
  const firstId = (await invoke('getTabs')).activeId;
  await invoke('openWorkspaceFile', second);
  const secondId = (await invoke('getTabs')).activeId;
  assert.equal((await invoke('getTabs')).tabs.length, 2);
  const groupId = await invoke('createTabGroup', { name: 'Проверка сборки', color: '#7656a8', tabId: secondId });
  await invoke('updateTab', firstId, { pinned: true, width: 40 });
  await invoke('activateTab', firstId);
  assert.equal(await evaluate('window.editor.state.doc.toString()'), '# Первый документ');
  await evaluate('document.getElementById("edit-button").click();window.editor.dispatch({changes:{from:0,to:window.editor.state.doc.length,insert:"# Сохранено из сборки"}});window.windowsHost.markDocumentDirty()');
  await invoke('saveDocument');
  assert.equal(await fs.readFile(first, 'utf8'), '# Сохранено из сборки');
  assert.equal(await fs.readFile(second, 'utf8'), '# Второй документ');
  assert.equal((await invoke('getTabs')).groups.find(group => group.id === groupId).name, 'Проверка сборки');
  assert.equal(await evaluate('window.windowsHost.platform'), process.platform);
  if (process.platform === 'darwin') assert.equal((await invoke('getWorkspace')).root, directory);
  const screenshot = await command('Page.captureScreenshot');
  await fs.mkdir('tests/artifacts', { recursive: true });
  await fs.writeFile('tests/artifacts/packaged-' + process.platform + '-' + process.arch + '.png', Buffer.from(screenshot.data, 'base64'));
  console.log('Packaged smoke PASS: launch, two tabs, group, pin, switch, correct file saved; ' + process.platform + '/' + process.arch);
} catch (error) {
  console.error(errors);
  throw error;
} finally {
  for (const task of pending.values()) clearTimeout(task.timeout);
  socket?.close();
  if (child.exitCode === null) child.kill();
  await new Promise(resolve => { if (child.exitCode !== null) resolve(); else { child.once('exit', resolve); setTimeout(resolve, 5000); } });
  await fs.rm(directory, { recursive: true, force: true });
}

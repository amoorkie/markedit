const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('windowsHost', {
  copyText: text => ipcRenderer.invoke('clipboard:write', text),
  readClipboardText: () => ipcRenderer.invoke('clipboard:read'),
  markDocumentDirty: () => ipcRenderer.send('editor:dirty', document.documentElement.dataset.documentId),
  // Каждая операция адресуется конкретной вкладке; интерфейс получает только метаданные.
  getTabs: () => ipcRenderer.invoke('tabs:snapshot'),
  activateTab: id => ipcRenderer.invoke('tabs:activate', id),
  closeTab: id => ipcRenderer.invoke('tabs:close', id),
  newTab: groupId => ipcRenderer.invoke('tabs:new', groupId),
  openTab: groupId => ipcRenderer.invoke('tabs:open', groupId),
  updateTab: (id, patch) => ipcRenderer.invoke('tabs:update', id, patch),
  createTabGroup: options => ipcRenderer.invoke('tabs:group-create', options),
  updateTabGroup: (id, patch) => ipcRenderer.invoke('tabs:group-update', id, patch),
  ungroupTabs: id => ipcRenderer.invoke('tabs:ungroup', id),
  onTabsChanged: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('tabs:changed', listener);
    return () => ipcRenderer.removeListener('tabs:changed', listener);
  },
  saveDocument: () => ipcRenderer.invoke('document:save'),
  getCurrentFilePath: () => ipcRenderer.invoke('document:path'),
  getWorkspace: () => ipcRenderer.invoke('workspace:snapshot'),
  revealActiveFile: () => ipcRenderer.invoke('workspace:reveal-active'),
  selectWorkspaceRoot: () => ipcRenderer.invoke('workspace:select-root'),
  selectWorkspaceDrive: drive => ipcRenderer.invoke('workspace:select-drive', drive),
  createWorkspaceFolder: name => ipcRenderer.invoke('workspace:create-folder', name),
  deleteWorkspaceEntry: target => ipcRenderer.invoke('workspace:delete-entry', target),
  moveWorkspaceEntry: (source, destination) => ipcRenderer.invoke('workspace:move-entry', source, destination),
  startFileDrag: filePath => ipcRenderer.send('workspace:start-file-drag', filePath),
  onFileDragEnded: callback => {
    const listener = () => callback();
    ipcRenderer.on('workspace:file-drag-ended', listener);
    return () => ipcRenderer.removeListener('workspace:file-drag-ended', listener);
  },
  chooseMoveDestination: source => ipcRenderer.invoke('workspace:choose-move-destination', source),
  removeRecentFile: filePath => ipcRenderer.invoke('workspace:remove-recent', filePath),
  getWorkspaceChildren: directory => ipcRenderer.invoke('workspace:children', directory),
  createWorkspaceFile: () => ipcRenderer.invoke('workspace:create-file'),
  openWorkspaceFile: filePath => ipcRenderer.invoke('workspace:open', filePath),
});

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('input', event => {
    const editor = document.getElementById('editor');
    if (event.target instanceof Node && editor?.contains(event.target)) {
      ipcRenderer.send('editor:dirty', document.documentElement.dataset.documentId);
    }
  }, true);
});

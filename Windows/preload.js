const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('windowsHost', {
  copyText: text => ipcRenderer.invoke('clipboard:write', text),
  saveDocument: () => ipcRenderer.invoke('document:save'),
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
      ipcRenderer.send('editor:dirty');
    }
  }, true);
});

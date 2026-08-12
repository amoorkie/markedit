const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('windowsHost', {
  copyText: text => ipcRenderer.invoke('clipboard:write', text),
  saveDocument: () => ipcRenderer.invoke('document:save'),
  getWorkspace: () => ipcRenderer.invoke('workspace:snapshot'),
  selectWorkspaceRoot: () => ipcRenderer.invoke('workspace:select-root'),
  selectWorkspaceDrive: drive => ipcRenderer.invoke('workspace:select-drive', drive),
  createWorkspaceFolder: name => ipcRenderer.invoke('workspace:create-folder', name),
  deleteWorkspaceEntry: target => ipcRenderer.invoke('workspace:delete-entry', target),
  moveWorkspaceEntry: (source, destination) => ipcRenderer.invoke('workspace:move-entry', source, destination),
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

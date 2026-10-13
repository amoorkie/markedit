const path = require('node:path');

// Windows сравнивает пути без регистра; macOS может хранить разные Case.md и case.md.
function fileKey(value, platform = process.platform) {
  if (typeof value !== 'string') return '';
  return platform === 'win32' ? path.win32.normalize(value).toLowerCase() : path.posix.normalize(value);
}

// На Windows проводник показывает диск, на Mac — папку документа, а не всю систему.
function workspaceRootForDirectory(directory, platform = process.platform) {
  return platform === 'win32' ? path.win32.parse(path.win32.resolve(directory)).root : path.posix.resolve(directory);
}

module.exports = { fileKey, workspaceRootForDirectory };

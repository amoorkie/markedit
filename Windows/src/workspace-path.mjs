// Формат пути приходит от хоста: Windows нечувствителен к регистру, POSIX сохраняет его.
export function workspacePathKey(value) {
  if (typeof value !== 'string') return '';
  if (/^[a-z]:[\\/]|^\\\\/i.test(value)) return value.replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase();
  return value.replace(/\/+$/, '') || (value.startsWith('/') ? '/' : '');
}

// Раскрываем только родителей активного файла внутри выбранной папки.
export function ancestorPaths(root, filePath) {
  const rootKey = workspacePathKey(root);
  const fileKey = workspacePathKey(filePath);
  const separator = /^[a-z]:/i.test(rootKey) || rootKey.startsWith('\\\\') ? '\\' : '/';
  const prefix = rootKey.endsWith(separator) ? rootKey : rootKey + separator;
  if (!fileKey.startsWith(prefix)) return [];
  const result = [];
  let directory = fileKey.slice(0, fileKey.lastIndexOf(separator));
  while (directory && directory !== rootKey && directory.startsWith(prefix)) {
    result.push(directory);
    directory = directory.slice(0, directory.lastIndexOf(separator));
  }
  return result;
}

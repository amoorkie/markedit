import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const windowsDirectory = path.resolve(scriptDirectory, '..');
const coreEditorDirectory = path.resolve(windowsDirectory, '..', 'CoreEditor');

await build({
  entryPoints: [path.join(windowsDirectory, 'src', 'reader.js')],
  bundle: true,
  format: 'iife',
  outfile: path.join(windowsDirectory, 'reader.js'),
  platform: 'browser',
  target: 'chrome140',
  minify: true,
});
await fs.copyFile(
  path.join(windowsDirectory, 'src', 'reader.css'),
  path.join(windowsDirectory, 'reader.css'),
);

const config = {
  host: 'mainApp',
  text: '',
  theme: 'github-light',
  fontFace: { family: 'Cascadia Mono' },
  fontSize: 16,
  showLineNumbers: true,
  showActiveLineIndicator: true,
  invisiblesBehavior: 'never',
  readOnlyMode: false,
  typewriterMode: false,
  focusMode: false,
  lineWrapping: true,
  lineHeight: 1.55,
  suggestWhileTyping: false,
  autoCharacterPairs: true,
  indentBehavior: 'paragraph',
  defaultLineBreak: '\r\n',
  indentUnit: '  ',
  standardDirectories: {},
  localizable: {
    controlCharacter: 'Control character',
    foldedLines: 'Folded lines',
    unfoldedLines: 'Unfolded lines',
    foldedCode: 'Folded code',
    unfold: 'Unfold',
    foldLine: 'Fold line',
    unfoldLine: 'Unfold line',
    previewButtonTitle: 'Preview',
    cmdClickToFollow: 'Ctrl-click to follow',
    cmdClickToToggleTodo: 'Ctrl-click to toggle task',
  },
};

const source = path.join(coreEditorDirectory, 'dist', 'index.html');
let html = await fs.readFile(source, 'utf8');
html = html
  .replace('"{{EDITOR_CONFIG}}"', JSON.stringify(config))
  .replace('"{{USER_SETTINGS}}"', '{}')
  .replace(
    '<meta charset="UTF-8">',
    '<meta charset="UTF-8">\n  <meta http-equiv="Content-Security-Policy" content="default-src \'self\' data:; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: https:; font-src \'self\' data:; connect-src \'none\'">',
  )
  .replace('<title>MarkEdit</title>', '<title>MarkEdit for Windows</title>')
  .replace('</head>', '  <link rel="stylesheet" href="./reader.css">\n</head>')
  .replace('</body>', '  <script src="./reader.js"></script>\n</body>');

if (html.includes('{{EDITOR_CONFIG}}') || html.includes('{{USER_SETTINGS}}')) {
  throw new Error('CoreEditor placeholders were not replaced');
}

await fs.writeFile(path.join(windowsDirectory, 'editor.html'), html, 'utf8');

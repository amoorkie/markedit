# MarkEdit

Приложение для чтения и редактирования Markdown на Windows и macOS. Сборка основана на открытом [MarkEdit](https://github.com/MarkEdit-app/MarkEdit) и использует наш общий интерфейс на Electron с редактором CodeMirror.

## Скачать

Версия: **1.33.1-desktop.23**. [Все файлы выпуска](https://github.com/amoorkie/markedit/releases/tag/v1.33.1-desktop.23).

| Система | Установщик |
| --- | --- |
| Windows x64 | [EXE](https://github.com/amoorkie/markedit/releases/download/v1.33.1-desktop.23/MarkEdit-Windows-1.33.1-desktop.23-Setup.exe) |
| Mac с Apple Silicon — M1 и новее | [DMG](https://github.com/amoorkie/markedit/releases/download/v1.33.1-desktop.23/MarkEdit-macOS-1.33.1-desktop.23-arm64.dmg) |
| Mac с Intel | [DMG](https://github.com/amoorkie/markedit/releases/download/v1.33.1-desktop.23/MarkEdit-macOS-1.33.1-desktop.23-x64.dmg) |

ZIP для Mac и контрольные суммы SHA-256 также находятся в выпуске. Windows-установщик не имеет цифровой подписи издателя. Mac-сборки имеют ad-hoc подпись для проверки целостности, но не подпись Developer ID и не нотарификацию Apple; macOS может ограничить первый запуск загруженного приложения.

## Возможности

- Открытие документов из сайдбара в отдельные вкладки без заданного ограничения количества.
- Переключение между документами с сохранением черновика, выделения и истории отмены.
- Группы вкладок с названием и цветом, сворачивание групп.
- Закрепление вкладок и изменение ширины вплоть до одной иконки.
- Кнопка `+` для нового документа, открытия файла или создания группы.
- Собственное меню вкладки по ПКМ: закрыть, закрепить, добавить в группу.
- Восстановление сохранённых файлов, групп и оформления вкладок после перезапуска. Несохранённые черновики защищены диалогом при закрытии; после аварийного завершения они не восстанавливаются.
- Режим чтения по умолчанию и переключение в редактор кнопкой с карандашом.
- Собственное меню выделенного текста: копирование, вырезание, вставка, выделение всего и простое Markdown-форматирование.
- Оглавление и копирование смыслового блока по заголовку.
- Светлая и тёмная темы, настройки шрифта, ширины текста и оформления.
- Файловый сайдбар, недавние документы, хлебные крошки и раскрытие папок до текущего файла.
- Создание файлов и папок, перенос и удаление в системную корзину с подтверждением.
- Открытие Markdown-файлов через Проводник Windows или Finder на Mac.

## Установка

**Windows:** запустите EXE, выберите папку и завершите установку. При необходимости назначьте MarkEdit приложением по умолчанию для `.md` в параметрах Windows.

**macOS:** выберите сборку для своего процессора, откройте DMG и перенесите MarkEdit в Applications. Наш интерфейс использует Cmd+O, Cmd+S, Cmd+N и Cmd+W. Control+Tab переключает вкладки на обеих системах. Сборки предназначены для macOS 12 и новее.

## Сборка и проверка

Нужен Node.js 22. Сначала соберите общий редактор:

```sh
cd CoreEditor
node .yarn/releases/yarn-4.17.1.cjs install --immutable
node .yarn/releases/yarn-4.17.1.cjs build
node .yarn/releases/yarn-4.17.1.cjs test
cd ../Windows
npm ci
npm run test:windows
npm run prepare-editor
npm run test:electron
npm run test:context-lifecycle
npm run test:tabs
```

Windows x64: `npm run dist -- --publish never`; установщик появляется в `Windows/dist`.

На Mac: `npm run dist:mac -- --arm64 --publish never` или `npm run dist:mac -- --x64 --publish never`; DMG и ZIP появляются в `Windows/dist-mac`. Для каждой архитектуры в GitHub Actions предусмотрены собственный Mac-runner и проверка запуска собранного приложения. Workflow **Desktop installers** запускается вручную и сохраняет проверенные установщики как артефакты; публикация выпуска выполняется отдельно.

## Структура и лицензия

- `Windows/` — общий Electron-хост для Windows и macOS; имя папки сохранено для совместимости.
- `CoreEditor/` — общий Markdown-редактор на базе CodeMirror.
- `MarkEditMac/`, `MarkEditCore/`, `MarkEditKit/` — исходная нативная macOS-версия upstream, отдельная от наших установщиков.
- `.github/workflows/desktop-installers.yml` — сборка и проверка наших Mac-установщиков.

Это неофициальная модификация [MarkEdit-app/MarkEdit](https://github.com/MarkEdit-app/MarkEdit). Исходный проект и эта сборка распространяются по лицензии MIT.

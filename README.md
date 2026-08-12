# MarkEdit for Windows

Минималистичное приложение для чтения и редактирования Markdown-файлов в Windows. Эта сборка основана на открытом проекте [MarkEdit](https://github.com/MarkEdit-app/MarkEdit) и добавляет отдельную Windows-версию на Electron.

## Скачать

[Скачать MarkEdit для Windows (x64)](https://github.com/amoorkie/markedit/releases/latest/download/MarkEdit-Windows-1.33.1-win.8-Setup.exe)

Текущая версия: `1.33.1-win.8`.

Установщик пока не подписан цифровой подписью. Если Windows SmartScreen покажет предупреждение, выберите **Подробнее**, затем **Выполнить в любом случае**.

## Возможности

- режим чтения включается по умолчанию и не позволяет случайно изменить документ;
- переключение в режим редактирования кнопкой с карандашом;
- сохранение и возврат к чтению кнопкой с галочкой;
- копирование смыслового блока Markdown по заголовку `#`, `##`, `###` и ниже;
- настройка темы, шрифта, ширины текста и оформления;
- компактный файловый сайдбар только с одной выбранной рабочей папкой;
- выбор рабочей папки через системный проводник Windows с доступом ко всем дискам;
- запоминание выбранной папки между запусками и ленивое раскрытие вложенных папок;
- создание нового Markdown-файла кнопкой `+` в файловом сайдбаре;
- создание папок прямо в сайдбаре;
- удаление файлов и папок в корзину Windows с подтверждением;
- быстрый доступ к созданию файла отдельной кнопкой `+` справа;
- регистрация MarkEdit как приложения для `.md`, `.markdown`, `.mdown` и `.mkd`.

## Установка

1. Скачайте установщик по ссылке выше.
2. Запустите `MarkEdit-Windows-1.33.1-win.8-Setup.exe`.
3. Выберите папку установки и завершите установку.
4. При необходимости назначьте MarkEdit приложением по умолчанию для `.md` в параметрах Windows.

## Сборка из исходников

Нужны Node.js 20 или новее и npm.

```powershell
git clone https://github.com/amoorkie/markedit.git
cd markedit
corepack yarn --cwd CoreEditor install --immutable
corepack yarn --cwd CoreEditor build
cd Windows
npm ci
npm run test:windows
npm run dist
```

Готовый установщик появится в `Windows/dist`.

Для запуска в режиме разработки:

```powershell
cd Windows
npm ci
npm start
```

## Структура проекта

- `Windows/` - Windows-приложение, интерфейс чтения, проводник и настройки;
- `CoreEditor/` - Markdown-редактор на базе CodeMirror;
- `MarkEditMac/`, `MarkEditCore/`, `MarkEditKit/` - исходный код macOS-версии;
- `LICENSE` - лицензия MIT.

## Проверка сборки

Windows-часть содержит модульные тесты модели Markdown-секций и smoke-тест Electron:

```powershell
cd Windows
npm run test:windows
npm run test:electron
```

## Происхождение и лицензия

Проект основан на [MarkEdit-app/MarkEdit](https://github.com/MarkEdit-app/MarkEdit). Исходный проект и эта модификация распространяются по лицензии MIT. MarkEdit for Windows является неофициальной Windows-сборкой.

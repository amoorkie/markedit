# MarkEdit desktop host

Эта папка содержит общий интерфейс Electron для Windows и macOS: чтение, редактор, контекстные меню, вкладки, группы, проводник и настройки. Имя папки и имя npm-пакета сохранены, чтобы обновления Windows продолжали использовать существующий профиль пользователя.

Инструкции по сборке и ссылки на установщики находятся в [основном README](../README.md).

- `npm run dist -- --publish never` — Windows x64, NSIS, папка `dist`.
- `npm run dist:mac -- --arm64 --publish never` — Mac Apple Silicon, DMG/ZIP, папка `dist-mac`.
- `npm run dist:mac -- --x64 --publish never` — Mac Intel, DMG/ZIP, папка `dist-mac`.
- `npm run test:packaged -- <путь-к-exe-или-MacOS/MarkEdit>` — запуск собранного приложения с временным профилем, проверка вкладок, групп и сохранения.

Mac-сборки создаются на macOS и подписываются ad-hoc через `@electron/osx-sign`. Эта подпись не заменяет Developer ID и нотарификацию Apple. Исходная нативная версия в `MarkEditMac/` собирается отдельно существующим workflow.

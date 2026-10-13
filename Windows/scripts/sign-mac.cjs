const { signAsync } = require('@electron/osx-sign');

// Подписываем содержимое ad-hoc для запуска на Apple Silicon без сертификата разработчика.
// Это проверка целостности приложения, а не подпись Developer ID и не нотарификация Apple.
module.exports = async function signMac(options) {
  await signAsync({ ...options, identity: '-', identityValidation: false, hardenedRuntime: false, preAutoEntitlements: false });
};

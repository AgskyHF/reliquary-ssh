/**
 * The UI dictionaries.
 *
 * Every user-visible string of the renderer lives here. The keys are
 * grouped by the panel they belong to, so a missing translation is easy
 * to spot.
 *
 * English is the source language: a key that is missing in `ru` falls back
 * to the English text, so a partial translation never breaks the UI.
 */

export const LANGUAGES = ['en', 'ru'] as const

export type Language = (typeof LANGUAGES)[number]

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  ru: 'Русский'
}

const en = {
  // ---- app shell ----
  'app.title': 'ReliquarySSH',
  'app.subtitle': 'terminal client',
  'app.connect': 'Connect',
  'app.signOut': 'Sign out',
  'app.offline': 'Offline',

  // ---- sidebar ----
  'search.hosts': 'Search hosts…',
  'hosts.title': 'Hosts',

  'nav.hosts': 'Hosts',
  'nav.keychain': 'Keychain',
  'nav.export': 'Export',
  'nav.settings': 'Settings',

  // ---- tabs ----
  'tab.close': 'Close tab',
  'tab.closeNamed': 'Close {name}',
  'tab.new': 'New tab',
  'tab.newConnection': 'New connection',

  // ---- host list ----
  'hosts.empty': 'No hosts yet',
  'hosts.noMatch': 'Nothing found',
  'hosts.connect': 'Connect',
  'hosts.edit': 'Edit',
  'hosts.delete': 'Delete',
  'hosts.notes': 'Notes',
  'hosts.duplicate': 'Duplicate',
  'hosts.connectSsh': 'with SSH',
  'hosts.connectSftp': 'with SFTP',
  'hosts.connectHint': 'Double click to connect, right click for the menu',
  'hosts.duplicated': 'The copy of the host is in the list',

  // ---- host form ----
  'hostform.newTitle': 'New connection',
  'hostform.editTitle': 'Edit the connection',
  'hostform.name': 'Name',
  'hostform.protocol': 'Protocol',
  'hostform.address': 'Address',
  'hostform.port': 'Port',
  'hostform.user': 'User',
  'hostform.authentication': 'Authentication',
  'hostform.authPassword': 'Password',
  'hostform.authKey': 'Key from the keychain',
  'hostform.key': 'Key',
  'hostform.pickKey': 'Pick a key…',
  'hostform.passwordKeep': 'Password (leave empty to keep it)',
  'hostform.passwordOptional': 'Password (optional)',
  'hostform.passwordHint':
    'The password is encrypted with the master password and never leaves this device.',
  'hostform.notes': 'Notes',
  'hostform.errPasswordNotSaved': 'The password of the host was not saved.',
  'hostform.cancel': 'Cancel',
  'hostform.saving': 'Saving…',
  'hostform.save': 'Save',
  'hostform.add': 'Add the connection',
  'hostform.errRequired': 'The name, the address and the user are required',
  'hostform.errNoKey': 'Pick a key from the keychain',

  // ---- connect form ----
  'connect.title': 'New connection',
  'connect.protocol': 'Protocol',
  'connect.authentication': 'Authentication',
  'connect.methodPassword': 'Password',
  'connect.methodKey': 'Key',
  'connect.host': 'Host',
  'connect.name': 'Name',
  'connect.namePlaceholder': 'user@host',
  'connect.notes': 'Note',
  'connect.port': 'Port',
  'connect.username': 'Username',
  'connect.key': 'Key',
  'connect.noKeys': 'No keys in the Keychain',
  'connect.selectKey': 'Select a key…',
  'connect.password': 'Password',
  'connect.show': 'Show',
  'connect.hide': 'Hide',
  'connect.cancel': 'Cancel',
  'connect.connecting': 'Connecting…',
  'connect.stepLookup': 'Looking up the host',
  'connect.stepHandshake': 'Handshake',
  'connect.stepAuth': 'Authentication',
  'connect.connect': 'Connect',
  'connect.add': 'Add',
  'connect.hostPlaceholder': 'example.com or 10.0.0.5',
  'connect.addedToList': '"{name}" is in the list of the hosts',

  // ---- session tab ----
  'session.disconnect': 'Disconnect',
  'session.notConnected': 'Session is not connected — reconnect to continue.',
  'session.clearScreen': 'Clear screen',
  'session.errHostGone': 'The host is not in the list anymore',
  'session.connecting': 'the host',
  'session.errPasswordNotSaved':
    'The password of the host was not stored — it will be asked again.',
  'session.restoredNote': '— restored from previous session; reconnect to continue —',

  // ---- file manager ----
  'files.up': '↑ Up',
  'files.upload': '↑ Upload',
  'files.loading': 'Loading…',
  'files.downloading': 'Downloading {name}…',
  'files.uploading': 'Uploading {name}…',
  'files.colName': 'Name',
  'files.colSize': 'Size',
  'files.colMode': 'Mode',
  'files.colModified': 'Modified',
  'files.empty': 'Directory is empty',
  'files.open': 'Open',
  'files.download': 'Download',

  // ---- keychain ----
  'key.new': 'New key',
  'key.import': 'Import',
  'key.name': 'Name',
  'key.type': 'Type',
  'key.comment': 'Comment',
  'key.passphrase': 'Passphrase',
  'key.privateKey': 'Private key',
  'key.optional': 'optional',
  'key.encryptedPassphrase': 'if the key is encrypted',
  'key.cancel': 'Cancel',
  'key.creating': 'Creating…',
  'key.create': 'Create',
  'key.importing': 'Importing…',
  'key.empty': 'No keys yet',
  'key.created': 'Key "{name}" created',
  'key.imported': 'Key "{name}" imported',
  'key.copied': 'Public key of "{name}" copied to the clipboard',
  'key.commentLabel': 'Comment: {comment}',
  'key.protected': 'Protected by a passphrase',
  'key.copyPublic': 'Copy public key',
  'key.delete': 'Delete',

    'key.legacyNeedsMaster':
    'This key was saved by an older build and needs the master password.',

  // ---- themes ----
  'theme.title': 'Themes',
  'theme.change': 'Change the theme',
  'theme.current': 'Current theme',
  'theme.close': 'Close the panel',

  // ---- settings ----
  'settings.title': 'Settings',
  'settings.signedInAs': 'Signed in as {email}',
  'settings.logLevel': 'Log level',
  'settings.logFile': 'Log file: {path}',
  'settings.language': 'Language',
  'settings.saved': 'Saved',
  'settings.save': 'Save settings',
  'settings.saving': 'Saving…',

  // ---- login ----
  'login.signInTitle': 'Sign in to ReliquarySSH',
  'login.registerTitle': 'Create an account',
  'login.google': 'Continue with Google',
  'login.or': 'or',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.passwordHint': 'at least 8 characters',
  'login.createAccount': 'Create an account',
  'login.haveAccount': 'I have an account',
  'login.wait': 'Please wait…',
  'login.signIn': 'Sign in',
  'login.create': 'Create account',

  // ---- transfer ----
  'transfer.title': 'Export and import',
  'transfer.withPasswords': 'With the passwords',
  'transfer.withPasswordsHint':
    'Without them the file carries only the connections and the public keys. With them the passwords of the hosts go along — the file is readable by anyone who opens it, so keep it safe.',
  'transfer.includeKeys': 'Include the SSH keys',
  'transfer.includeOld': 'Include the replaced versions',
  'transfer.working': 'Working…',
  'transfer.export': 'Export…',
  'transfer.import': 'Import…',
  'transfer.exported': 'Exported to {path}',
  'transfer.exportedWith': 'Exported to {path} — {count} passwords inside',
  'transfer.errUnreadable':
    '{count} passwords are sealed with a key this device does not have, so the file came out without them',
  'transfer.result':
    'Added {added}, updated {updated}, unchanged {unchanged}, moved to old {superseded}, keys {keys}, with a password {passwords}',
  'transfer.oldTitle': 'Replaced versions ({count})',
  'transfer.oldEmpty': 'Nothing yet',
  'transfer.oldVersionTag': 'Replaced',
  'transfer.currentVersionTag': 'Current',
  'transfer.currentGone': 'No current version',
  'transfer.forgetAll': 'Forget all',
  'transfer.forgetAllDone': 'Forgot {count} versions',
  'transfer.withPasswordTag': ' · with a password',
  'transfer.restore': 'Restore',
  'transfer.forget': 'Forget',
} as const

export type TranslationKey = keyof typeof en

const ru: Record<TranslationKey, string> = {
  'app.title': 'ReliquarySSH',
  'app.subtitle': 'терминальный клиент',
  'app.connect': 'Подключиться',
  'app.signOut': 'Выйти',
  'app.offline': 'Не в сети',

  'search.hosts': 'Поиск хостов…',
  'hosts.title': 'Хосты',

  'nav.hosts': 'Хосты',
  'nav.keychain': 'Ключи',
  'nav.export': 'Экспорт',
  'nav.settings': 'Настройки',

  'tab.close': 'Закрыть вкладку',
  'tab.closeNamed': 'Закрыть {name}',
  'tab.new': 'Новая вкладка',
  'tab.newConnection': 'Новое подключение',

  'hosts.empty': 'Хостов пока нет',
  'hosts.noMatch': 'Ничего не найдено',
  'hosts.connect': 'Подключиться',
  'hosts.edit': 'Изменить',
  'hosts.delete': 'Удалить',
  'hosts.notes': 'Заметки',
  'hosts.duplicate': 'Дублировать',
  'hosts.connectSsh': 'по SSH',
  'hosts.connectSftp': 'по SFTP',
  'hosts.connectHint': 'Двойной клик — подключиться, ПКМ — меню',
  'hosts.duplicated': 'Копия хоста в списке',

  'hostform.newTitle': 'Новое подключение',
  'hostform.editTitle': 'Изменение подключения',
  'hostform.name': 'Имя',
  'hostform.protocol': 'Протокол',
  'hostform.address': 'Адрес',
  'hostform.port': 'Порт',
  'hostform.user': 'Пользователь',
  'hostform.authentication': 'Аутентификация',
  'hostform.authPassword': 'Пароль',
  'hostform.authKey': 'Ключ из хранилища',
  'hostform.key': 'Ключ',
  'hostform.pickKey': 'Выберите ключ…',
  'hostform.passwordKeep': 'Пароль (оставьте пустым, чтобы сохранить прежний)',
  'hostform.passwordOptional': 'Пароль (необязательно)',
  'hostform.passwordHint':
    'Пароль шифруется мастер-паролем и никогда не покидает это устройство.',
  'hostform.notes': 'Заметки',
  'hostform.errPasswordNotSaved': 'Пароль хоста не был сохранён.',
  'hostform.cancel': 'Отмена',
  'hostform.saving': 'Сохранение…',
  'hostform.save': 'Сохранить',
  'hostform.add': 'Добавить подключение',
  'hostform.errRequired': 'Имя, адрес и пользователь обязательны',
  'hostform.errNoKey': 'Выберите ключ из хранилища',

  'connect.title': 'Новое подключение',
  'connect.protocol': 'Протокол',
  'connect.authentication': 'Аутентификация',
  'connect.methodPassword': 'Пароль',
  'connect.methodKey': 'Ключ',
  'connect.host': 'Хост',
  'connect.name': 'Имя',
  'connect.namePlaceholder': 'user@host',
  'connect.notes': 'Заметка',
  'connect.port': 'Порт',
  'connect.username': 'Пользователь',
  'connect.key': 'Ключ',
  'connect.noKeys': 'В хранилище нет ключей',
  'connect.selectKey': 'Выберите ключ…',
  'connect.password': 'Пароль',
  'connect.show': 'Показать',
  'connect.hide': 'Скрыть',
  'connect.cancel': 'Отмена',
  'connect.connecting': 'Подключение…',
  'connect.stepLookup': 'Ищем хост',
  'connect.stepHandshake': 'Рукопожатие',
  'connect.stepAuth': 'Аутентификация',
  'connect.connect': 'Подключиться',
  'connect.add': 'Добавить',
  'connect.hostPlaceholder': 'example.com или 10.0.0.5',
  'connect.addedToList': '«{name}» в списке хостов',

  'session.disconnect': 'Отключиться',
  'session.notConnected': 'Сессия не подключена — подключитесь снова, чтобы продолжить.',
  'session.clearScreen': 'Очистить экран',
  'session.errHostGone': 'Хоста больше нет в списке',
  'session.connecting': 'хост',
  'session.errPasswordNotSaved':
    'Пароль хоста не сохранился — его спросят снова.',
  'session.restoredNote': '— восстановлено из прошлой сессии; подключитесь снова —',

  'files.up': '↑ Вверх',
  'files.upload': '↑ Загрузить',
  'files.loading': 'Загрузка…',
  'files.downloading': 'Скачивание {name}…',
  'files.uploading': 'Отправка {name}…',
  'files.colName': 'Имя',
  'files.colSize': 'Размер',
  'files.colMode': 'Режим',
  'files.colModified': 'Изменён',
  'files.empty': 'Каталог пуст',
  'files.open': 'Открыть',
  'files.download': 'Скачать',

  'key.new': 'Новый ключ',
  'key.import': 'Импорт',
  'key.name': 'Имя',
  'key.type': 'Тип',
  'key.comment': 'Комментарий',
  'key.passphrase': 'Пароль ключа',
  'key.privateKey': 'Приватный ключ',
  'key.optional': 'необязательно',
  'key.encryptedPassphrase': 'если ключ зашифрован',
  'key.cancel': 'Отмена',
  'key.creating': 'Создание…',
  'key.create': 'Создать',
  'key.importing': 'Импорт…',
  'key.empty': 'Ключей пока нет',
  'key.created': 'Ключ «{name}» создан',
  'key.imported': 'Ключ «{name}» импортирован',
  'key.copied': 'Открытый ключ «{name}» скопирован в буфер обмена',
  'key.commentLabel': 'Комментарий: {comment}',
  'key.protected': 'Защищён паролем',
  'key.copyPublic': 'Скопировать открытый ключ',
  'key.delete': 'Удалить',

  'key.legacyNeedsMaster':
    'Этот ключ сохранён старой сборкой — для него нужен мастер-пароль.',

  'theme.title': 'Темы',
  'theme.change': 'Сменить тему',
  'theme.current': 'Текущая тема',
  'theme.close': 'Закрыть панель',

  'settings.title': 'Настройки',
  'settings.signedInAs': 'Вы вошли как {email}',
  'settings.logLevel': 'Уровень журнала',
  'settings.logFile': 'Файл журнала: {path}',
  'settings.language': 'Язык',
  'settings.saved': 'Сохранено',
  'settings.save': 'Сохранить настройки',
  'settings.saving': 'Сохранение…',

  'login.signInTitle': 'Вход в ReliquarySSH',
  'login.registerTitle': 'Создание аккаунта',
  'login.google': 'Войти через Google',
  'login.or': 'или',
  'login.email': 'Электронная почта',
  'login.password': 'Пароль',
  'login.passwordHint': 'не менее 8 символов',
  'login.createAccount': 'Создать аккаунт',
  'login.haveAccount': 'У меня есть аккаунт',
  'login.wait': 'Подождите…',
  'login.signIn': 'Войти',
  'login.create': 'Создать аккаунт',

  'transfer.title': 'Экспорт и импорт',
  'transfer.withPasswords': 'С паролями',
  'transfer.withPasswordsHint':
    'Без паролей файл содержит только подключения и открытые ключи. С паролями в него попадают пароли хостов — файл открывается кем угодно, храните его в надёжном месте.',
  'transfer.includeKeys': 'Включить SSH-ключи',
  'transfer.includeOld': 'Включить заменённые версии',
  'transfer.working': 'Обработка…',
  'transfer.export': 'Экспорт…',
  'transfer.import': 'Импорт…',
  'transfer.exported': 'Экспортировано в {path}',
  'transfer.exportedWith': 'Экспортировано в {path} — внутри паролей: {count}',
  'transfer.errUnreadable':
    'Паролей запечатаны ключом, которого нет на этом устройстве: {count}. В файл они не попали',
  'transfer.result':
    'Добавлено {added}, обновлено {updated}, без изменений {unchanged}, перенесено в old {superseded}, ключей {keys}, с паролем {passwords}',
  'transfer.oldTitle': 'Заменённые версии ({count})',
  'transfer.oldEmpty': 'Пока пусто',
  'transfer.oldVersionTag': 'Заменён',
  'transfer.currentVersionTag': 'Текущий',
  'transfer.currentGone': 'Текущей версии нет',
  'transfer.forgetAll': 'Забыть все',
  'transfer.forgetAllDone': 'Забыто версий: {count}',
  'transfer.withPasswordTag': ' · с паролем',
  'transfer.restore': 'Восстановить',
  'transfer.forget': 'Забыть',
}

export const DICTIONARIES: Record<Language, Record<TranslationKey, string>> = {
  en,
  ru
}

# Постоянный Vercel DEV/STAGING (шаг 3 v5)

## Модель

Логический DEV — стабильный branch deployment существующего Vercel-проекта `imi-mir` (Hobby), а не Production environment. Источник: GitHub `salakal/imi-mir`, ветка `develop`. Постоянный адрес: https://imi-mir-git-develop-vadimkamatveev07-2378.vercel.app/. Vercel автоматически переназначает этот branch alias на очередной deployment `develop`; уникальный URL и ID каждого deployment сохраняются для проверки SHA.

`main` остаётся единственной production branch с адресом https://imi-mir.vercel.app/. Feature/step PR получают отдельный commit-specific Preview URL. В настройках Vercel Production Branch Tracking — `main`, Preview Branch Tracking — остальные ветки. Нельзя нажимать **Promote to Production** или `vercel --prod` для DEV; это обойдёт роль ветки. Не привязывать production alias к `develop`.

Custom Environments недоступны на текущем Hobby без перехода на Pro; отдельный Vercel-проект не потребовался, поскольку безопасный стабильный branch alias уже назначен. Эта модель не создаёт нового платного ресурса. Обычный push/merge в `develop` создаёт Preview deployment и обновляет только branch alias, а не Production alias.

## Конфигурация

- `APP_ENV=development` — Vercel Config variable с областью **Preview → только ветка `develop`**. Это явный маркер логического DEV; baseline-код его пока не использует. Он не назначен Production и другим PR-веткам.
- На момент шага 3 пользовательских project environment variables и production-only writable resources не было. Не копировать будущие production-секреты в Preview. Для появляющихся далее БД, LKG или push subscriptions задавать отдельные DEV-значения с branch scope; PR Preview без боевых writable credentials.
- Build: Next.js, `next build`, корень репозитория, Node.js 24.x в Vercel. В `vercel.json` задан Next.js и build command. Приложение требует Node.js >= 22.13. Настройки platform-specific остаются во Vercel, без жёстко зашитых адресов в business logic.
- Перед изменением архитектуры среды или переносом на VPS повторно сверять настройки, env и source commit; будущий RU-перенос не выполняется этим шагом.

## Исходная проверка

После добавления DEV marker без изменения исходного кода повторно развернут `develop` SHA `f3ba74b670fbe8b09b60bdeeee55e0f0dbdfc615`: Vercel deployment `dpl_3H4V7M1qQZC2etweKvUqiFjKHK6b` READY. Проверено через постоянный branch URL: 29 групп колледжа и 18 групп СПО, выбор группы, расписание К-РУ-19 из официального PDF на 05.10–10.10, долги К-ИСП-49-1 из ведомости, сессия 2026–2027 с честным отсутствием дат, индекс преподавателей и ближайшая пара. Ошибок приложения в консоли не найдено (сообщения расширения браузера исключены). CI ранее проверил build, parser/audit, HTTP/mobile smoke на 390 px. Прямой API URL в облачном браузере дал `ERR_BLOCKED_BY_CLIENT`; UI успешно использовал API маршруты, но прямую проверку ответов маршрутов следует повторить доступным клиентом. Safari/WebKit на реальном iPhone в этой среде не доступен — требуется отдельная проверка перед безусловным заявлением о Safari parity.

Production до шага 3: `main` SHA `05a4aaf26dba133a1d677dae691d2c83a4e77d91`, deployment `dpl_HTPYsKoPxcqD5iAjqxrEPmUGDAtB`, alias `imi-mir.vercel.app`. После каждого изменения DEV сверять alias/SHA повторно. Ссылки и QR Production не обновлялись.

# Разработка IMI One: ветки и проверка изменений

Актуально с шага 2 плана v5. Исходная точка: baseline code `3143b13b227bb3e202610594fb61ea0a48fcb46b`, документационный `main` `05a4aaf26dba133a1d677dae691d2c83a4e77d91`. Production: `https://imi-mir.vercel.app`. Шаг 2 не меняет пользовательское поведение и production alias.

## Роли веток

- `main` — источник Vercel Production. Обычные изменения шагов 03–19 сюда не попадают. После полной регрессии шага 19 проверенный release candidate продвигается контролируемым PR на шаге 20.
- `develop` — integration-ветка от подтверждённого baseline. связана с постоянным Vercel DEV/STAGING по стабильному branch alias (см. `docs/vercel-dev.md`). Для каждого PR по-прежнему служит отдельный commit-specific Vercel Preview.
- `feature/*`, `fix/*`, `step/*` — одна изолированная задача от актуального `develop`; PR направлен в `develop`.

## Порядок

1. Сверить текущий `develop`, создать отдельную ветку, внести только изменения текущего шага и открыть PR в `develop` по шаблону.
2. Дождаться успешного GitHub Actions `Verify published timetable / all-published-groups` и успешного статуса `Vercel` для SHA PR. CI включает install, unit/parser tests, существующий аудит официальных PDF, build, локальный HTTP и мобильный smoke. `pnpm lint` пока не является required check: пробный прогон на неизменённом baseline завершился 15 ошибками и 1451 предупреждением (включая существующие React effects и сгенерированный код). Исправление линтера требует отдельного согласованного изменения без скрытого рефакторинга шага 2. Проваленный check блокирует готовность PR. Ссылка на Preview и SHA фиксируются в PR.
3. Проверить Vercel Preview по критериям шага, включая мобильный сценарий и источники данных. Preview не должен изменять `imi-mir.vercel.app` и не должен зависеть от production-only секретов.
4. После review и gate объединить PR в `develop`. Проверить CI для integration commit. Проверить постоянный Vercel DEV/STAGING на этом commit через branch alias, не затрагивая Production.
5. После шага 19 закрепить неизменяемый release candidate. На шаге 20 через контролируемый PR продвинуть ровно его в `main`, дождаться Vercel Production и выполнить smoke/regression. При критическом сбое откатить Production на известный предыдущий deployment, исправление снова провести через DEV.

На будущей российской инфраструктуре роли сохраняются: `develop → RU DEV`, `main → RU PROD`. Сейчас покупка VPS, домена и миграция не выполняются.

## Ограничения и защита

Required checks для правил GitHub: `all-published-groups` (GitHub Actions) и `Vercel` (commit-specific Preview). Для `main` и `develop` нужны PR-only merge, успешные checks, запрет force push и удаления, запрет обхода правил. Не включать требование review от другого человека, пока нет доступного постоянного reviewer: оно может заблокировать разработку; review результата шага проводит владелец после отчёта. Защиту GitHub нужно проверить фактическим тестовым PR.

Ruleset `Protect main and develop` (ID `24421188`) активирован владельцем и фактически проверен через GitHub API: охватывает `refs/heads/main` и `refs/heads/develop`, требует PR и checks `all-published-groups`/`Vercel`, запрещает deletion и non-fast-forward, bypass list пуст. GitHub App в этой Work-сессии по-прежнему не имеет repository administration permission на изменение ruleset.

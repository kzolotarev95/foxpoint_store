# FOX POINT — локальная визуальная сборка по макетам

Источник визуальных решений: локальный архив `C:\Users\k.zolotarev95\Desktop\Макеты сайта.zip` (22 PNG-макета админской панели).

В локальную админку перенесены общие правила макетов:

- тёмный фон с мягкими оранжевыми и фиолетовыми свечениями;
- фирменный lockup FOX POINT в боковой панели;
- фиксированная навигация с иконками и оранжевым активным разделом;
- крупные панели с тонкой фиолетовой границей и скруглением;
- вкладки базы, финансовые карточки, фильтры, таблицы и кнопки в едином стиле;
- адаптивная компоновка навигации и карточек для узких экранов;
- единая подача страниц базы, заказов, обращений, аудита, оплат, бэкапов и настроек.

Локальный снимок для проверки: `.codex-temp/design-admin-preview.png`.

## Проверка

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\k.zolotarev95\Documents\FoxPoint\scripts\start-local-preview.ps1"
```

После запуска открыть `http://127.0.0.1:3000/admin` и войти `admin / admin`.

Остановить локальный preview:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\k.zolotarev95\Documents\FoxPoint\scripts\stop-local-preview.ps1"
```

Изменения оставлены только в рабочей копии. Коммитов и push нет.

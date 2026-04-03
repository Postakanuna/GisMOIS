# ZWS (Zulu Web Service) — Общее описание

Источник: https://www.politerm.com/zuluserver/webhelp/zws.html

## Описание

Zulu Web Service – собственный протокол ZuluServer для общения с клиентами по HTTP-протоколу.
Поддерживает наибольшее количество команд для работы с данными ZuluServer, а также для
выполнения инженерных расчётов.

Публикация данных выполняется в утилите **ZsWsSetup.exe**.

Общая схема команд ZWS: https://www.politerm.com/schemas/ZWSCommands.xsd

## Примеры живых демонстраций

| Пример | URL |
|--------|-----|
| OpenLayers | http://zs.zulugis.ru:6473/examples/openlayers.html |
| Leaflet | http://zs.zulugis.ru:6473/examples/leaflet.html |
| Yandex API | http://zs.zulugis.ru:6473/examples/yandex.html |
| Получение тайла (GET) | http://zs.zulugis.ru:6473/examples/getlayertile.get.html |
| Получение тайла (POST) | http://zs.zulugis.ru:6473/examples/getlayertile.post.html |
| Получение списка слоев (POST) | http://zs.zulugis.ru:6473/examples/getlayerlist.html |

## Полный список команд ZWS

Из https://www.politerm.com/zuluserver/webhelp/zws/zws_index.html

### Информация о слоях
- **GetLayerList** — список слоёв (Name + Title)
- **GetLayerBaseInfo** — описание БД слоя (поля, запросы)
- **GetLayerTypes** — структура типов слоя (GraphType)
- **GetLayerCapabilities** — свойства слоя (редактирование и т.д.)
- **GetLayerBounds** — габариты слоя
- **GetLayerLabels** — варианты надписей (бирок)
- **GetLayerThemes** — тематические раскраски
- **GetLayerTile** — тайл слоя
- **GetLayerUpdateCount** — временная метка слоя

### Получение объектов
- **LayerIntersectByBox** — объекты в прямоугольной области
- **LayerIntersectByRadius** — объекты в радиусе
- **SelectElemByXY** — объекты в точке
- **GetElemsByID** — объекты по списку ID
- **LayerExecSQL** — SQL-запрос к слою
- **LayerQueryByExample** — запрос к слою
- **GetElemBlob** — бинарное поле объекта
- **LayerReadCustomData** — пользовательские данные слоя

### Редактирование объектов
- **LayerAddSymbol** — добавить точечный объект
- **LayerAddPolyline** — добавить линейный объект
- **LayerAddPolygon** — добавить площадной объект
- **LayerDeleteElement** — удалить объект
- **LayerDeleteNode** — удалить вершину
- **LayerInsertNode** — добавить вершину
- **LayerMoveElement** — переместить объект
- **LayerMoveNode** — переместить узел
- **UpdateElemAttributes** — обновить атрибуты
- **SetElemState** — установить режим объекта
- **LayerBatchEdit** — пакетное редактирование
- **SetElemBlob** — записать бинарные данные
- **LayerWriteCustomData** — записать пользовательские данные

### Сетевые операции
- **LayerFindConnected** — связанные объекты сети
- **LayerFindWay** — кратчайший путь по сети
- **LayerGetIncidentElements** — связанные с данным ID объекты
- **IntersectElemByLayer** — пересечение с объектами другого слоя
- **NetworkRecalc** — переключения на сети
- **NetworkAnalyzeSwitch** — анализ переключений

### Трекинг
- **TrackingGetLayerList** — список слоёв трекинга
- **TrackingGetInfoByXY** — информация по координатам
- **TrackingGetVector** — векторные данные трекинга
- **TrackingRegisterDevice** — регистрация устройства
- **TrackingSetPosition** — текущее местоположение

### Инженерные расчёты (NetTools)
- **NetToolsCreateNetwork** — создать слой инженерной сети
- **NetToolsGetSourcesTree** — дерево источников сети
- **NetToolsSelectSubNetwork** — выделить подсеть
- **NetToolsTaskRun** — запустить расчёт
- **NetToolsTaskStop** — остановить расчёт
- **NetToolsTaskTerminate** — завершить расчёт
- **NetToolsTaskGetStatus** — статус расчёта
- **NetToolsTaskGetOutput** — протокол расчёта
- **NetToolsTaskGetErrors** — ошибки расчёта

### Карты
- **GetZMMap** — описатель карты
- **GetZMMapList** — список карт

## Формат запроса (POST)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
    <Command>
        <ИМЯ_КОМАНДЫ>
            <!-- параметры -->
        </ИМЯ_КОМАНДЫ>
    </Command>
</zulu-server>
```

URL: `POST {baseUrl}/zws`

## Формат ответа

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zwsResponse>
    <ИМЯ_КОМАНДЫ>
        <!-- результаты -->
    </ИМЯ_КОМАНДЫ>
    <RetVal>N</RetVal>
</zwsResponse>
```

`RetVal`:
- `< 0` — ошибка
- `0` — успех, 0 записей
- `> 0` — количество записей

## GET-запросы (упрощённый синтаксис)

`GET {baseUrl}/zws/{commandname}`

Пример: `http://zs.zulugis.ru:6473/zws/getlayerlist`

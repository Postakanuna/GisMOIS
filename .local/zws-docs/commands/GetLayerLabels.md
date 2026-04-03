# GetLayerLabels (ZWS)

Источник: https://www.politerm.com/zuluserver/webhelp/zws/GetLayerLabels.html

> Возвращает список вариантов надписей (бирок) слоя

## Применение

Получить доступные варианты подписей объектов на карте.

## Общая структура запроса

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
    <Command>
        <GetLayerLabels>
            <Layer>namespace:layername</Layer>
        </GetLayerLabels>
    </Command>
</zulu-server>
```

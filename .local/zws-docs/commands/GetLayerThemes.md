# GetLayerThemes (ZWS)

Источник: https://www.politerm.com/zuluserver/webhelp/zws/GetLayerThemes.html

> Возвращает список тематических раскрасок слоя

## Применение

Позволяет получить доступные тематические раскраски для слоя — цветовые схемы, зависящие от значений атрибутов.

## Общая структура запроса

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
    <Command>
        <GetLayerThemes>
            <Layer>namespace:layername</Layer>
        </GetLayerThemes>
    </Command>
</zulu-server>
```

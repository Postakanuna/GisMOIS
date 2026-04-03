# GetElemsByID (ZWS)

Источник: https://www.politerm.com/zuluserver/webhelp/zws/GetElemsByID.html

> Возвращает данные объектов слоя Zulu по заданному списку ID.

## Общая структура запроса

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
    <Command>
        <GetElemsByID>
            <Layer>namespace:layername</Layer>
            <ElemIDs>
                <ElemID>123</ElemID>
                <ElemID>456</ElemID>
            </ElemIDs>
            <Geometry>Yes</Geometry>
            <Attr>Yes</Attr>
            <CRS>EPSG:4326</CRS>
        </GetElemsByID>
    </Command>
</zulu-server>
```

## Применение

Используется для получения конкретных объектов по их ID (например, для highlight/selection).
Формат ответа аналогичен SelectElemByXY — `<Element>` блоки с `<Geometry>` и `<Records>`.

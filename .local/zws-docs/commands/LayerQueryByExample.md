# LayerQueryByExample (ZWS)

Источник: https://www.politerm.com/zuluserver/webhelp/zws/LayerQueryByExample.html

> Выполняет запрос к слою (по примеру)

## Применение

Альтернатива LayerExecSQL для простых фильтров атрибутов без написания SQL.
Формат ответа — `<Element>` блоки (аналогично LayerIntersectByBox).

## Общая структура запроса

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
    <Command>
        <LayerQueryByExample>
            <Layer>namespace:layername</Layer>
            <Filter>
                <Field>
                    <Name>Status</Name>
                    <Value>Active</Value>
                </Field>
            </Filter>
            <Geometry>Yes</Geometry>
            <Attr>Yes</Attr>
            <CRS>EPSG:4326</CRS>
        </LayerQueryByExample>
    </Command>
</zulu-server>
```

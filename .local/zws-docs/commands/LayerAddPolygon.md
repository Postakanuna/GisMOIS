# LayerAddPolygon (ZWS)

Источник: https://www.politerm.com/zuluserver/webhelp/zws/LayerAddPolygon.html

> Добавляет в слой площадной объект

## Общая структура запроса

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
    <Command>
        <LayerAddPolygon>
            <Layer>namespace:layername</Layer>
            <TypeID>1</TypeID>
            <ModeNum>1</ModeNum>
            <CRS>EPSG:3857</CRS>
            <coordinates>x1,y1 x2,y2 x3,y3 x1,y1</coordinates>
        </LayerAddPolygon>
    </Command>
</zulu-server>
```

Координаты в формате KML: `x,y` через пробел, первая и последняя точки совпадают.

## Пример ответа

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zwsResponse>
    <LayerAddPolygon />
    <RetVal>75805</RetVal>
</zwsResponse>
```

RetVal > 0 — ID созданного объекта.

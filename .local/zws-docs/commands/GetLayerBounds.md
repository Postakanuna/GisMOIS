# GetLayerBounds (ZWS)

Источник: https://www.politerm.com/zuluserver/webhelp/zws/GetLayerBounds.html

> Возвращает габариты слоя (bounding box)

## Общая структура запроса

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
    <Command>
        <GetLayerBounds>
            <Layer>namespace:layername</Layer>
            <CRS>EPSG:4326</CRS>
        </GetLayerBounds>
    </Command>
</zulu-server>
```

## Пример ответа

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zwsResponse>
    <GetLayerBounds>
        <BoundingBox CRS="EPSG:4326" minx="37.1" miny="55.5" maxx="37.9" maxy="56.1"/>
    </GetLayerBounds>
    <RetVal>0</RetVal>
</zwsResponse>
```

## Применение

- Определить bbox слоя для начального zoom/extent на карте
- Использовать как параметр в LayerIntersectByBox для получения всех объектов

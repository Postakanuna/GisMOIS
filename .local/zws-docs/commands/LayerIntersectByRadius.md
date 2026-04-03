# LayerIntersectByRadius (ZWS)

Источник: https://www.politerm.com/zuluserver/webhelp/zws/LayerIntersectByRadius.html

> Возвращает данные объектов слоя, попавших в окрестность заданного радиуса

## Применение

Аналог LayerIntersectByBox, но с круговой областью выбора (точка + радиус).
Формат ответа аналогичен LayerIntersectByBox — `<Element>` блоки с `<Geometry>` ОТДЕЛЬНО от атрибутов.

## Общая структура запроса

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
    <Command>
        <LayerIntersectByRadius>
            <Layer>namespace:layername</Layer>
            <X>37.6</X>
            <Y>55.7</Y>
            <Radius>500</Radius>
            <CRS>EPSG:4326</CRS>
            <Geometry>Yes</Geometry>
            <Attr>Yes</Attr>
        </LayerIntersectByRadius>
    </Command>
</zulu-server>
```

## Параметры

- `X`, `Y` — центр окружности в CRS
- `Radius` — радиус в единицах CRS (метры для EPSG:3857, градусы для EPSG:4326)
- `Geometry` — Yes/No — вернуть геометрию
- `Attr` — Yes/No — вернуть атрибуты

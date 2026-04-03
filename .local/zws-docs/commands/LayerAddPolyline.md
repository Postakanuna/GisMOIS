# LayerAddPolyline (ZWS)

Источник: https://www.politerm.com/zuluserver/webhelp/zws/LayerAddPolyline.html

> Добавляет в слой линейный объект

## Схема запроса

```xml
<xs:complexType name="typeLayerAddPolyline">
    <xs:all>
        <xs:element name="Layer" type="typeLayer"/>
        <xs:element name="TypeID" type="xs:integer"/>
        <xs:element name="ModeNum" type="typeModeNum"/>
        <xs:element name="CRS" type="typeCRS" minOccurs="0" maxOccurs="1" default="EPSG:3857"/>
        <xs:element name="coordinates" type="kml:CoordinatesType"/>
    </xs:all>
</xs:complexType>
```

## Пример запроса

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
    <Command>
        <LayerAddPolyline>
            <Layer>riga:teplo</Layer>
            <TypeID>14</TypeID>
            <ModeNum>1</ModeNum>
            <CRS>EPSG:3857</CRS>
            <coordinates>7754557.35,2674979.51
            7754680.74,2675191.87</coordinates>
        </LayerAddPolyline>
    </Command>
</zulu-server>
```

## Пример ответа

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<zwsResponse>
    <LayerAddPolyline />
    <RetVal>75802</RetVal>
</zwsResponse>
```

RetVal > 0 — ID созданного объекта.

## Параметры

- `Layer` — имя слоя
- `TypeID` — ID типа объекта
- `ModeNum` — индекс режима
- `CRS` — система координат
- `coordinates` — координаты в формате KML: `x1,y1 x2,y2` (разделены пробелом или переводом строки)

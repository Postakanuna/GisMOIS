# LayerAddSymbol (ZWS)

Источник: https://www.politerm.com/zuluserver/webhelp/zws/LayerAddSymbol.html

> Добавляет в слой символьный (точечный) объект

## Схема запроса

```xml
<xs:complexType name="typeLayerAddSymbol">
    <xs:all>
        <xs:element name="Layer" type="typeLayer"/>
        <xs:element name="TypeID" type="xs:integer"/>
        <xs:element name="ModeNum" type="typeModeNum"/>
        <xs:element name="X" type="xs:double"/>
        <xs:element name="Y" type="xs:double"/>
        <xs:element name="CRS" type="typeCRS" minOccurs="0" maxOccurs="1" default="EPSG:3857"/>
        <xs:element name="Angle" type="xs:double" minOccurs="0" default="0"/>
    </xs:all>
</xs:complexType>
```

## Пример запроса

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
    <Command>
        <LayerAddSymbol>
            <Layer>riga:teplo</Layer>
            <TypeID>2</TypeID>
            <ModeNum>2</ModeNum>
            <X>56.96</X>
            <Y>24.03</Y>
            <CRS>EPSG:3857</CRS>
            <Angle>0</Angle>
        </LayerAddSymbol>
    </Command>
</zulu-server>
```

## Пример ответа

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zwsResponse>
    <LayerAddSymbol></LayerAddSymbol>
    <RetVal>75798</RetVal>
</zwsResponse>
```

RetVal > 0 — ID созданного объекта (ElemID).

## Параметры

- `Layer` — имя слоя
- `TypeID` — ID типа объекта (из GetLayerTypes)
- `ModeNum` — индекс режима (из GetLayerTypes → Modes → Mode → Index)
- `X`, `Y` — координаты точки в CRS
- `CRS` — система координат (по умолчанию EPSG:3857)
- `Angle` — угол поворота символа (по умолчанию 0)

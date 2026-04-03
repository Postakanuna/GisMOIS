# SelectElemByXY (ZWS)

Источник: https://www.politerm.com/zuluserver/webhelp/zws/SelectElemByXY.html

> Возвращает данные объектов слоя Zulu, расположенных в указанной точке на местности.

## Схема запроса

```xml
<xs:complexType name="typeSelectElemByXY">
    <xs:all>
        <xs:element name="Layer" type="typeLayer"/>
        <xs:element name="X" type="xs:double"/>
        <xs:element name="Y" type="xs:double"/>
        <xs:element name="Scale" type="xs:double"/>
        <xs:element name="CRS" type="typeCRS"/>
        <xs:element name="Geometry" type="typeFlag" minOccurs="0" default="No"/>
        <xs:element name="Attr" type="typeFlag" minOccurs="0" default="Yes"/>
        <xs:element name="ModeList" type="typeFlag" minOccurs="0" default="No"/>
        <xs:element name="ModeImage" type="typeSampleImage" minOccurs="0"/>
        <xs:element name="QueryList" type="typeFlag" minOccurs="0" default="No"/>
        <xs:element name="Queries" minOccurs="0">
            <!-- список запросов -->
        </xs:element>
    </xs:all>
</xs:complexType>
```

## Схема ответа (typeSelectElemByXYResponse)

```xml
<xs:complexType name="typeSelectElemByXYResponse">
    <xs:sequence>
        <xs:element name="Element" minOccurs="0" maxOccurs="unbounded">
            <xs:complexType>
                <xs:all>
                    <xs:element name="ElemID" type="xs:integer"/>
                    <xs:element name="TypeID" type="xs:integer"/>
                    <xs:element name="ModeNum" type="typeModeNum"/>
                    <xs:element name="Modes">...</xs:element>
                    <xs:element name="Queries">
                        <xs:sequence>
                            <xs:element name="Query" minOccurs="0" maxOccurs="unbounded">
                                <xs:all>
                                    <xs:element name="BaseID"/>
                                    <xs:element name="Name"/>
                                </xs:all>
                            </xs:element>
                        </xs:sequence>
                    </xs:element>
                    <xs:element name="Records" type="typeRecords"/>
                    <xs:element name="Geometry" type="typeGeometry"/>
                </xs:all>
            </xs:complexType>
        </xs:element>
    </xs:sequence>
</xs:complexType>
```

## Пример запроса

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
    <Command>
        <SelectElemByXY>
            <Layer>riga:teplo</Layer>
            <X>7750570.503410</X>
            <Y>2675360.966306</Y>
            <Scale>4.77731426782351</Scale>
            <CRS>EPSG:3857</CRS>
            <ModeList>Yes</ModeList>
            <QueryList>Yes</QueryList>
            <Geometry>Yes</Geometry>
            <Attr>Yes</Attr>
        </SelectElemByXY>
    </Command>
</zulu-server>
```

## Параметры

- `Layer` — имя слоя
- `X`, `Y` — координаты точки в CRS
- `Scale` — масштаб (влияет на радиус выбора)
- `CRS` — система координат
- `Geometry` — Yes/No — вернуть геометрию
- `Attr` — Yes/No — вернуть атрибуты
- `ModeList` — Yes/No — вернуть список режимов
- `QueryList` — Yes/No — вернуть список запросов

## Применение в проекте

Используется для определения объекта при клике на карту (feature info / identify).

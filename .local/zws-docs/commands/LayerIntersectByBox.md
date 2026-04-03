# LayerIntersectByBox (ZWS)

Источник: https://www.politerm.com/zuluserver/webhelp/zws/LayerIntersectByBox.html

> Возвращает данные объектов слоя, попавших в заданную прямоугольную область.

## КРИТИЧЕСКИ ВАЖНО: Формат ответа

**LayerIntersectByBox возвращает ДРУГОЙ формат, чем LayerExecSQL!**
- Геометрия — в отдельном теге `<Geometry>WKT</Geometry>` внутри `<Element>`, НЕ в `<Field>`
- Атрибуты — внутри `<Element>/<Queries>/<Query>/<Records>/<Record>/<Field>`
- Структура: `<Element>` (не `<Record>`)

Используйте этот формат для **viewport-based отображения** (получение видимых объектов).
Для **полного импорта всех объектов** используйте `LayerExecSQL`.

## Схема запроса

```xml
<xs:complexType name="typeBoundingBox">
    <xs:attribute name="CRS" type="typeCRS"/>
    <xs:attribute name="minx" type="xs:double"/>
    <xs:attribute name="miny" type="xs:double"/>
    <xs:attribute name="maxx" type="xs:double"/>
    <xs:attribute name="maxy" type="xs:double"/>
</xs:complexType>

<xs:complexType name="typeLayerIntersectByBox">
    <xs:all>
        <xs:element name="Layer" type="typeLayer"/>
        <xs:element name="BoundingBox" type="typeBoundingBox"/>
        <xs:element name="Relation" type="typeSpatialOperator" minOccurs="0" default="Intersects"/>
        <xs:element name="Geometry" type="typeFlag" minOccurs="0" default="No"/>
        <xs:element name="Attr" type="typeFlag" minOccurs="0" default="Yes"/>
        <xs:element name="ModeList" type="typeFlag" minOccurs="0" default="No"/>
        <xs:element name="ModeImage" type="typeSampleImage" minOccurs="0"/>
        <xs:element name="QueryList" type="typeFlag" minOccurs="0" default="No"/>
        <xs:element name="Queries" minOccurs="0">
            <!-- список запросов: BaseID, Name, TypeID -->
        </xs:element>
    </xs:all>
</xs:complexType>
```

## Схема ответа

Использует тип `typeSelectElemByXYResponse`:

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
                                    <xs:element name="BaseID" type="xs:integer"/>
                                    <xs:element name="Name" type="xs:string"/>
                                    <!-- здесь Records с Field/Name/Value -->
                                </xs:all>
                            </xs:element>
                        </xs:sequence>
                    </xs:element>
                    <xs:element name="Records" type="typeRecords"/>
                    <xs:element name="Geometry" type="typeGeometry"/>
                    <!-- <Geometry> — это WKT строка ОТДЕЛЬНО от Records! -->
                </xs:all>
            </xs:complexType>
        </xs:element>
    </xs:sequence>
</xs:complexType>
```

## Структура фактического ответа

```xml
<zwsResponse>
  <LayerIntersectByBox>
    <Element>
      <ElemID>123</ElemID>
      <TypeID>1</TypeID>
      <ModeNum>1</ModeNum>
      <Modes>
        <Mode><Index>1</Index><Title>Работа</Title></Mode>
      </Modes>
      <Queries>
        <Query>
          <BaseID>1</BaseID>
          <Name>default</Name>
          <Records>
            <Record>
              <Field><Name>Sys</Name><Value>123</Value></Field>
              <Field><Name>Name</Name><Value>Объект</Value></Field>
            </Record>
          </Records>
        </Query>
      </Queries>
      <Geometry>LINESTRING(37.123 55.456, 37.234 55.567)</Geometry>
    </Element>
  </LayerIntersectByBox>
  <RetVal>1</RetVal>
</zwsResponse>
```

## Пример запроса

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
  <Command>
    <LayerIntersectByBox>
      <Layer>riga:teplo</Layer>
      <BoundingBox CRS="EPSG:3857" minx="7754552.83" miny="2675036.21" maxx="7754887.34" maxy="2675253.64"/>
      <Geometry>Yes</Geometry>
      <Attr>Yes</Attr>
    </LayerIntersectByBox>
  </Command>
</zulu-server>
```

## Параметры

- `Layer` — имя слоя (namespace:layername)
- `BoundingBox` — прямоугольная область с атрибутами: CRS, minx, miny, maxx, maxy
- `Relation` — пространственная операция (по умолчанию Intersects)
- `Geometry` — Yes/No — включить WKT геометрию в ответ (по умолчанию No)
- `Attr` — Yes/No — включить атрибуты в ответ (по умолчанию Yes)
- `ModeList` — Yes/No — включить список режимов
- `QueryList` — Yes/No — включить список запросов

## Применение в проекте

- **client-side viewport query**: `/api/zulu/zws/features` — использует LayerIntersectByBox с текущим bbox
- **НЕ использовать** для импорта всего слоя в БД — используйте LayerExecSQL

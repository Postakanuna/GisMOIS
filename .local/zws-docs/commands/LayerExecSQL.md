# LayerExecSQL (ZWS)

Источник: https://www.politerm.com/zuluserver/webhelp/zws/LayerExecSQL.html

> Выполняет SQL-запрос к слою или нескольким слоям ZuluGIS.

## ВАЖНО: Особенности

1. **Тег команды в XML: `<LayerExecSql>`** (маленькая `s`, не `SQL`!)
2. **Геометрия**: `SELECT *, Geometry.AsText()` — в ответе поле называется `Geometry` (ZWS автоматически переименовывает)
3. **Этот формат отличается от LayerIntersectByBox** — здесь `<Records>` с `<Record>/<Field>`, там — `<Element>` с отдельным тегом `<Geometry>`

## Схема запроса

```xml
<xs:complexType name="typeLayerExecSQL">
    <xs:all>
        <xs:element name="Layer" type="typeLayer" minOccurs="0"/>
        <xs:element name="Query" type="xs:string"/>
        <xs:element name="CRS" type="typeCRS" minOccurs="0" maxOccurs="1" default="EPSG:3857"/>
    </xs:all>
</xs:complexType>
```

## Схема ответа

```xml
<xs:complexType name="typeLayerExecSQLResponse">
    <xs:sequence>
        <xs:element name="Records" type="typeRecords" minOccurs="0"/>
    </xs:sequence>
</xs:complexType>

<xs:complexType name="typeField">
    <xs:sequence>
        <xs:element name="Name" type="xs:string"/>
        <xs:element name="Value" type="xs:string"/>
    </xs:sequence>
</xs:complexType>

<xs:complexType name="typeRecord">
    <xs:sequence>
        <xs:element name="Field" type="typeField" maxOccurs="unbounded"/>
    </xs:sequence>
</xs:complexType>

<xs:complexType name="typeRecords">
    <xs:sequence>
        <xs:element name="Record" type="typeRecord" maxOccurs="unbounded"/>
    </xs:sequence>
</xs:complexType>
```

## Пример запроса 1 — один слой с геометрией

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
    <Command>
        <LayerExecSql>
            <Layer>riga:teplo</Layer>
            <Query>SELECT Sys, Geometry.AsText() WHERE Sys=143 OR Sys=3378</Query>
        </LayerExecSql>
    </Command>
</zulu-server>
```

**Примечание**: в SQL запросе FROM не нужен — он неявно относится к слою из тега `<Layer>`.

## Пример ответа 1

```xml
<zwsResponse>
    <LayerExecSql>
        <Records>
            <Record>
                <Field>
                    <Name>Sys</Name>
                    <Value>143</Value>
                </Field>
                <Field>
                    <Name>Geometry</Name>
                    <Value>POINT(56.95237683334503 24.03602916212978)</Value>
                </Field>
            </Record>
            <Record>
                <Field>
                    <Name>Sys</Name>
                    <Value>3378</Value>
                </Field>
                <Field>
                    <Name>Geometry</Name>
                    <Value>LINESTRING(56.96114198632733 24.03543016538373, ...)</Value>
                </Field>
            </Record>
        </Records>
    </LayerExecSql>
    <RetVal>2</RetVal>
</zwsResponse>
```

## Пример запроса 2 — несколько слоёв

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
    <Command>
        <LayerExecSql>
            <Query>
                SELECT B.Sys AS BuildingSys, B.Address, T.Sys AS TeploSys
                FROM ${layer[riga:buildings]} AS B, ${layer[riga:teplo]} AS T
                WHERE T.Sys = 143 AND B.geometry.Intersects(T.geometry)
            </Query>
            <CRS>EPSG:4326</CRS>
        </LayerExecSql>
    </Command>
</zulu-server>
```

Синтаксис для указания слоев: `${layer[namespace:layername]}`

## Запрос для импорта всех объектов с геометрией

```xml
<LayerExecSql>
    <Layer>mo:teplo</Layer>
    <Query>SELECT *, Geometry.AsText()</Query>
    <CRS>EPSG:4326</CRS>
</LayerExecSql>
```

Возвращает все поля (`*`) + WKT геометрию (поле `Geometry`) в EPSG:4326.

## Параметры

- `Layer` — имя слоя (опционально, если указан в SQL через FROM ${layer[...]})
- `Query` — SQL-запрос в синтаксисе ZuluGIS
- `CRS` — система координат для геометрии (по умолчанию EPSG:3857)

## Поддерживаемый SQL

Документация: https://www.politerm.com/zuludoc/index.html#sql.html

- `SELECT *` — все поля
- `SELECT field1, field2` — конкретные поля
- `WHERE condition` — фильтрация
- `Geometry.AsText()` — геометрия в WKT
- `B.geometry.Intersects(T.geometry)` — пространственное пересечение
- `FROM ${layer[namespace:name]}` — указание слоя в SQL

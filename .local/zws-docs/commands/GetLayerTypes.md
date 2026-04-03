# GetLayerTypes (ZWS)

Источник: https://www.politerm.com/zuluserver/webhelp/zws/GetLayerTypes.html

> Возвращает структуру типов слоя

## ВАЖНО: Источник типа геометрии

**Это единственная команда ZWS, возвращающая тип геометрии слоя!**
`<GraphType>` = Point, Line, или Polygon.

GetLayerList и GetLayerBaseInfo типа геометрии НЕ содержат.

## Схема запроса

```xml
<xs:complexType name="typeGetLayerTypes">
    <xs:all>
        <xs:element name="Layer" type="typeLayer"/>
        <xs:element name="ModeImage" type="typeSampleImage" minOccurs="0"/>
    </xs:all>
</xs:complexType>
```

## Схема ответа

```xml
<xs:complexType name="typeGetLayerTypesResponse">
    <xs:all>
        <xs:element name="Types">
            <xs:complexType>
                <xs:sequence>
                    <xs:element name="Type" minOccurs="0" maxOccurs="unbounded">
                        <xs:complexType>
                            <xs:all>
                                <xs:element name="Id" type="xs:integer"/>
                                <xs:element name="Title" type="xs:string"/>
                                <xs:element name="GraphType" type="typeGraphType"/>
                                <!-- typeGraphType = Point | Line | Polygon -->
                                <xs:element name="Tag" type="xs:integer"/>
                                <xs:element name="Modes">
                                    <xs:complexType>
                                        <xs:sequence>
                                            <xs:element name="Mode" minOccurs="0" maxOccurs="unbounded">
                                                <xs:complexType>
                                                    <xs:all>
                                                        <xs:element name="Index" type="xs:integer"/>
                                                        <xs:element name="Title" type="xs:string"/>
                                                        <xs:element name="SwitchState" type="typeStateFlag" minOccurs="0"/>
                                                        <xs:element name="Image" type="xs:string" minOccurs="0"/>
                                                    </xs:all>
                                                </xs:complexType>
                                            </xs:element>
                                        </xs:sequence>
                                    </xs:complexType>
                                </xs:element>
                            </xs:all>
                        </xs:complexType>
                    </xs:element>
                </xs:sequence>
            </xs:complexType>
        </xs:element>
    </xs:all>
</xs:complexType>
```

## Пример запроса

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
    <Command>
        <GetLayerTypes>
            <Layer>riga:teplo</Layer>
        </GetLayerTypes>
    </Command>
</zulu-server>
```

## Пример ответа

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zwsResponse>
    <GetLayerTypes>
        <Types>
            <Type>
                <Id>-1</Id>
                <Title>Primitives</Title>
                <!-- GraphType отсутствует для примитивов -->
            </Type>
            <Type>
                <Id>1</Id>
                <Title>Источник</Title>
                <GraphType>Point</GraphType>
                <Tag>2</Tag>
                <Modes>
                    <Mode>
                        <Index>1</Index>
                        <Title>Работа</Title>
                        <SwitchState>On</SwitchState>
                    </Mode>
                    <Mode>
                        <Index>2</Index>
                        <Title>Отключен</Title>
                        <SwitchState>Off</SwitchState>
                    </Mode>
                </Modes>
            </Type>
            <Type>
                <Id>5</Id>
                <Title>Задвижка</Title>
                <GraphType>Point</GraphType>
                <Tag>3</Tag>
                <Modes>...</Modes>
            </Type>
            <Type>
                <Id>14</Id>
                <Title>Трубопровод</Title>
                <GraphType>Line</GraphType>
                <Tag>1</Tag>
                <Modes>...</Modes>
            </Type>
        </Types>
    </GetLayerTypes>
    <RetVal>5</RetVal>
</zwsResponse>
```

## Поля ответа

- `Type/Id` — числовой ID типа (-1 для примитивов)
- `Type/Title` — название типа объекта
- `Type/GraphType` — **тип геометрии**: Point, Line, Polygon
- `Type/Tag` — тег типа
- `Type/Modes/Mode` — варианты режимов объекта:
  - `Index` — индекс режима
  - `Title` — название режима
  - `SwitchState` — On/Off (для запорной арматуры)

## Как определить геометрию слоя

Слой может содержать объекты разных типов (точки И линии). Для определения доминирующей геометрии:
1. Вызвать GetLayerTypes
2. Найти первый `<Type>` с непустым `<GraphType>`
3. Использовать это значение как тип геометрии слоя

Или импортировать все данные и определить геометрию из реальных объектов.

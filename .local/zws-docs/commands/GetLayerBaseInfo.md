# GetLayerBaseInfo (ZWS)

Источник: https://www.politerm.com/zuluserver/webhelp/zws/GetLayerBaseInfo.html

> Возвращает описание базы данных слоя

## ВАЖНО: Ограничения

**В ответе GetLayerBaseInfo нет типа данных полей!**
Каждый `<Field>` содержит ТОЛЬКО `<Name>` (внутреннее имя) и `<UserName>` (пользовательское имя).
Тега `<Type>` в `<Field>` нет — это подтверждено официальной XSD-схемой.

## Схема запроса

```xml
<xs:complexType name="typeGetLayerBaseInfo">
    <xs:all>
        <xs:element name="Layer" type="typeLayer"/>
        <xs:element name="TypeID" type="xs:integer" minOccurs="0"/>
        <xs:element name="BasedID" type="xs:integer" minOccurs="0"/>
        <xs:element name="Queries" type="typeFlag" minOccurs="0" default="Yes"/>
        <xs:element name="Forms" type="typeFlag" minOccurs="0" default="No"/>
    </xs:all>
</xs:complexType>
```

## Схема ответа (сокращённая)

```xml
<xs:complexType name="typeGetLayerBaseInfoResponse">
    <xs:all>
        <xs:element name="Base">
            <xs:complexType>
                <xs:all>
                    <xs:element name="BaseID" type="xs:integer"/>
                    <xs:element name="UserName" type="xs:string"/>
                    <xs:element name="Queries">
                        <xs:complexType>
                            <xs:sequence>
                                <xs:element name="Query">
                                    <xs:complexType>
                                        <xs:sequence>
                                            <xs:element name="Name" type="xs:string"/>
                                            <xs:element name="Fields">
                                                <xs:complexType>
                                                    <xs:sequence>
                                                        <xs:element name="Field">
                                                            <xs:complexType>
                                                                <xs:all>
                                                                    <xs:element name="Name" type="xs:string"/>
                                                                    <xs:element name="UserName" type="xs:string"/>
                                                                    <!-- НЕТ <Type>! -->
                                                                </xs:all>
                                                            </xs:complexType>
                                                        </xs:element>
                                                    </xs:sequence>
                                                </xs:complexType>
                                            </xs:element>
                                        </xs:sequence>
                                    </xs:complexType>
                                </xs:element>
                            </xs:sequence>
                        </xs:complexType>
                    </xs:element>
                    <!-- аналогично <Forms> -->
                </xs:all>
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
        <GetLayerBaseInfo>
            <Layer>riga:teplo</Layer>
            <TypeID>6</TypeID>
            <Queries>no</Queries>
            <Forms>yes</Forms>
        </GetLayerBaseInfo>
    </Command>
</zulu-server>
```

## Структура ответа

Путь к полям: `Base > Queries > Query > Fields > Field > Name + UserName`

Путь к формам: `Base > Forms > Form > Name + QueryName + Fields > Field > Name + UserName`

## Параметры запроса

- `Layer` — имя слоя (namespace:layername)
- `TypeID` — (опционально) ID типа объекта для фильтрации
- `BasedID` — (опционально) ID базы
- `Queries` — Yes/No (по умолчанию Yes) — включить информацию о запросах/полях
- `Forms` — Yes/No (по умолчанию No) — включить информацию о формах

# GetLayerList (ZWS)

Источник: https://www.politerm.com/zuluserver/webhelp/zws/GetLayerList.html

> Возвращает список слоёв Zulu, опубликованных на данном сервере, которые готовы работать по протоколу ZWS.

## ВАЖНО: Ограничения

**GetLayerList возвращает ТОЛЬКО Name и Title. Тип геометрии НЕ входит в ответ.**
Для получения типа геометрии используйте `GetLayerTypes` → `<GraphType>`.

## Схема запроса

```xml
<xs:element name="zulu-server">
    <xs:complexType>
        <xs:sequence>
            <xs:element name="Command">
                <xs:complexType>
                    <xs:choice>
                        <xs:element name="GetLayerList"/>
                    </xs:choice>
                </xs:complexType>
            </xs:element>
        </xs:sequence>
    </xs:complexType>
</xs:element>
```

## Схема ответа

```xml
<xs:complexType name="typeGetLayerListResponse">
    <xs:sequence>
        <xs:element name="Layer" minOccurs="0" maxOccurs="unbounded">
            <xs:complexType>
                <xs:all>
                    <xs:element name="Name" type="xs:string"/>
                    <xs:element name="Title" type="xs:string"/>
                </xs:all>
            </xs:complexType>
        </xs:element>
    </xs:sequence>
</xs:complexType>
```

## Пример запроса (POST)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
    <Command>
        <GetLayerList/>
    </Command>
</zulu-server>
```

GET-запрос: `http://zs.zulugis.ru:6473/zws/getlayerlist`

## Пример ответа

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zwsResponse>
  <GetLayerList>
    <Layer>
      <Name>riga:houses</Name>
      <Title>buve 1</Title>
    </Layer>
    <Layer>
      <Name>riga:teplo</Name>
      <Title>Креисайс</Title>
    </Layer>
    <Layer>
      <Name>mo:vo</Name>
      <Title>Водоотведение</Title>
    </Layer>
    <Layer>
      <Name>mo:ts</Name>
      <Title>Тепловая сеть</Title>
    </Layer>
  </GetLayerList>
  <RetVal>4</RetVal>
</zwsResponse>
```

## Поля ответа

- `Layer` — доступные опубликованные слои:
  - `Name` — имя слоя вместе с пространством имён (формат `namespace:layername`)
  - `Title` — пользовательское имя слоя
- `RetVal` — количество слоёв (> 0) или код ошибки (< 0)

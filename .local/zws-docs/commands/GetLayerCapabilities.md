# GetLayerCapabilities (ZWS)

Источник: https://www.politerm.com/zuluserver/webhelp/zws/GetLayerCapabilities.html

> Возвращает набор свойств, которые поддерживает слой.

## Схема запроса

```xml
<xs:complexType name="GetLayerCapabilitiesRequestType">
    <xs:sequence>
        <xs:element name="Layer" type="xs:string"/>
    </xs:sequence>
</xs:complexType>
```

## Схема ответа

```xml
<xs:complexType name="GetLayerCapabilitiesResponseType">
    <xs:sequence>
        <xs:element name="Layer" type="xs:string"/>
        <xs:element name="Capabilities" type="CapabilitiesType"/>
    </xs:sequence>
</xs:complexType>

<xs:complexType name="CapabilitiesType">
    <xs:sequence>
        <xs:element name="IdSearch" type="YesNoSimpleType"/>
        <xs:element name="Model" type="xs:string"/>
        <xs:element name="Banners" type="YesNoSimpleType"/>
        <xs:element name="Editor" type="EditorType"/>
    </xs:sequence>
</xs:complexType>

<xs:complexType name="EditorType">
    <xs:sequence>
        <xs:element name="WebNoEdit" type="YesNoSimpleType"/>
        <xs:element name="MobileGPSOnly" type="YesNoSimpleType"/>
    </xs:sequence>
</xs:complexType>
```

## Пример запроса

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
    <Command>
        <GetLayerCapabilities>
            <Layer>example:DOMA</Layer>
        </GetLayerCapabilities>
    </Command>
</zulu-server>
```

## Пример ответа

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zwsResponse>
    <GetLayerCapabilities>
        <Layer>NetTools:fromapi</Layer>
        <Capabilities>
            <IdSearch>No</IdSearch>
            <Model>hydro</Model>
            <Banners>No</Banners>
            <Editor>
                <WebNoEdit>No</WebNoEdit>
                <MobileGPSOnly>No</MobileGPSOnly>
            </Editor>
        </Capabilities>
    </GetLayerCapabilities>
    <RetVal>0</RetVal>
</zwsResponse>
```

## Поля ответа

- `IdSearch` — Yes/No — поиск по ID (для быстрого поиска)
- `Model` — модель инженерной сети слоя (hydro, gas, thermo, drain, steam)
- `Banners` — Yes/No — включены ли всплывающие подсказки
- `Editor/WebNoEdit` — Yes/No — редактирование геометрии через веб отключено
- `Editor/MobileGPSOnly` — Yes/No — редактирование в Mobile только по GPS

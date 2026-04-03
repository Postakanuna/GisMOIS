# GetZMMapList (ZWS)

Источник: https://www.politerm.com/zuluserver/webhelp/zws/GetZMMapList.html

> Возвращает список карт Zulu, опубликованных на данном сервере, которые готовы работать по протоколу ZWS.

## Применение

Аналог GetLayerList, но для карт (ZMap) — композитных объектов, объединяющих несколько слоёв.

## Общая структура запроса

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
    <Command>
        <GetZMMapList/>
    </Command>
</zulu-server>
```

## Пример ответа

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zwsResponse>
    <GetZMMapList>
        <Map>
            <Name>mo:main</Name>
            <Title>Основная карта МО</Title>
        </Map>
    </GetZMMapList>
    <RetVal>1</RetVal>
</zwsResponse>
```

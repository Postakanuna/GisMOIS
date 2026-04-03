# GetZMMap (ZWS)

Источник: https://www.politerm.com/zuluserver/webhelp/zws/GetZMMap.html

> Возвращает описатель карты с сервера

## Применение

Получить метаданные конкретной карты (ZMap) с ZuluServer — список слоёв, проекцию, начальный экстент.

## Общая структура запроса

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
    <Command>
        <GetZMMap>
            <Map>mapname</Map>
        </GetZMMap>
    </Command>
</zulu-server>
```

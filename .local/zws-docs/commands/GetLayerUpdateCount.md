# GetLayerUpdateCount (ZWS)

Источник: https://www.politerm.com/zuluserver/webhelp/zws/GetLayerUpdateCount.html

> Возвращает временную метку слоя

## Применение

Используется для определения, изменились ли данные слоя с последнего запроса (кэш-инвалидация).

## Общая структура запроса

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
    <Command>
        <GetLayerUpdateCount>
            <Layer>namespace:layername</Layer>
        </GetLayerUpdateCount>
    </Command>
</zulu-server>
```

## Пример ответа

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zwsResponse>
    <GetLayerUpdateCount>
        <Count>42</Count>
    </GetLayerUpdateCount>
    <RetVal>0</RetVal>
</zwsResponse>
```

Если `Count` изменился по сравнению с предыдущим запросом — данные слоя были обновлены.

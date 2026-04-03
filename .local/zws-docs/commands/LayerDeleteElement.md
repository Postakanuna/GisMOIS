# LayerDeleteElement (ZWS)

Источник: https://www.politerm.com/zuluserver/webhelp/zws/LayerDeleteElement.html

> Удаляет объект слоя

## Общая структура запроса

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
    <Command>
        <LayerDeleteElement>
            <Layer>namespace:layername</Layer>
            <ElemID>123</ElemID>
        </LayerDeleteElement>
    </Command>
</zulu-server>
```

## Пример ответа

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zwsResponse>
    <LayerDeleteElement/>
    <RetVal>0</RetVal>
</zwsResponse>
```

RetVal = 0 — успех.

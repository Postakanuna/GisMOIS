# SetElemState (ZWS)

Источник: https://www.politerm.com/zuluserver/webhelp/zws/SetElemState.html

> Устанавливает режим объекта слоя

## Применение

Используется для смены режима (mode) объекта инженерной сети — например, открыть/закрыть задвижку.

## Общая структура запроса

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
    <Command>
        <SetElemState>
            <Layer>namespace:layername</Layer>
            <ElemID>123</ElemID>
            <ModeNum>2</ModeNum>
        </SetElemState>
    </Command>
</zulu-server>
```

## Параметры

- `Layer` — имя слоя
- `ElemID` — ID объекта (из GetLayerTypes → Modes → Mode → Index)
- `ModeNum` — новый режим объекта

## Пример ответа

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zwsResponse>
    <SetElemState/>
    <RetVal>0</RetVal>
</zwsResponse>
```

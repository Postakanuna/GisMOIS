# UpdateElemAttributes (ZWS)

Источник: https://www.politerm.com/zuluserver/webhelp/zws/UpdateElemAttributes.html

> Обновляет атрибуты объекта слоя

## Применение

Используется для изменения значений полей атрибутивной таблицы существующего объекта.
Требует знания ElemID объекта (например, из SelectElemByXY или LayerExecSQL).

## Общая структура запроса

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
    <Command>
        <UpdateElemAttributes>
            <Layer>namespace:layername</Layer>
            <ElemID>123</ElemID>
            <!-- поля для обновления -->
            <Fields>
                <Field>
                    <Name>FieldName</Name>
                    <Value>NewValue</Value>
                </Field>
            </Fields>
        </UpdateElemAttributes>
    </Command>
</zulu-server>
```

## Пример ответа

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zwsResponse>
    <UpdateElemAttributes/>
    <RetVal>0</RetVal>
</zwsResponse>
```

RetVal = 0 — успех.

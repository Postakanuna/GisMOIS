# LayerBatchEdit (ZWS)

Источник: https://www.politerm.com/zuluserver/webhelp/zws/LayerBatchEdit.html

> Позволяет выполнять пакетное редактирование.

## Поддерживаемые операции

- Добавление объектов (Add)
- Обновление атрибутов (Update)
- Удаление объектов (Delete)
- Перемещение объектов (Move)

## Применение

Используется когда нужно внести много изменений за один запрос вместо нескольких отдельных.

## Общая структура запроса

```xml
<?xml version="1.0" encoding="UTF-8"?>
<zulu-server service="zws" version="1.0.0">
    <Command>
        <LayerBatchEdit>
            <Layer>namespace:layername</Layer>
            <Operations>
                <Add>
                    <TypeID>1</TypeID>
                    <ModeNum>1</ModeNum>
                    <X>37.6</X>
                    <Y>55.7</Y>
                    <CRS>EPSG:4326</CRS>
                </Add>
                <Delete>
                    <ElemID>123</ElemID>
                </Delete>
                <UpdateAttributes>
                    <ElemID>456</ElemID>
                    <Fields>
                        <Field><Name>Name</Name><Value>Новое имя</Value></Field>
                    </Fields>
                </UpdateAttributes>
            </Operations>
        </LayerBatchEdit>
    </Command>
</zulu-server>
```

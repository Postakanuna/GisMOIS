# ZWS (Zulu Web Service) — Официальная документация

Источник: https://www.politerm.com/zuluserver/webhelp/zws/zws_index.html

Документация сохранена: март 2026

## Содержание

- [README.md](README.md) — этот файл, навигация
- [zws-overview.md](zws-overview.md) — общее описание протокола ZWS
- [zws-errors.md](zws-errors.md) — коды ошибок
- [commands/](commands/) — отдельные страницы команд:
  - [GetLayerList.md](commands/GetLayerList.md)
  - [GetLayerBaseInfo.md](commands/GetLayerBaseInfo.md)
  - [GetLayerTypes.md](commands/GetLayerTypes.md)
  - [GetLayerCapabilities.md](commands/GetLayerCapabilities.md)
  - [GetLayerBounds.md](commands/GetLayerBounds.md)
  - [LayerIntersectByBox.md](commands/LayerIntersectByBox.md)
  - [LayerIntersectByRadius.md](commands/LayerIntersectByRadius.md)
  - [LayerExecSQL.md](commands/LayerExecSQL.md)
  - [SelectElemByXY.md](commands/SelectElemByXY.md)
  - [GetElemsByID.md](commands/GetElemsByID.md)
  - [LayerAddSymbol.md](commands/LayerAddSymbol.md)
  - [LayerAddPolyline.md](commands/LayerAddPolyline.md)
  - [LayerAddPolygon.md](commands/LayerAddPolygon.md)
  - [LayerDeleteElement.md](commands/LayerDeleteElement.md)
  - [UpdateElemAttributes.md](commands/UpdateElemAttributes.md)
  - [LayerBatchEdit.md](commands/LayerBatchEdit.md)
  - [LayerQueryByExample.md](commands/LayerQueryByExample.md)
  - [GetLayerThemes.md](commands/GetLayerThemes.md)
  - [GetLayerLabels.md](commands/GetLayerLabels.md)
  - [GetLayerUpdateCount.md](commands/GetLayerUpdateCount.md)
  - [GetZMMap.md](commands/GetZMMap.md)
  - [GetZMMapList.md](commands/GetZMMapList.md)
  - [SetElemState.md](commands/SetElemState.md)

## КРИТИЧЕСКИ ВАЖНЫЕ ФАКТЫ (для разработки)

### GetLayerList
- Возвращает ТОЛЬКО `<Name>` и `<Title>` для каждого слоя
- **Тип геометрии НЕ входит в GetLayerList** — нельзя получить отсюда
- Для типа геометрии нужно использовать `GetLayerTypes` → `<GraphType>`

### GetLayerBaseInfo
- Структура ответа: `<Base><BaseID><UserName><Queries><Query><Name><Fields><Field><Name><UserName>`
- `<Field>` содержит ТОЛЬКО `<Name>` и `<UserName>` — типа данных поля нет!
- НЕТ поля `<Type>` в `<Field>` — только внутренние имена и пользовательские имена

### GetLayerTypes
- Единственный источник типа геометрии слоя
- Структура: `<Types><Type><Id><Title><GraphType>Point|Line|Polygon</GraphType><Tag><Modes>`
- `<GraphType>` = Point, Line, Polygon

### LayerExecSQL — формат запроса и ответа
- Запрос с геометрией: `SELECT *, Geometry.AsText()`
- Тег команды: `<LayerExecSql>` (не LayerExecSQL — маленькая s!)
- Геометрия в ответе называется `Geometry` (не `Geometry.AsText()` — ZWS автоматически переименовывает)
- Формат ответа:
```xml
<zwsResponse>
  <LayerExecSql>
    <Records>
      <Record>
        <Field><Name>Sys</Name><Value>143</Value></Field>
        <Field><Name>Geometry</Name><Value>POINT(lon lat)</Value></Field>
      </Record>
    </Records>
  </LayerExecSql>
  <RetVal>2</RetVal>
</zwsResponse>
```

### LayerIntersectByBox — ДРУГОЙ формат ответа!
- НЕ путать с LayerExecSQL — структура полностью другая
- Использует тип ответа `typeSelectElemByXYResponse` (как SelectElemByXY)
- Геометрия в ОТДЕЛЬНОМ теге `<Geometry>WKT</Geometry>` внутри `<Element>`, НЕ в `<Field>`!
- Формат ответа:
```xml
<zwsResponse>
  <LayerIntersectByBox>
    <Element>
      <ElemID>123</ElemID>
      <TypeID>1</TypeID>
      <ModeNum>1</ModeNum>
      <Modes>...</Modes>
      <Queries>
        <Query>
          <BaseID>1</BaseID>
          <Name>default</Name>
          <Records>
            <Record>
              <Field><Name>FieldA</Name><Value>val</Value></Field>
            </Record>
          </Records>
        </Query>
      </Queries>
      <Geometry>LINESTRING(x1 y1, x2 y2)</Geometry>
    </Element>
  </LayerIntersectByBox>
  <RetVal>N</RetVal>
</zwsResponse>
```

### Координаты в ZWS WKT
- ZWS возвращает координаты в формате `POINT(lon lat)` — сначала долгота, потом широта
- Соответствует GeoJSON и стандарту WKT (X=lon, Y=lat)
- CRS EPSG:4326 — географические координаты

### Аутентификация
- POST запросы к `{baseUrl}/zws`
- XML в теле запроса: `<?xml version="1.0" encoding="UTF-8"?><zulu-server service="zws" version="1.0.0"><Command>...</Command></zulu-server>`
- GET запросы: `{baseUrl}/zws/{commandname}` — упрощённый синтаксис

### Коды ответа (RetVal)
- `< 0` — ошибка (см. zws-errors.md)
- `0` — успех, 0 записей
- `> 0` — количество возвращённых записей

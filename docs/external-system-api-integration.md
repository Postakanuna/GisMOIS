# Инструкция по подключению внешней системы к ГИС МО "Инженерные сети"
## Интеграция по передаче результатов геопространственного анализа

---

## Назначение

Данная инструкция описывает порядок подключения внешней информационной системы к API ГИС МО ИС для получения результатов геопространственного анализа по идентификатору слоя (ID слоя) и идентификатору объекта (ID объекта).

Сценарий использования: внешняя система передаёт ID слоя с полигональными границами и ID конкретного объекта (полигона), ГИС МО ИС возвращает все объекты из других слоёв, попадающие в пределы указанного полигона.

---

## Базовый URL

```
https://gismois.ru
```

---

## Шаг 1: Получение API-ключа

### 1.1 Создание ключа в интерфейсе ГИС МО ИС

1. Войдите в систему с учётной записью **администратора** на [https://gismois.ru](https://gismois.ru)
2. Перейдите в **Настройки** (иконка шестерёнки в правом верхнем углу)
3. Прокрутите страницу до раздела **"API ключи"**
4. Нажмите **"Создать ключ"**
5. Заполните параметры:
   - **Название** — укажите наименование вашей системы (например: "АРМ АРКИ", "Система мониторинга")
   - **Сцена** — выберите конкретную сцену (проект/карту) или оставьте "Все сцены"
   - **Разрешения** — для геопространственного анализа необходимо включить:
     - `read_scenes` — чтение списка сцен
     - `read_layers` — чтение слоёв
     - `spatial_query` — выполнение пространственных запросов
6. **ВАЖНО:** Скопируйте и сохраните токен сразу после создания — он отображается **только один раз**!

### 1.2 Формат токена

```
gis_xxxxxxxxxxxx
```

### 1.3 Передача токена в запросах

Во всех запросах к API (кроме `/api/external/health`) токен передаётся в заголовке:

```
Authorization: Bearer gis_ВАШ_ТОКЕН
```

---

## Шаг 2: Описание эндпоинтов

### 2.1 Проверка доступности сервиса

**Запрос (без авторизации):**
```
GET /api/external/health
```

**Пример:**
```bash
curl https://gismois.ru/api/external/health
```

**Ответ при успехе:**
```json
{ "status": "ok" }
```

---

### 2.2 Получение списка доступных сцен

**Запрос:**
```
GET /api/external/scenes
Authorization: Bearer gis_ВАШ_ТОКЕН
```

**Пример:**
```bash
curl -H "Authorization: Bearer gis_ВАШ_ТОКЕН" \
  https://gismois.ru/api/external/scenes
```

**Ответ:**
```json
[
  { "id": 1, "name": "Основная сцена" },
  { "id": 3, "name": "Водоснабжение МР" }
]
```

> Поле `id` — это **ID сцены**, используется для получения слоёв.

---

### 2.3 Получение слоёв сцены

**Запрос:**
```
GET /api/external/scenes/{sceneId}/layers
Authorization: Bearer gis_ВАШ_ТОКЕН
```

**Параметры пути:**

| Параметр  | Тип    | Описание                            |
|-----------|--------|-------------------------------------|
| `sceneId` | integer | ID сцены (из предыдущего запроса) |

**Пример:**
```bash
curl -H "Authorization: Bearer gis_ВАШ_ТОКЕН" \
  https://gismois.ru/api/external/scenes/1/layers
```

**Ответ:**
```json
[
  {
    "id": 12,
    "name": "Границы муниципальных районов",
    "geometryType": "Polygon",
    "featureCount": 36
  },
  {
    "id": 15,
    "name": "Объекты водоснабжения",
    "geometryType": "Point",
    "featureCount": 284
  },
  {
    "id": 18,
    "name": "Трубопроводы",
    "geometryType": "LineString",
    "featureCount": 1052
  }
]
```

> Для геопространственного анализа (поиск объектов в полигоне) используйте слои с `geometryType: "Polygon"` или `"MultiPolygon"` в качестве **граничного слоя**.

---

### 2.4 Геопространственный анализ — поиск объектов в полигоне по ID объекта

**Основной эндпоинт для интеграции с внешней системой.**

Принимает ID слоя (полигональный) и ID конкретного объекта (полигона), возвращает все объекты из других слоёв, пространственно попадающие внутрь данного полигона.

**Запрос:**
```
GET /api/external/layers/{layerId}/features-in-polygon/{featureId}
Authorization: Bearer gis_ВАШ_ТОКЕН
```

**Параметры пути:**

| Параметр    | Тип     | Описание                                                              |
|-------------|---------|-----------------------------------------------------------------------|
| `layerId`   | integer | ID слоя с полигонами (граничный слой, тип Polygon/MultiPolygon)      |
| `featureId` | integer | ID конкретного объекта (полигона) в данном слое                       |

**Необязательные параметры запроса (query string):**

| Параметр           | Тип               | По умолчанию | Описание                                                                      |
|--------------------|-------------------|--------------|-------------------------------------------------------------------------------|
| `sourceLayerIds`   | integer (массив)  | все слои сцены | Ограничить поиск конкретными слоями. Передавать как: `sourceLayerIds=5&sourceLayerIds=8` |
| `includeAttributes`| string (массив)   | все атрибуты | Вернуть только указанные атрибуты объектов. Передавать как: `includeAttributes=Название&includeAttributes=Адрес` |
| `crossScene`       | boolean           | `false`      | Если `true` — искать объекты во всех доступных сценах (не только в сцене граничного слоя) |
| `sourceSceneIds`   | integer (массив)  | все сцены    | При `crossScene=true` — ограничить поиск конкретными сценами                 |

**Пример минимального запроса:**
```bash
curl -H "Authorization: Bearer gis_ВАШ_ТОКЕН" \
  "https://gismois.ru/api/external/layers/12/features-in-polygon/47"
```

**Пример с фильтрацией по слоям и атрибутам:**
```bash
curl -H "Authorization: Bearer gis_ВАШ_ТОКЕН" \
  "https://gismois.ru/api/external/layers/12/features-in-polygon/47?sourceLayerIds=15&sourceLayerIds=18&includeAttributes=Название&includeAttributes=Адрес&includeAttributes=Статус"
```

**Структура ответа:**
```json
{
  "boundaryLayer": {
    "id": 12,
    "name": "Границы муниципальных районов",
    "featureCount": 1
  },
  "boundaryFeature": {
    "id": "47",
    "properties": {
      "Название": "Сергиево-Посадский МР",
      "Код": "50:05"
    },
    "geometry": {
      "type": "Polygon",
      "coordinates": [[[37.1, 56.2], [37.5, 56.2], [37.5, 56.6], [37.1, 56.6], [37.1, 56.2]]]
    }
  },
  "results": [
    {
      "layerId": 15,
      "layerName": "Объекты водоснабжения",
      "sceneId": 1,
      "geometryType": "Point",
      "totalCount": 284,
      "matchedCount": 23,
      "features": [
        {
          "id": 1082,
          "properties": {
            "Название": "НС-14",
            "Адрес": "г. Сергиев Посад, ул. Советская, 5",
            "Статус": "Эксплуатируется"
          },
          "geometry": {
            "type": "Point",
            "coordinates": [38.1337, 56.3124]
          }
        }
      ]
    },
    {
      "layerId": 18,
      "layerName": "Трубопроводы",
      "sceneId": 1,
      "geometryType": "LineString",
      "totalCount": 1052,
      "matchedCount": 87,
      "features": [...]
    }
  ],
  "meta": {
    "analyzedAt": "2026-03-19T10:30:00.000Z",
    "totalLayersAnalyzed": 2,
    "totalFeaturesMatched": 110,
    "crossScene": false,
    "scenesSearched": [1]
  }
}
```

**Описание полей ответа:**

| Поле                           | Описание                                                        |
|--------------------------------|-----------------------------------------------------------------|
| `boundaryLayer`                | Информация о граничном слое                                     |
| `boundaryFeature`              | Запрошенный объект-полигон с его геометрией и атрибутами        |
| `results[]`                    | Массив результатов по каждому проанализированному слою          |
| `results[].layerId`            | ID слоя-источника                                               |
| `results[].layerName`          | Наименование слоя-источника                                     |
| `results[].totalCount`         | Общее количество объектов в слое                                |
| `results[].matchedCount`       | Количество объектов, попавших в границы полигона                |
| `results[].features[]`         | Массив объектов с ID, атрибутами и геометрией (GeoJSON)         |
| `meta.analyzedAt`              | Дата и время выполнения анализа (ISO 8601, UTC)                 |
| `meta.totalLayersAnalyzed`     | Количество проанализированных слоёв                             |
| `meta.totalFeaturesMatched`    | Суммарное количество найденных объектов                         |
| `meta.scenesSearched`          | Список ID сцен, по которым выполнялся поиск                     |

> **Ограничение:** в одном ответе возвращается не более **10 000 объектов** суммарно по всем слоям.

---

### 2.5 Геопространственный анализ — поиск объектов по всем полигонам слоя

Аналогичный запрос, но без указания конкретного объекта — анализируются **все полигоны** граничного слоя.

**Запрос:**
```
GET /api/external/layers/{layerId}/features-in-polygon
Authorization: Bearer gis_ВАШ_ТОКЕН
```

**Параметры пути:**

| Параметр  | Тип     | Описание                                               |
|-----------|---------|--------------------------------------------------------|
| `layerId` | integer | ID слоя с полигонами (тип Polygon или MultiPolygon)    |

Необязательные параметры запроса — те же, что и в п. 2.4 (`sourceLayerIds`, `includeAttributes`, `crossScene`, `sourceSceneIds`).

**Пример:**
```bash
curl -H "Authorization: Bearer gis_ВАШ_ТОКЕН" \
  "https://gismois.ru/api/external/layers/12/features-in-polygon?sourceLayerIds=15"
```

**Ответ аналогичен п. 2.4**, но без поля `boundaryFeature`. Поле `boundaryLayer.featureCount` содержит общее число полигонов граничного слоя.

---

## Шаг 3: Типичный сценарий интеграции

Ниже описана последовательность вызовов для получения объектов в пределах конкретного административного района или зоны:

```
1. GET /api/external/health
   → Убедиться, что сервис доступен

2. GET /api/external/scenes
   → Получить ID нужной сцены (например, id=1)

3. GET /api/external/scenes/1/layers
   → Найти ID граничного слоя (Polygon) и ID нужных слоёв-источников

4. GET /api/external/layers/{layerId}/features-in-polygon/{featureId}
      ?sourceLayerIds=15&sourceLayerIds=18
      &includeAttributes=Название&includeAttributes=Адрес
   → Получить все объекты нужных слоёв в пределах заданного полигона
```

---

## Шаг 4: Пример кода (Python)

```python
import requests

BASE_URL = "https://gismois.ru/api/external"
API_TOKEN = "gis_ВАШ_ТОКЕН"

HEADERS = {
    "Authorization": f"Bearer {API_TOKEN}",
    "Content-Type": "application/json"
}

def check_health():
    """Проверка доступности сервиса"""
    resp = requests.get(f"{BASE_URL}/health")
    return resp.json()

def get_scenes():
    """Получить список сцен"""
    resp = requests.get(f"{BASE_URL}/scenes", headers=HEADERS)
    resp.raise_for_status()
    return resp.json()

def get_layers(scene_id: int):
    """Получить слои сцены"""
    resp = requests.get(f"{BASE_URL}/scenes/{scene_id}/layers", headers=HEADERS)
    resp.raise_for_status()
    return resp.json()

def get_features_in_polygon(layer_id: int, feature_id: int,
                             source_layer_ids: list = None,
                             include_attributes: list = None):
    """
    Геопространственный анализ: найти объекты внутри заданного полигона.
    
    :param layer_id:          ID граничного слоя (полигональный)
    :param feature_id:        ID объекта-полигона в этом слое
    :param source_layer_ids:  Список ID слоёв для поиска (None = все слои сцены)
    :param include_attributes: Список атрибутов для включения в ответ (None = все)
    """
    params = {}
    if source_layer_ids:
        params["sourceLayerIds"] = source_layer_ids
    if include_attributes:
        params["includeAttributes"] = include_attributes

    resp = requests.get(
        f"{BASE_URL}/layers/{layer_id}/features-in-polygon/{feature_id}",
        headers=HEADERS,
        params=params
    )
    resp.raise_for_status()
    return resp.json()


# --- Пример использования ---

if __name__ == "__main__":
    # 1. Проверяем доступность
    print("Статус сервиса:", check_health())

    # 2. Получаем сцены
    scenes = get_scenes()
    scene_id = scenes[0]["id"]
    print(f"Используем сцену: {scenes[0]['name']} (id={scene_id})")

    # 3. Получаем слои
    layers = get_layers(scene_id)
    for layer in layers:
        print(f"  Слой id={layer['id']}: {layer['name']} [{layer['geometryType']}]")

    # 4. Выполняем геопространственный анализ
    # Граничный слой id=12, объект-полигон id=47
    # Ищем объекты в слоях 15 и 18, возвращаем только "Название" и "Адрес"
    result = get_features_in_polygon(
        layer_id=12,
        feature_id=47,
        source_layer_ids=[15, 18],
        include_attributes=["Название", "Адрес"]
    )

    print(f"\nАнализ выполнен: {result['meta']['analyzedAt']}")
    print(f"Граничный объект: {result['boundaryFeature']['properties']}")
    print(f"Всего найдено объектов: {result['meta']['totalFeaturesMatched']}")

    for layer_result in result["results"]:
        print(f"\nСлой '{layer_result['layerName']}': "
              f"{layer_result['matchedCount']} из {layer_result['totalCount']} объектов")
        for feature in layer_result["features"][:3]:  # первые 3 объекта
            print(f"  - id={feature['id']}: {feature['properties']}")
```

---

## Шаг 5: Коды ответов и ошибки

| HTTP-код | Описание |
|----------|----------|
| `200 OK` | Запрос выполнен успешно |
| `400 Bad Request` | Неверный формат параметров, недопустимый тип слоя (не полигональный), граничный слой без объектов |
| `401 Unauthorized` | Токен отсутствует или имеет неверный формат |
| `403 Forbidden` | Токен не имеет доступа к запрошенной сцене или операции |
| `404 Not Found` | Слой или объект с указанным ID не существует |
| `422 Unprocessable Entity` | Граничный слой не содержит объектов |
| `500 Internal Server Error` | Внутренняя ошибка сервера |

**Пример ответа при ошибке:**
```json
{
  "error": "Not found",
  "message": "Feature with id '999' not found in layer 12"
}
```

---

## Шаг 6: Важные технические замечания

### Формат координат
Все геометрии возвращаются в формате **GeoJSON**: координаты в порядке `[долгота, широта]` (longitude, latitude), система координат **WGS 84 (EPSG:4326)**.

### Требования к граничному слою
- Тип геометрии граничного слоя должен быть **`Polygon`** или **`MultiPolygon`**
- Граничный слой должен принадлежать конкретной сцене (глобальные слои не поддерживаются)
- В граничном слое должен быть хотя бы один объект

### Ограничения
- Максимальное количество возвращаемых объектов: **10 000** (суммарно по всем слоям)
- При превышении лимита результат обрезается — необходимо использовать параметр `sourceLayerIds` для фильтрации

### Права доступа API-ключа
- Ключ, ограниченный конкретной сценой, не может получать данные из других сцен (параметр `crossScene` игнорируется)
- Для межсценового поиска используйте ключ с правами на "Все сцены"

### Рекомендации
- Кешируйте результаты вызовов `/scenes` и `/scenes/{id}/layers` на стороне вашей системы (обновляйте не чаще 1 раза в час), так как структура слоёв меняется редко
- Для уменьшения объёма ответа используйте параметр `includeAttributes` с перечнем только необходимых атрибутов
- Для уменьшения нагрузки на сервер используйте параметр `sourceLayerIds` с перечнем только нужных слоёв

---

## Контактная информация

По вопросам подключения и получения API-ключа обращайтесь к администратору системы ГИС МО ИС.

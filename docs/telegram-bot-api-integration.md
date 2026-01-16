# Инструкция по подключению Telegram бота к ГИС МО "Инженерные сети"

## Базовый URL
```
https://gismois.ru
```

---

## Шаг 1: Создание API ключа

1. Войдите в систему как администратор на https://gismois.ru
2. Перейдите в **Настройки** (иконка шестерёнки)
3. Прокрутите вниз до раздела **"API ключи"**
4. Нажмите **"Создать ключ"**
5. Укажите:
   - Название (например: "Telegram Bot")
   - Сцена (выберите конкретную сцену или "Все сцены")
   - Разрешения (включите все три: создание точек, чтение сцен, чтение слоёв)
6. **ВАЖНО:** Скопируйте токен сразу — он показывается только один раз!

Токен имеет формат: `gis_xxxxxxxxxxxx`

---

## Шаг 2: API эндпоинты

### Проверка работоспособности
```bash
curl https://gismois.ru/api/external/health
```

### Получение списка сцен
```bash
curl -H "Authorization: Bearer gis_ВАШ_ТОКЕН" \
  https://gismois.ru/api/external/scenes
```

**Ответ:**
```json
[
  {"id": 1, "name": "Основная сцена"},
  {"id": 3, "name": "Тестовая"}
]
```

### Получение Point-слоёв сцены
```bash
curl -H "Authorization: Bearer gis_ВАШ_ТОКЕН" \
  https://gismois.ru/api/external/scenes/1/layers
```

**Ответ:**
```json
[
  {"id": 5, "name": "Точки интереса", "geometryType": "Point"},
  {"id": 8, "name": "GPS фотографии", "geometryType": "Point"}
]
```

### Создание точки на карте (основной запрос для бота)
```bash
curl -X POST \
  -H "Authorization: Bearer gis_ВАШ_ТОКЕН" \
  -H "Content-Type: application/json" \
  -d '{
    "sceneId": 1,
    "layerId": 5,
    "coordinates": [37.617635, 55.755814],
    "properties": {
      "Описание": "Фото с GPS",
      "Дата": "2026-01-16",
      "telegram_user": "@username"
    }
  }' \
  https://gismois.ru/api/external/points
```

**Формат координат:** `[долгота, широта]` (longitude, latitude) — стандарт GeoJSON

**Ответ при успехе:**
```json
{
  "success": true,
  "feature": {
    "id": 123,
    "layerId": 5,
    "geometry": {"type": "Point", "coordinates": [37.617635, 55.755814]},
    "properties": {"Описание": "Фото с GPS", ...}
  }
}
```

---

## Шаг 3: Пример кода для Python (aiogram/telebot)

```python
import requests

API_URL = "https://gismois.ru/api/external"
API_TOKEN = "gis_ВАШ_ТОКЕН"

headers = {
    "Authorization": f"Bearer {API_TOKEN}",
    "Content-Type": "application/json"
}

def create_point(scene_id, layer_id, lon, lat, properties=None):
    """Создать точку на карте из GPS координат"""
    data = {
        "sceneId": scene_id,
        "layerId": layer_id,
        "coordinates": [lon, lat],  # [долгота, широта]
        "properties": properties or {}
    }
    
    response = requests.post(
        f"{API_URL}/points",
        headers=headers,
        json=data
    )
    return response.json()

def get_scenes():
    """Получить список доступных сцен"""
    response = requests.get(f"{API_URL}/scenes", headers=headers)
    return response.json()

def get_layers(scene_id):
    """Получить Point-слои сцены"""
    response = requests.get(f"{API_URL}/scenes/{scene_id}/layers", headers=headers)
    return response.json()

# Пример использования в обработчике фото с GPS:
# location = message.location  # или из EXIF фото
# create_point(
#     scene_id=1, 
#     layer_id=5, 
#     lon=location.longitude, 
#     lat=location.latitude,
#     properties={"user": message.from_user.username, "date": "2026-01-16"}
# )
```

---

## Коды ошибок

| Код | Описание |
|-----|----------|
| 401 | Неверный или отсутствующий токен |
| 403 | Нет доступа к этой сцене/слою или недостаточно прав |
| 400 | Неверный формат запроса (проверьте координаты, sceneId, layerId) |
| 404 | Сцена или слой не найдены |

---

## Важные замечания

1. **Координаты** передаются в формате `[долгота, широта]` (GeoJSON стандарт)
2. **Только Point-слои** доступны для создания точек через API
3. Токен может быть ограничен конкретной сценой при создании
4. Поле `properties` может содержать любые дополнительные данные (текст, даты, ссылки)

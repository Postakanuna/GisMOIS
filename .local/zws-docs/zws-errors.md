# ZWS — Коды ответов на запросы

Источник: https://www.politerm.com/zuluserver/webhelp/zws_errors_codes.html

| Код | Ошибка | Описание | Причина | Решение |
|:---:|:---:|---|---|---|
| 0 | `OK` | Успешное выполнение операции | — | — |
| -1 | `ZWS_ERROR_COMMON` | Общая ошибка выполнения операции | Операция не была выполнена или произошла ошибка | |
| -1001 | `ZWS_ERROR_DATABASE_FAILED_OPEN` | Failed to open database | | |
| -2001 | `ZWS_ERROR_LAYER_INVALID_NAME` | Invalid layer name | | |
| -2002 | `ZWS_ERROR_LAYER_BLOCKED` | Layer access is blocked. May be not enough disk space | | |
| -2003 | `ZWS_ERROR_TOO_MUCH_BANNERS` | Too much banners | | |
| -2005 | `Invalid SQL request` | Invalid SQL request | Неправильный SQL запрос, возможно ошибка в синтаксисе | Проверить правильность SQL запроса в ZuluGIS |
| -7001 | `ZWS_ERROR_NT_SOLVER_FAILED` | Failed to run ZuluNetTools solver | | |
| -7002 | `ZWS_ERROR_NT_MAKEDIR_FAILED` | Failed to create task folder | | |
| -7003 | `ZWS_ERROR_NT_MAKEXML_FAILED` | Failed to create task xml file | | |
| -7004 | `ZWS_ERROR_NT_NO_HANDLE` | Task handle is not specified | Не указан идентификатор задачи | Указать хендлер задачи в запросе |
| -7005 | `ZWS_ERROR_NT_INVALID_HANDLE` | Invalid task handle (was not found) | Неправильный хендлер или задача остановлена (TERMINATE) | Проверить хендлер задачи |
| -7006 | `ZWS_ERROR_NT_STOP_FAILED` | Failed to stop process | | |
| -7007 | `ZWS_ERROR_NT_TERMINATE_FAILED` | Failed to terminate task | | |
| -7008 | `ZWS_ERROR_NT_INVALID_MODEL_NAME` | Invalid model name | | |
| -7009 | `ZWS_ERROR_NT_INVALID_TASK_NUM` | Invalid task number | | |
| -7010 | `ZWS_ERROR_NT_INVALID_TASK_XML` | Invalid XML task file | | |
| -7011 | `ZWS_ERROR_NT_INVALID_REG_XML` | Invalid configuration for ZuluNetTools solver | | |
| -7012 | `ZWS_ERROR_NT_REG_XML_NOT_FOUND` | ZuluNetTools solver not configured | Модуль ZuluNetTools не зарегистрирован | Зарегистрировать модуль ZuluNetTools |
| -7013 | `ZWS_ERROR_NT_TASK_XML_NOT_FOUND` | | | |
| -7014 | `ZWS_ERROR_NT_CREATE_ZCNNNETWORK` | Failed to create Network Object | | |
| -7015 | `ZWS_ERROR_NT_OPEN_NETWORK` | Не открыть слой сети | | |
| -7016 | `ZWS_ERROR_NT_CREATE_ZCNTASKHYDRO` | Не создать задачу для ZuluHydro | | |
| -7017 | `ZWS_ERROR_NT_CREATE_ZCNTASKDRAIN` | Не создать задачу для ZuluDrain | | |
| -7018 | `ZWS_ERROR_NT_CREATE_ZCNTASKGAZ` | Не создать задачу для ZuluGaz | | |
| -7019 | `ZWS_ERROR_NT_CREATE_ZCNTASKSTEAM` | Не создать задачу для ZuluSteam | | |
| -7020 | `ZWS_ERROR_NT_TIMEOUT` | Request timeout | | |
| -7021 | `ZWS_ERROR_NT_INVALID_ELEM_ID` | Invalid Element ID | | |
| -7022 | `ZWS_ERROR_NT_INVALID_ELEM_IN_RING` | Pipe in ring | | |
| -7023 | `ZWS_ERROR_NT_INVALID_ELEM_NO_NODE` | Pipe has no node | | |
| -7024 | `ZWS_ERROR_NT_ELEM_OUT_OF_NETWORK` | Object is not a member of network | | |
| -7025 | `ZWS_ERROR_NT_SUBNET_NO_SOURCE` | Subnet has no source | В выбранной подсети нет источников | Проверить связанность сети или добавить источник |
| -7026 | `ZWS_ERROR_NT_REG_INVALID_PASS` | Corrupted password in ZuluNetTools configuration | | |
| -7027 | `ZWS_ERROR_NT_LAYER_ALREADY_EXIST` | Layer with specified name already exists | Слой с таким именем уже существует | Указать другое имя слоя |
| -7028 | `ZWS_ERROR_NT_CREATE_ZCNTASKTHERMO` | Не создать задачу для ZuluThermo | | |
| -7029 | `ZWS_ERROR_NT_FAILED_TO_RUN_TASK` | Failed to run task | | |

## Особые значения RetVal для команд с данными

- `RetVal < 0` — ошибка (см. таблицу выше)
- `RetVal = 0` — успех, но данных нет (0 записей/объектов)
- `RetVal > 0` — количество возвращённых записей/объектов

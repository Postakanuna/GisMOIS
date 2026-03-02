-- =====================================================
-- ГИС МО "Инженерные сети" — Полная схема базы данных
-- Версия: 1.0.0-rc.3
-- Дата обновления: 2026-03-02
--
-- Этот файл содержит ВСЕ таблицы приложения (25 шт.).
-- Безопасен для повторного применения (IF NOT EXISTS).
-- При добавлении новых таблиц/столбцов в schema.ts —
-- ОБЯЗАТЕЛЬНО обновляйте этот файл.
--
-- Применение на сервере:
--   psql -U postgres -d gis_mo -f migrations/init.sql
-- или через Drizzle:
--   npm run db:push
-- =====================================================

-- 1. Сессии (express-session + connect-pg-simple)
CREATE TABLE IF NOT EXISTS "sessions" (
  "sid" varchar PRIMARY KEY NOT NULL,
  "sess" jsonb NOT NULL,
  "expire" timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "sessions" USING btree ("expire");

-- 2. Пользователи
CREATE TABLE IF NOT EXISTS "users" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "username" varchar(50) NOT NULL,
  "password_hash" varchar(255) NOT NULL,
  "role" varchar(20) DEFAULT 'user' NOT NULL,
  "first_name" varchar,
  "last_name" varchar,
  "middle_name" varchar,
  "position" varchar,
  "organization" varchar,
  "phone" varchar,
  "email" varchar,
  "is_active" varchar(5) DEFAULT 'true' NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "users_username_unique" UNIQUE("username")
);

-- 3. Папки сцен
CREATE TABLE IF NOT EXISTS "scene_folders" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "name" text NOT NULL,
  "parent_id" integer,
  "created_by" varchar NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- 4. Сцены (проекты)
CREATE TABLE IF NOT EXISTS "scenes" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "name" text NOT NULL,
  "description" text,
  "folder_id" integer,
  "created_by" varchar NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- 5. Участники сцен (роли доступа)
CREATE TABLE IF NOT EXISTS "scene_members" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "scene_id" integer NOT NULL,
  "user_id" varchar NOT NULL,
  "role" text DEFAULT 'viewer' NOT NULL,
  "added_at" timestamp DEFAULT now() NOT NULL
);

-- 6. Папки слоёв
CREATE TABLE IF NOT EXISTS "layer_folders" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "scene_id" integer NOT NULL,
  "name" text NOT NULL,
  "visible" integer DEFAULT 1 NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- 7. Редактируемые слои
CREATE TABLE IF NOT EXISTS "editable_layers" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "scene_id" integer,
  "folder_id" integer,
  "name" text NOT NULL,
  "geometry_type" text NOT NULL,
  "color" text DEFAULT '#1976D2' NOT NULL,
  "point_style" text DEFAULT 'circle' NOT NULL,
  "line_style" text DEFAULT 'solid' NOT NULL,
  "visible" integer DEFAULT 1 NOT NULL,
  "opacity" real DEFAULT 1 NOT NULL,
  "feature_count" integer DEFAULT 0 NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "source" text DEFAULT 'user' NOT NULL,
  "source_file_name" text,
  "source_files" jsonb DEFAULT '[]'::jsonb,
  "crs" text DEFAULT 'EPSG:4326' NOT NULL,
  "style_config" jsonb,
  "metadata" jsonb,
  "network_type" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- 8. Объекты (геометрии) слоёв
CREATE TABLE IF NOT EXISTS "drawn_features" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "layer_id" integer NOT NULL,
  "geometry_type" text NOT NULL,
  "coordinates" jsonb NOT NULL,
  "properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "bbox_min_x" real,
  "bbox_min_y" real,
  "bbox_max_x" real,
  "bbox_max_y" real,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "drawn_features_layer_id_idx" ON "drawn_features" USING btree ("layer_id");
CREATE INDEX IF NOT EXISTS "drawn_features_bbox_idx" ON "drawn_features" USING btree ("layer_id", "bbox_min_x", "bbox_min_y", "bbox_max_x", "bbox_max_y");

-- 9. История изменений объектов
CREATE TABLE IF NOT EXISTS "feature_history" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "feature_id" integer NOT NULL,
  "layer_id" integer NOT NULL,
  "geometry_type" text NOT NULL,
  "coordinates" jsonb NOT NULL,
  "properties" jsonb NOT NULL,
  "version" integer NOT NULL,
  "action" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- 10. Схемы атрибутов слоёв
CREATE TABLE IF NOT EXISTS "layer_schemas" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "layer_id" integer NOT NULL,
  "fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "layer_schemas_layer_id_unique" UNIQUE("layer_id")
);

-- 11. Каталог датасетов (загруженные шейпфайлы)
CREATE TABLE IF NOT EXISTS "datasets" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "name" text NOT NULL,
  "original_filename" text NOT NULL,
  "geometry_type" text NOT NULL,
  "crs" text DEFAULT 'EPSG:4326',
  "field_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "feature_count" integer DEFAULT 0 NOT NULL,
  "created_by" varchar NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- 12. Объекты датасетов
CREATE TABLE IF NOT EXISTS "dataset_features" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "dataset_id" integer NOT NULL,
  "geometry_type" text NOT NULL,
  "coordinates" jsonb NOT NULL,
  "properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- 13. Привязка датасетов к сценам
CREATE TABLE IF NOT EXISTS "scene_datasets" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "scene_id" integer NOT NULL,
  "dataset_id" integer NOT NULL,
  "layer_name" text,
  "is_visible" integer DEFAULT 1 NOT NULL,
  "opacity" real DEFAULT 1 NOT NULL,
  "color" text DEFAULT '#1976D2' NOT NULL,
  "point_style" text DEFAULT 'circle' NOT NULL,
  "line_style" text DEFAULT 'solid' NOT NULL,
  "z_index" integer DEFAULT 0 NOT NULL,
  "added_at" timestamp DEFAULT now() NOT NULL
);

-- 14. Загрузки (статус фоновой обработки шейпфайлов)
-- Статусы: pending → processing → completed | failed
-- Фоновая обработка: файл принимается мгновенно (202),
-- парсинг и запись в БД идут асинхронно с обновлением прогресса.
CREATE TABLE IF NOT EXISTS "uploads" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "filename" text NOT NULL,
  "original_filename" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "error" text,
  "dataset_id" integer,
  "layer_id" integer,
  "progress" integer DEFAULT 0 NOT NULL,
  "total_features" integer,
  "processed_features" integer DEFAULT 0 NOT NULL,
  "scene_id" integer,
  "color" text,
  "created_by" varchar NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- 15. Пользовательские иконки (SVG)
CREATE TABLE IF NOT EXISTS "custom_icons" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "name" text NOT NULL,
  "svg_content" text NOT NULL,
  "category" text DEFAULT 'custom',
  "created_by" varchar,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- 16. API-ключи для внешних интеграций
CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "user_id" varchar NOT NULL,
  "name" text NOT NULL,
  "token_hash" varchar(255) NOT NULL,
  "scene_id" integer,
  "permissions" text[] DEFAULT ARRAY['create_point'] NOT NULL,
  "is_active" integer DEFAULT 1 NOT NULL,
  "last_used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- 17. Настройки приложения (key-value)
CREATE TABLE IF NOT EXISTS "app_settings" (
  "key" varchar(255) PRIMARY KEY NOT NULL,
  "value" text NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- 18. Журнал аудита
CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "user_id" varchar,
  "username" varchar,
  "action" varchar(100) NOT NULL,
  "entity_type" varchar(50),
  "entity_id" varchar(100),
  "scene_id" integer,
  "details" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "audit_log_user_id_idx" ON "audit_log" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "audit_log_action_idx" ON "audit_log" USING btree ("action");

-- 19. Отчёты об ошибках
CREATE TABLE IF NOT EXISTS "bug_reports" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "user_id" varchar NOT NULL,
  "username" varchar,
  "message" text NOT NULL,
  "screenshot_path" text,
  "status" varchar(50) DEFAULT 'new' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "bug_reports_user_id_idx" ON "bug_reports" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "bug_reports_status_idx" ON "bug_reports" USING btree ("status");
CREATE INDEX IF NOT EXISTS "bug_reports_created_at_idx" ON "bug_reports" USING btree ("created_at");

-- 20. Диалоги AI-ассистента
CREATE TABLE IF NOT EXISTS "conversations" (
  "id" serial PRIMARY KEY,
  "title" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 21. Сообщения AI-ассистента
CREATE TABLE IF NOT EXISTS "messages" (
  "id" serial PRIMARY KEY,
  "conversation_id" integer NOT NULL REFERENCES "conversations" ("id") ON DELETE CASCADE,
  "role" text NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 22. AI-провайдеры (настройки подключения к моделям)
CREATE TABLE IF NOT EXISTS "ai_providers" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "base_url" text,
  "api_key" text,
  "model" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "is_default" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 23. Конфигурация интеграции с датчиками ТИ
CREATE TABLE IF NOT EXISTS "sensor_integration_config" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "api_url" text NOT NULL DEFAULT 'https://mvitu.arki.mosreg.ru/api/edds/bot/koteln_last_sensors_state/index.php',
  "api_token" text NOT NULL DEFAULT '',
  "polling_interval_minutes" integer NOT NULL DEFAULT 15,
  "is_enabled" integer NOT NULL DEFAULT 0,
  "last_sync_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- 24. Привязки объектов карты к датчикам (устарело — используется sensor_id в properties)
-- Оставлена для обратной совместимости
CREATE TABLE IF NOT EXISTS "sensor_object_bindings" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "layer_id" integer NOT NULL,
  "feature_id" integer,
  "sensor_id" text NOT NULL,
  "sensor_name" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "sensor_object_bindings_layer_id_idx" ON "sensor_object_bindings" USING btree ("layer_id");
CREATE INDEX IF NOT EXISTS "sensor_object_bindings_sensor_id_idx" ON "sensor_object_bindings" USING btree ("sensor_id");

-- 25. Кэш показаний датчиков
CREATE TABLE IF NOT EXISTS "sensor_readings_cache" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "id_cds_koteln" integer NOT NULL,
  "name" text,
  "address" text,
  "sensors_state" text,
  "t1_in" real,
  "t1_out" real,
  "t2_in" real,
  "t2_out" real,
  "p1_in" real,
  "p1_out" real,
  "p2_in" real,
  "p2_out" real,
  "gvs_in" real,
  "gvs_out" real,
  "raw_data" jsonb,
  "synced_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "sensor_readings_cache_id_cds_koteln_unique" UNIQUE("id_cds_koteln")
);
CREATE INDEX IF NOT EXISTS "sensor_readings_cache_id_cds_koteln_idx" ON "sensor_readings_cache" USING btree ("id_cds_koteln");

-- =====================================================
-- Конец схемы. Итого: 25 таблиц.
-- При добавлении новых таблиц в shared/schema.ts или
-- shared/models/ — ОБЯЗАТЕЛЬНО добавляйте их сюда.
-- =====================================================

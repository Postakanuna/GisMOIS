CREATE TABLE "admin_layer_groups" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "admin_layer_groups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "api_keys_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"scene_id" integer,
	"permissions" text[] DEFAULT ARRAY['create_point'] NOT NULL,
	"is_active" integer DEFAULT 1 NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" varchar(255) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" varchar,
	"username" varchar,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(50),
	"entity_id" varchar(100),
	"scene_id" integer,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bug_reports" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bug_reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" varchar NOT NULL,
	"username" varchar,
	"message" text NOT NULL,
	"screenshot_path" text,
	"status" varchar(50) DEFAULT 'new' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_unit_rates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cost_unit_rates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"object_type" text NOT NULL,
	"laying_type" text,
	"diameter_mm" integer,
	"work_type" text NOT NULL,
	"price_per_unit" numeric(14, 2) NOT NULL,
	"unit" text NOT NULL,
	"base_year" integer DEFAULT 2025 NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_icons" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "custom_icons_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"svg_content" text NOT NULL,
	"category" text DEFAULT 'custom',
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dataset_features" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dataset_features_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"dataset_id" integer NOT NULL,
	"geometry_type" text NOT NULL,
	"coordinates" jsonb NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "datasets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "datasets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"original_filename" text NOT NULL,
	"geometry_type" text NOT NULL,
	"crs" text DEFAULT 'EPSG:4326',
	"field_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"feature_count" integer DEFAULT 0 NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drawn_features" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drawn_features_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
--> statement-breakpoint
CREATE TABLE "editable_layers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "editable_layers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"scene_id" integer,
	"folder_id" integer,
	"admin_group_id" integer,
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
--> statement-breakpoint
CREATE TABLE "feature_history" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "feature_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"feature_id" integer NOT NULL,
	"layer_id" integer NOT NULL,
	"geometry_type" text NOT NULL,
	"coordinates" jsonb NOT NULL,
	"properties" jsonb NOT NULL,
	"version" integer NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "layer_folders" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "layer_folders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"scene_id" integer NOT NULL,
	"name" text NOT NULL,
	"visible" integer DEFAULT 1 NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "layer_schemas" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "layer_schemas_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"layer_id" integer NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "layer_schemas_layer_id_unique" UNIQUE("layer_id")
);
--> statement-breakpoint
CREATE TABLE "program_objects" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "program_objects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"program_id" integer NOT NULL,
	"feature_id" integer,
	"object_type" text NOT NULL,
	"object_name" text NOT NULL,
	"diameter_mm" integer,
	"length_m" numeric(10, 2),
	"capacity_mw" numeric(10, 3),
	"laying_type" text,
	"work_type" text DEFAULT 'overhaul' NOT NULL,
	"unit_rate_id" integer,
	"unit_rate_value" numeric(14, 2),
	"base_cost" numeric(14, 2),
	"planned_year" integer,
	"indexed_cost" numeric(14, 2),
	"accident_count" integer,
	"accidents_per_m" numeric(10, 6),
	"resident_count" integer,
	"consumer_count" integer,
	"criticality_score" numeric(5, 2),
	"geometry" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconstruction_programs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reconstruction_programs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"scene_id" integer NOT NULL,
	"name" text NOT NULL,
	"period_from" integer NOT NULL,
	"period_to" integer NOT NULL,
	"base_year" integer DEFAULT 2025 NOT NULL,
	"inflation_rate" numeric(5, 2) DEFAULT '5.00' NOT NULL,
	"total_base_cost" numeric(14, 2),
	"total_indexed_cost" numeric(14, 2),
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scene_datasets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scene_datasets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
--> statement-breakpoint
CREATE TABLE "scene_folders" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scene_folders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"parent_id" integer,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scene_members" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scene_members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"scene_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scenes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"description" text,
	"folder_id" integer,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sensor_integration_config" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sensor_integration_config_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"api_url" text DEFAULT 'https://mvitu.arki.mosreg.ru/api/edds/bot/koteln_last_sensors_state/index.php' NOT NULL,
	"api_token" text DEFAULT '' NOT NULL,
	"polling_interval_minutes" integer DEFAULT 15 NOT NULL,
	"is_enabled" integer DEFAULT 0 NOT NULL,
	"is_debug_mode" integer DEFAULT 0 NOT NULL,
	"last_sync_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "sensor_object_bindings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sensor_object_bindings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"id_cds_koteln" integer NOT NULL,
	"object_type" text NOT NULL,
	"layer_id" integer NOT NULL,
	"object_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sensor_object_bindings_id_cds_koteln_unique" UNIQUE("id_cds_koteln")
);
--> statement-breakpoint
CREATE TABLE "sensor_readings_cache" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sensor_readings_cache_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"id_cds_koteln" integer NOT NULL,
	"mr_name" text,
	"place_name" text,
	"name_koteln" text,
	"address" text,
	"rso_name" text,
	"type" text,
	"mkd_count" integer,
	"mkd_people_count" integer,
	"active_claims" jsonb DEFAULT '[]'::jsonb,
	"sensors_state" text,
	"sensor_date" timestamp,
	"t_forward" real,
	"t_reverse" real,
	"p_forward" real,
	"p_revers" real,
	"responsibles" jsonb DEFAULT '[]'::jsonb,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sensor_readings_cache_id_cds_koteln_unique" UNIQUE("id_cds_koteln")
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "uploads_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
--> statement-breakpoint
CREATE TABLE "zulu_field_labels" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "zulu_field_labels_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"field_name" text NOT NULL,
	"label" text NOT NULL,
	"category" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "zulu_field_labels_field_name_unique" UNIQUE("field_name")
);
--> statement-breakpoint
CREATE TABLE "zulu_field_values" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "zulu_field_values_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"field_name" text NOT NULL,
	"field_value" text NOT NULL,
	"label" text NOT NULL,
	"category" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
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
--> statement-breakpoint
CREATE INDEX "audit_log_user_id_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "bug_reports_user_id_idx" ON "bug_reports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bug_reports_status_idx" ON "bug_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bug_reports_created_at_idx" ON "bug_reports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "drawn_features_layer_id_idx" ON "drawn_features" USING btree ("layer_id");--> statement-breakpoint
CREATE INDEX "drawn_features_bbox_idx" ON "drawn_features" USING btree ("layer_id","bbox_min_x","bbox_min_y","bbox_max_x","bbox_max_y");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");
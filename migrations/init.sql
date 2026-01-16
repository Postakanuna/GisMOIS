CREATE TABLE "dataset_features" (
        "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dataset_features_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
        "dataset_id" integer NOT NULL,
        "geometry_type" text NOT NULL,
        "coordinates" jsonb NOT NULL,
        "properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
);

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

CREATE TABLE "drawn_features" (
        "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drawn_features_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
        "layer_id" integer NOT NULL,
        "geometry_type" text NOT NULL,
        "coordinates" jsonb NOT NULL,
        "properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "version" integer DEFAULT 1 NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "editable_layers" (
        "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "editable_layers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
        "scene_id" integer,
        "name" text NOT NULL,
        "geometry_type" text NOT NULL,
        "color" text DEFAULT '#1976D2' NOT NULL,
        "point_style" text DEFAULT 'circle' NOT NULL,
        "line_style" text DEFAULT 'solid' NOT NULL,
        "visible" integer DEFAULT 1 NOT NULL,
        "opacity" real DEFAULT 1 NOT NULL,
        "feature_count" integer DEFAULT 0 NOT NULL,
        "source" text DEFAULT 'user' NOT NULL,
        "source_file_name" text,
        "source_files" jsonb DEFAULT '[]'::jsonb,
        "crs" text DEFAULT 'EPSG:4326' NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);

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

CREATE TABLE "layer_schemas" (
        "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "layer_schemas_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
        "layer_id" integer NOT NULL,
        "fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "layer_schemas_layer_id_unique" UNIQUE("layer_id")
);

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

CREATE TABLE "scene_members" (
        "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scene_members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
        "scene_id" integer NOT NULL,
        "user_id" varchar NOT NULL,
        "role" text DEFAULT 'viewer' NOT NULL,
        "added_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "scenes" (
        "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scenes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
        "name" text NOT NULL,
        "description" text,
        "created_by" varchar NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "uploads" (
        "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "uploads_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
        "filename" text NOT NULL,
        "original_filename" text NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "error" text,
        "dataset_id" integer,
        "created_by" varchar NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "sessions" (
        "sid" varchar PRIMARY KEY NOT NULL,
        "sess" jsonb NOT NULL,
        "expire" timestamp NOT NULL
);

CREATE TABLE "users" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "username" varchar(50) NOT NULL,
        "password_hash" varchar(255) NOT NULL,
        "role" varchar(20) DEFAULT 'user' NOT NULL,
        "first_name" varchar,
        "last_name" varchar,
        "email" varchar,
        "is_active" varchar(5) DEFAULT 'true' NOT NULL,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now(),
        CONSTRAINT "users_username_unique" UNIQUE("username")
);

CREATE TABLE "api_keys" (
        "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "api_keys_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
        "user_id" varchar NOT NULL,
        "name" varchar NOT NULL,
        "token_hash" varchar NOT NULL,
        "scene_id" integer,
        "permissions" text[] DEFAULT ARRAY['create_point'],
        "is_active" integer DEFAULT 1,
        "last_used_at" timestamp,
        "created_at" timestamp DEFAULT now()
);

CREATE INDEX "drawn_features_layer_id_idx" ON "drawn_features" USING btree ("layer_id");
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");

ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "scenes"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
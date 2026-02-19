# ГИС МО "Инженерные сети"

## Overview

ГИС МО "Инженерные сети" is a web application for managing engineering infrastructure using a multi-scene architecture. It is designed for visualizing cartographic data via WMS/WFS APIs, layer management, object information display, and shapefile layer uploads. The application centers around an interactive map with control elements on a sidebar, aiming to be a powerful and user-friendly tool for geospatial data, supporting GOST standards for icons and thermal network styles. It integrates business vision for market potential and project ambitions to provide a comprehensive GIS solution.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend

The frontend is built with React 18 and TypeScript, using Vite. It's a single-page application with Wouter for routing. State management relies on React Query for server-side data and React Hooks for local state. UI components are built with shadcn/ui (based on Radix UI) and styled using Tailwind CSS, supporting light/dark themes. The design adheres to Material Design 3 principles, optimized for data-intensive applications. A `SceneContext` manages the current scene's state.

Map rendering is handled by OpenLayers (ol) library, supporting WMS/WFS layers from ZuluServer and OpenStreetMap as a base. Key features include zoom control, coordinate display, and object information on click. It renders GeoJSON data, optimizes feature loading by viewport with geometry simplification and clustering, and supports "properties-on-demand." Attribute styling (QGIS/ArcGIS-like) includes single, categorized, and graduated renderers, configurable via `StyleConfigDialog`, with `MapLegend` displaying active styles.

Key frontend components include `MapViewer` for the map, `DataManager` for dataset management, and `ScenesPage` for scene selection.

### Backend

The backend uses Node.js with Express and TypeScript. It provides a REST API (`/api/`) supporting multi-scene architecture with role-based access. Features include universal tracing (`/api/trace-route`), optimized shapefile uploads with CP1251 encoding, and an external API with key management for integrations (e.g., Telegram bot, ARM ARKI). Cross-scene search and geospatial analytics (`/api/analytics/geospatial`) are supported, offering configurable reports. Layer attributes can be easily accessed (`/api/editable-layers/:id/attributes`), with Russian localization for GIS Zulu fields. Attribute value endpoints (`/api/editable-layers/:id/attribute-values`) provide unique values for filtering, and filtered object counts are available (`/api/editable-layers/:id/count-filtered`). Layer export supports GeoJSON and Shapefile formats.

### Storage

Data is stored in PostgreSQL, managed by Drizzle ORM. Schemas are defined for users, scenes, scene members, datasets, and API keys, with Zod for schema validation. Indexing is used for query optimization.

### Build System

Development uses Vite dev server with HMR and Express proxy. Production builds frontend with Vite and backend with esbuild.

### Project Structure

The project is organized into `client/` (React app), `server/` (Express backend), `shared/` (common types/schemas), and `migrations/` (database migrations).

### Database Schema

Key tables include `users`, `scenes`, `scene_members`, `datasets`, `scene_datasets`, `dataset_features`, and `api_keys` (with permissions like `create_point`, `read_layers`, `read_scenes`, `spatial_query`).

### Advanced Styling

The application offers extensive styling options:
- **Point Styles**: Basic shapes (circle, square) and GOST-compliant thermal network icons (heat-source, ctp, itp). Custom SVG icons are supported.
- **Line Styles**: Basic patterns (solid, dashed) and GOST-compliant thermal network styles (relaying, bypass).
- **Per-class Styling**: Categorized and graduated renderers allow assigning specific point and line styles to individual classes. `IconPicker` and `LinePicker` components facilitate this, and `MapLegend` accurately displays per-class symbols.

### Geocoding (Multi-Provider)

Two geocoding providers are supported: Yandex Geocoder and DaData, configurable in settings.
- **Yandex Geocoder**: High request rate, requires `YANDEX_GEOCODER_API_KEY`.
- **DaData**: Returns FIAS ID in addition to coordinates, requires `DADATA_API_KEY`.
The chosen provider influences both Excel import (address to coordinates) and reverse geocoding (coordinates to address), adding specific attributes like `fias_id`. The geocoding service ensures all coordinates are in EPSG:4326 (WGS84).

### Reverse Geocoding

This feature enriches layer attributes with address information based on coordinates. It can be initiated from the data manager, showing a progress bar and allowing cancellation. For linear objects, `addr_begin` and `addr_end` fields are populated, while point objects get `addr_point`. DaData integration also adds `fias_begin`/`fias_end`/`fias_point`. Field names are compatible with Shapefile constraints (≤10 characters, Latin alphabet), with Russian descriptions provided via `shared/field-labels.ts`. The process intelligently skips objects with already filled address fields.

## External Dependencies

### Third-Party Services

- **ZuluServer**: External GIS server providing WMS/WFS cartographic services, proxied by the backend to handle CORS and authentication.
- **Yandex Geocoder**: Optional geocoding service.
- **DaData**: Optional geocoding service, offering additional FIAS ID.

### Database

- **PostgreSQL**: Used for all persistent data storage, configured via Drizzle ORM.

### Key Libraries

- **OpenLayers**: Core library for interactive map rendering and GIS functionalities.
- **React Query**: Manages server state and caching for the frontend.
- **Radix UI**: Provides accessible UI primitives, foundational for shadcn/ui components.
- **Zod**: Used for robust type validation of API requests and database schemas.
- **Drizzle ORM**: Enables type-safe database queries and schema management.
- **shpjs**: Parses Shapefile data, including support for various encodings.
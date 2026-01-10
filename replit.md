# ГИС МО "Инженерные сети"

## Overview

ГИС МО "Инженерные сети" — веб-приложение для управления инженерной инфраструктурой с мультисценовой архитектурой. Система позволяет визуализировать данные карт через WMS/WFS API, управлять слоями, отображать информацию об объектах и загружать shapefile-слои. Интерфейс построен по принципу "карта в центре внимания", где интерактивная карта занимает основное пространство, а управляющие элементы расположены в боковой панели.

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Changes (January 2026)

- Added multi-scene architecture: users can create separate project scenes
- Implemented scene selection page after login
- Added Data Manager (draggable modal) for managing datasets
- Shapefile upload with CP1251 encoding support through Data Manager
- Role-based access control (owner/editor/viewer) for scenes
- **Unified editable layers architecture**: imported shapefiles and hand-drawn layers are unified into single editable layer system
- Editable layers are scene-scoped (sceneId field) for multi-scene support
- Import creates editable_layer + drawn_features instead of deprecated dataset approach
- CRUD API for layer features (POST/PATCH/DELETE endpoints)
- **Removed facility-specific tracing** (building/boilerhouse/waterintake entities removed)
- **Added universal object-to-object tracing**: `/api/trace-route` endpoint finds nearest object in target layer and builds OSRM route
- **Large file upload optimization**: 
  - Hybrid upload: files >10MB use server-side disk storage, smaller files use client-side parsing
  - Multer disk storage with temp file cleanup
  - File extension validation (.zip, .shp)
  - Chunked batch inserts (1000 features per batch) to avoid memory issues
- **Viewport-based feature loading (optimized January 2026)**:
  - `/api/editable-layers/:id/features/viewport` with bbox filtering, zoom-based simplification, and feature limit (5000)
  - `/api/datasets/:id/features/viewport` - same optimization for scene datasets
  - Frontend uses debounced `moveend` events (300ms) to trigger viewport-based refetches
  - React Query caching (gcTime: 2 min, staleTime: 30s) with `placeholderData` for seamless viewport transitions
  - Loading indicator during feature fetch, warning when 5000 feature limit reached
- **Point layer clustering**: 
  - Automatic clustering for Point layers with 50+ features at zoom < 14
  - OpenLayers Cluster source with 40px distance threshold
  - Dynamic cluster style showing feature count with logarithmic radius scaling
  - Automatic switching between clustered/non-clustered modes on zoom change
- **Geometry simplification**: Zoom-based LOD with polygon ring closure preservation
- **Database optimization**: Index on drawn_features(layer_id) for query performance

## System Architecture

### Frontend Architecture

**Framework**: React 18 with TypeScript, built using Vite
- Single-page application with client-side routing via Wouter
- State management using React Query for server state and React hooks for local state
- Component library: shadcn/ui built on Radix UI primitives
- Styling: Tailwind CSS with CSS variables for theming (light/dark mode support)
- Design system follows Material Design 3 principles for data-heavy productivity applications
- Scene context (SceneContext) for managing current scene state

**Map Rendering**: OpenLayers (ol) library
- Supports WMS and WFS layer types from ZuluServer
- OpenStreetMap as the default base layer
- Interactive features: zoom controls, coordinate display, feature info on click
- Scene datasets rendering with GeoJSON format

**Key Frontend Components**:
- `MapViewer`: Core map component using OpenLayers, renders scene datasets
- `ConnectionForm`: Server connection configuration
- `LayerPanel`: Layer visibility and opacity controls, scene datasets section
- `FeatureInfoPanel`: Display clicked feature attributes
- `DataManager`: Draggable modal for dataset management (ArcGIS/QGIS style)
- `ScenesPage`: Scene selection and management after login
- Sidebar layout with responsive mobile sheet variant

### Backend Architecture

**Runtime**: Node.js with Express
- TypeScript compiled with tsx for development, esbuild for production
- Single entry point at `server/index.ts`
- Proxy endpoints for ZuluServer API calls (avoids CORS issues)

**API Design**:
- REST endpoints prefixed with `/api/`
- Scene endpoints: `/api/scenes`, `/api/scenes/:id/datasets`, `/api/scenes/:id/members`
- Dataset endpoints: `/api/datasets`, `/api/datasets/:id/features`, `/api/datasets/import`
- `POST /api/zulu/capabilities`: Fetches WMS capabilities from ZuluServer
- `POST /api/trace-route`: Universal tracing - finds nearest feature in target layer and builds OSRM route

**Storage**: PostgreSQL with Drizzle ORM
- User schema, scenes, scene_members, datasets, scene_datasets, dataset_features
- Schema validation using Zod with drizzle-zod integration
- Role-based access control: owner, editor, viewer

### Build System

**Development**: Vite dev server with HMR, proxied through Express
**Production**: 
- Frontend built with Vite to `dist/public`
- Backend bundled with esbuild to `dist/index.cjs`
- Selected dependencies bundled to reduce cold start syscalls

### Project Structure

```
client/           # Frontend React application
  src/
    components/   # UI components including shadcn/ui, DataManager
    contexts/     # React contexts (SceneContext)
    hooks/        # Custom React hooks
    pages/        # Route page components (home, scenes)
    lib/          # Utilities and query client
server/           # Express backend
shared/           # Shared types and schemas (Zod + Drizzle)
migrations/       # Database migrations
```

## Database Schema

### Core Tables
- `users`: User accounts with roles (admin, user)
- `scenes`: Project scenes with name, description, owner
- `scene_members`: Scene access control (role: owner, editor, viewer)
- `datasets`: Uploaded shapefile datasets with geometry type, CRS, feature count
- `scene_datasets`: Links datasets to scenes with styling (color, opacity, visibility)
- `dataset_features`: Individual features with geometry (coordinates) and properties

## External Dependencies

### Third-Party Services

**ZuluServer**: External GIS server providing WMS/WFS map services
- Connection requires host, port, and layer name
- Backend proxies requests to handle authentication and CORS
- Supports GetCapabilities, GetMap (WMS), and GetFeatureInfo requests

### Database

**PostgreSQL**: Configured via Drizzle ORM
- Connection string from `DATABASE_URL` environment variable
- Migrations stored in `/migrations` directory
- Schema defined in `shared/schema.ts`

### Key Libraries

- **OpenLayers**: Interactive map rendering and GIS functionality
- **React Query**: Server state management and caching
- **Radix UI**: Accessible UI primitives for shadcn/ui components
- **Zod**: Runtime type validation for API requests and schemas
- **Drizzle ORM**: Type-safe database queries and schema management
- **shpjs**: Shapefile parsing with encoding support

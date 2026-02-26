# ГИС МО "Инженерные сети"

## Overview

ГИС МО "Инженерные сети" is a web application for managing engineering infrastructure using a multi-scene architecture. It provides tools for visualizing cartographic data (WMS/WFS), layer management, object information display, and shapefile uploads. The application features an interactive map with a sidebar for control elements, aiming to be a powerful and user-friendly tool for geospatial data, supporting GOST standards for icons and thermal network styles. It integrates business vision for market potential and project ambitions to provide a comprehensive GIS solution.

## Versioning

Current version: 1.0.0-rc.1
Versioning standard: Semantic Versioning (SemVer) — MAJOR.MINOR.PATCH
Changelog: CHANGELOG.md — all significant changes are documented with version numbers and dates.
Version display: shown in the bottom-right corner of the main page (home.tsx).
After Rospatent registration, version will be updated to 1.0.0.

## Rospatent Registration

Deposited materials are located in `docs/rospatent/`:
- 01_referat.txt — Program abstract
- 02_opisanie_programmy.txt — Program description
- 03_listing_first_25_pages.txt — Source code listing (first 25 pages)
- 03_listing_last_25_pages.txt — Source code listing (last 25 pages)
- 04_dannye_dlya_zayavleniya.txt — Application form data

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend

The frontend is a React 18, TypeScript, and Vite-based single-page application using Wouter for routing. State management relies on React Query and React Hooks. UI components are built with shadcn/ui (Radix UI) and styled with Tailwind CSS, supporting light/dark themes and Material Design 3 principles. Map rendering is handled by OpenLayers, supporting WMS/WFS layers from ZuluServer and OpenStreetMap. It includes features like zoom, coordinate display, GeoJSON rendering with viewport optimization, and "properties-on-demand." Attribute styling (single, categorized, graduated renderers) is configurable via `StyleConfigDialog`.

Key components include `MapViewer`, `DataManager`, `ScenesPage`, and `AdminLayerManager` for cross-scene layer management. The `AdminLayerManager` provides a matrix view to manage layers across scenes, allowing quick cloning, bulk cloning, removal, and unified style palette configuration.

### Backend

The backend uses Node.js with Express and TypeScript, providing a REST API (`/api/`) that supports multi-scene architecture and role-based access. It features universal tracing, optimized shapefile uploads (CP1251 encoding), an external API with key management, cross-scene search, and geospatial analytics. It handles layer attribute access, unique attribute values for filtering, and filtered object counts. Layer export supports GeoJSON and Shapefile formats.

#### Upload Protection

File upload limits: shapefiles up to 1 GB, Excel up to 200 MB, screenshots up to 10 MB. Files larger than 100 MB (shapefiles/GeoJSON) or 50 MB (Excel) require admin role. Rate limiting: max 5 uploads per minute per user. ZIP archives are validated for SHP content before processing (magic bytes + ZIP entry scan). Implemented in `server/routes.ts` via `checkUploadRateLimit()` and `validateShapefileBuffer()`.

### Storage

Data is stored in PostgreSQL, managed by Drizzle ORM, with schemas for users, scenes, datasets, and API keys, validated using Zod.

### Geocoding

The system supports multi-provider geocoding (Yandex Geocoder and DaData) for converting addresses to coordinates and vice-versa, enriching layer attributes with address information, including FIAS IDs from DaData. All coordinates are normalized to EPSG:4326 (WGS84).

**Chunked processing**: Batch geocoding processes objects in chunks of 50, saving results to DB after each chunk. This prevents data loss on interruption and allows resuming from where it stopped. Layer schema (attribute columns) is updated before processing starts so columns appear immediately. SSE progress events are throttled (max every 2 seconds or per chunk) to prevent frontend UI freezes. Frontend uses `requestAnimationFrame` to batch React state updates. Duplicate geocoding requests for the same layer are rejected (in-memory `activeGeocodeLayers` set).

### Advanced Styling

Extensive styling options are available for points (basic shapes, GOST-compliant thermal network icons, custom SVGs) and lines (basic patterns, GOST-compliant thermal network styles). Per-class styling with categorized and graduated renderers allows assigning specific styles, facilitated by `IconPicker` and `LinePicker` components.

### Network Type Badges (Manual Layer Classification)

Each editable layer can be manually assigned a `networkType` (stored in the `network_type` column of `editable_layers`). Supported types: `source` (Источник), `ctp` (ЦТП), `consumer` (Потребитель), `segment` (Участок), `valve` (Задвижка), `node` (Узел), `pump` (Насос), or `null` (auto-classify). Manual type assignment takes priority over the heuristic `classifyLayerByContentSync` function in `network-graph.ts`. When `networkType` is null, the old auto-classification is used as fallback. UI: colored badges in layer panel, Select dropdown in layer popover, bulk assignment in AdminLayerManager.

### Automatic Consumer Connection

This feature automates connecting new heat consumers to the network. Users place a point, input consumer data (name, address, building type, thermal loads), and the system automatically traces the nearest connection point, routes along roads using OSRM, places heat chambers, and calculates pipe parameters using an AI model (OpenAI gpt-4o-mini) or heuristic fallback. Results include route details, AI-calculated parameters, heat chamber placements, and capacity analysis. Users can confirm and update the point or save the route and chambers as new layers.

#### Capacity Analysis

The system includes intelligent capacity analysis to find upstream CTP/source, extract capacity data, calculate downstream load, and check pipe capacity against existing diameters. It provides `installedCapacity`, `connectedLoadFromAttributes`, `currentLoadFromConsumers`, `surplus`, `capacityUnknown` flags, and pipe issue warnings.

### Complaint Analysis (Multi-Layer)

Analyzes complaint data from up to 5 point layers simultaneously. Each layer can have its own date and address field mapping. Two modes:

**Topology mode**: Matches complaints to consumers by address+proximity (improved address matching strips regional prefixes, extracts street+house for comparison). Groups consumers with complaints by date + spatial proximity (DBSCAN-like clustering with `matchRadius × 5`). Clusters with fewer than 2 unique consumers are filtered out as "unclustered" (single complaint doesn't indicate network problem). For valid clusters, finds LCA (least common ancestor) in the BFS tree from the source, counts ALL downstream consumers, calculates probability = complaining/total downstream × 100%. Results sorted by complaint count (descending).

**No-topology mode**: Spatial clustering by date + radius.

Results include `layerBreakdown` per cluster/group, `uniqueConsumerCount`, `clusterId`, `clusterCenter`. `unclustered` array holds single-consumer matches. API accepts `complaintLayers: [{layerId, dateField, addressField}]` with backward compatibility for single-layer `complaintLayerId` format.

### Attribute Join

This feature allows enriching layer data from XLSX files by matching key fields from the layer with key columns from the Excel file, similar to a database table join.

### Bug Report System

Users can submit bug reports via a floating button (bug icon) in the bottom-right corner on map and scene pages. The report includes a text description and an optional screenshot. Administrators manage bug reports through the "Сведения об ошибках" tab on the admin settings page, where they can view reports, screenshots, and set statuses (new, rejected, in_progress, fixed, paused). Data stored in `bug_reports` table. Components: `BugReportButton`, `BugReportsPanel`.

### AI Assistant

An integrated AI chat panel allows users to interact with an AI assistant. It supports message history, text input, action buttons, and a dynamic provider management system. Administrators can create custom AI providers using the OpenAI API protocol (supports OpenAI, local LMStudio, Ollama, and any OpenAI-compatible endpoint). Providers are managed via the admin panel with CRUD operations, connection testing, and a global enable/disable toggle. When the AI agent is disabled, users see a message directing them to contact support. A Retrieval-Augmented Generation (RAG) system automatically injects relevant GIS object data from `drawn_features` and `editable_layers` into the AI's system prompt, enabling data-aware responses. The RAG context is scene-aware: it filters layers and objects by the current scene's `scene_id`, and includes layer IDs, `networkType` labels (Источник, ЦТП, Потребитель, etc.), and attribute column names for each layer. The layers summary cache is keyed by sceneId (TTL 2 min). Provider configuration is stored in the `ai_providers` database table.

#### AI-Triggered Complaint Analysis

The AI agent can automatically trigger complaint analysis (no-topology mode) when the user asks about analyzing complaints. The flow:
1. AI analyzes available layers in the RAG context and finds a complaint layer by name keywords, identifies the date column from layer attributes.
2. AI responds with details about the found layer/date field and appends a marker `[ACTION:COMPLAINT_ANALYSIS:layerId:dateField]`.
3. Frontend parses the marker, strips it from display, and shows a "Начать анализ" button.
4. On click, frontend calls `POST /api/ai/run-complaint-analysis` with `{ layerId, dateField }`, which runs `analyzeComplaintsNoTopology` with 350m radius.
5. Results are displayed with a "Показать результат" button that opens the `ComplaintAnalysisDialog` with pre-loaded results via `initialNoTopoResult` prop.
Chat messages support an `action` field (`ChatAction` type) for interactive buttons.

## External Dependencies

### Third-Party Services

-   **ZuluServer**: External GIS server for WMS/WFS services.
-   **Yandex Geocoder**: Optional geocoding service.
-   **DaData**: Optional geocoding service, providing FIAS IDs.
-   **OSRM (router.project-osrm.org)**: Routing service for automatic consumer connection.
-   **OpenAI**: AI provider for automatic consumer connection parameter calculation and the AI Assistant.

### Database

-   **PostgreSQL**: Primary database for all persistent data storage.

### Key Libraries

-   **OpenLayers**: Core map rendering and GIS functionality.
-   **React Query**: Frontend server state management.
-   **Radix UI**: Accessible UI primitives.
-   **Zod**: Type validation for APIs and schemas.
-   **Drizzle ORM**: Type-safe database queries.
-   **shpjs**: Shapefile parsing.
-   **ExcelJS**: XLSX file parsing.
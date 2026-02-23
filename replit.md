# ГИС МО "Инженерные сети"

## Overview

ГИС МО "Инженерные сети" is a web application for managing engineering infrastructure using a multi-scene architecture. It provides tools for visualizing cartographic data (WMS/WFS), layer management, object information display, and shapefile uploads. The application features an interactive map with a sidebar for control elements, aiming to be a powerful and user-friendly tool for geospatial data, supporting GOST standards for icons and thermal network styles. It integrates business vision for market potential and project ambitions to provide a comprehensive GIS solution.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend

The frontend is a React 18, TypeScript, and Vite-based single-page application using Wouter for routing. State management relies on React Query and React Hooks. UI components are built with shadcn/ui (Radix UI) and styled with Tailwind CSS, supporting light/dark themes and Material Design 3 principles. Map rendering is handled by OpenLayers, supporting WMS/WFS layers from ZuluServer and OpenStreetMap. It includes features like zoom, coordinate display, GeoJSON rendering with viewport optimization, and "properties-on-demand." Attribute styling (single, categorized, graduated renderers) is configurable via `StyleConfigDialog`.

Key components include `MapViewer`, `DataManager`, `ScenesPage`, and `AdminLayerManager` for cross-scene layer management. The `AdminLayerManager` provides a matrix view to manage layers across scenes, allowing quick cloning, bulk cloning, removal, and unified style palette configuration.

### Backend

The backend uses Node.js with Express and TypeScript, providing a REST API (`/api/`) that supports multi-scene architecture and role-based access. It features universal tracing, optimized shapefile uploads (CP1251 encoding), an external API with key management, cross-scene search, and geospatial analytics. It handles layer attribute access, unique attribute values for filtering, and filtered object counts. Layer export supports GeoJSON and Shapefile formats.

### Storage

Data is stored in PostgreSQL, managed by Drizzle ORM, with schemas for users, scenes, datasets, and API keys, validated using Zod.

### Geocoding

The system supports multi-provider geocoding (Yandex Geocoder and DaData) for converting addresses to coordinates and vice-versa, enriching layer attributes with address information, including FIAS IDs from DaData. All coordinates are normalized to EPSG:4326 (WGS84).

### Advanced Styling

Extensive styling options are available for points (basic shapes, GOST-compliant thermal network icons, custom SVGs) and lines (basic patterns, GOST-compliant thermal network styles). Per-class styling with categorized and graduated renderers allows assigning specific styles, facilitated by `IconPicker` and `LinePicker` components.

### Automatic Consumer Connection

This feature automates connecting new heat consumers to the network. Users place a point, input consumer data (name, address, building type, thermal loads), and the system automatically traces the nearest connection point, routes along roads using OSRM, places heat chambers, and calculates pipe parameters using an AI model (OpenAI gpt-4o-mini) or heuristic fallback. Results include route details, AI-calculated parameters, heat chamber placements, and capacity analysis. Users can confirm and update the point or save the route and chambers as new layers.

#### Capacity Analysis

The system includes intelligent capacity analysis to find upstream CTP/source, extract capacity data, calculate downstream load, and check pipe capacity against existing diameters. It provides `installedCapacity`, `connectedLoadFromAttributes`, `currentLoadFromConsumers`, `surplus`, `capacityUnknown` flags, and pipe issue warnings.

### Attribute Join

This feature allows enriching layer data from XLSX files by matching key fields from the layer with key columns from the Excel file, similar to a database table join.

### Bug Report System

Users can submit bug reports via a floating button (bug icon) in the bottom-right corner on map and scene pages. The report includes a text description and an optional screenshot. Administrators manage bug reports through the "Сведения об ошибках" tab on the admin settings page, where they can view reports, screenshots, and set statuses (new, rejected, in_progress, fixed, paused). Data stored in `bug_reports` table. Components: `BugReportButton`, `BugReportsPanel`.

### AI Assistant

An integrated AI chat panel allows users to interact with an AI assistant. It supports message history, text input, and dual AI providers (OpenAI GPT-4o-mini and Yandex GPT-Lite) with an in-chat model switcher. A Retrieval-Augmented Generation (RAG) system automatically injects relevant GIS object data from `drawn_features` and `editable_layers` into the AI's system prompt, enabling data-aware responses.

## External Dependencies

### Third-Party Services

-   **ZuluServer**: External GIS server for WMS/WFS services.
-   **Yandex Geocoder**: Optional geocoding service.
-   **DaData**: Optional geocoding service, providing FIAS IDs.
-   **OSRM (router.project-osrm.org)**: Routing service for automatic consumer connection.
-   **OpenAI**: AI provider for automatic consumer connection parameter calculation and the AI Assistant.
-   **Yandex GPT**: AI provider for the AI Assistant.

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
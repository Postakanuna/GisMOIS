# GIS ZULU Web Application

## Overview

GIS ZULU Web is a web-based geospatial information system for connecting to and visualizing map data from ZuluServer through WMS/WFS APIs. The application provides an interactive map viewer with layer management, feature information display, and server connection configuration. The interface is designed with a map-first layout where the interactive map occupies the primary viewport space, with supporting controls in a sidebar.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework**: React 18 with TypeScript, built using Vite
- Single-page application with client-side routing via Wouter
- State management using React Query for server state and React hooks for local state
- Component library: shadcn/ui built on Radix UI primitives
- Styling: Tailwind CSS with CSS variables for theming (light/dark mode support)
- Design system follows Material Design 3 principles for data-heavy productivity applications

**Map Rendering**: OpenLayers (ol) library
- Supports WMS and WFS layer types from ZuluServer
- OpenStreetMap as the default base layer
- Interactive features: zoom controls, coordinate display, feature info on click

**Key Frontend Components**:
- `MapViewer`: Core map component using OpenLayers
- `ConnectionForm`: Server connection configuration
- `LayerPanel`: Layer visibility and opacity controls
- `FeatureInfoPanel`: Display clicked feature attributes
- Sidebar layout with responsive mobile sheet variant

### Backend Architecture

**Runtime**: Node.js with Express
- TypeScript compiled with tsx for development, esbuild for production
- Single entry point at `server/index.ts`
- Proxy endpoints for ZuluServer API calls (avoids CORS issues)

**API Design**:
- REST endpoints prefixed with `/api/`
- `POST /api/zulu/capabilities`: Fetches WMS capabilities from ZuluServer and parses available layers

**Storage**: In-memory storage class with interface for future database integration
- User schema defined with Drizzle ORM (prepared for PostgreSQL)
- Schema validation using Zod with drizzle-zod integration

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
    components/   # UI components including shadcn/ui
    hooks/        # Custom React hooks
    pages/        # Route page components
    lib/          # Utilities and query client
server/           # Express backend
shared/           # Shared types and schemas (Zod + Drizzle)
```

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
- Currently using in-memory storage; database ready for future provisioning

### Key Libraries

- **OpenLayers**: Interactive map rendering and GIS functionality
- **React Query**: Server state management and caching
- **Radix UI**: Accessible UI primitives for shadcn/ui components
- **Zod**: Runtime type validation for API requests and schemas
- **Drizzle ORM**: Type-safe database queries and schema management
# Design Guidelines: ГИС МО "Инженерные сети"

## Design Approach
**System**: Material Design 3  
**Rationale**: Ideal for data-heavy, productivity-focused applications with strong visual hierarchy and component clarity. Material Design's elevation system and component patterns work exceptionally well for GIS interfaces where the map is the primary focus and controls must be accessible without obstruction.

**Key Principles**:
- Map-first layout: Interactive map occupies primary viewport space
- Functional hierarchy: Controls support map interaction without competing for attention
- Technical professionalism: Clean, data-focused aesthetic appropriate for GIS workflows
- Efficient workflows: Minimize clicks for common tasks (layer switching, zoom controls)

---

## Typography

**Font Families**:
- Primary: Inter (Google Fonts) - UI elements, labels, controls
- Monospace: 'Roboto Mono' - Coordinates, technical data, API responses

**Hierarchy**:
- H1 (text-2xl, font-semibold): Page title, panel headers
- H2 (text-lg, font-medium): Section titles, layer group names
- Body (text-sm, font-normal): Form labels, descriptions, attribute data
- Caption (text-xs, font-normal): Metadata, coordinates, technical info
- Code (text-xs, font-mono): API endpoints, server configurations

---

## Layout System

**Spacing Primitives**: Use Tailwind units of **2, 4, 8, 12, 16** for consistency
- Component padding: p-4
- Section spacing: gap-8, space-y-8
- Tight groupings: gap-2, space-y-2
- Panel margins: m-4

**Layout Architecture**:
- Full-height viewport (h-screen)
- Sidebar: Fixed width 320px (w-80), left-aligned
- Map container: flex-1, fills remaining space
- Top toolbar: h-14, fixed position
- Bottom info bar: h-10, coordinates/scale display

---

## Component Library

### Navigation & Controls
**Top Toolbar** (h-14, border-b):
- App title/logo (left)
- Connection status indicator (center)
- User actions/settings (right)

**Sidebar Panel** (w-80, h-full, overflow-y-auto):
- Collapsible sections using accordion pattern
- Server configuration form at top
- Layer controls with checkboxes and opacity sliders
- Object attribute viewer panel (conditional display)

**Map Controls** (absolute positioned overlays):
- Zoom buttons: top-right, gap-2 vertical stack
- Layer switcher: bottom-left
- Scale bar: bottom-center
- Coordinate display: bottom-right corner

### Forms
**Connection Configuration**:
- Input fields for: host, port, layer name
- Connect/Disconnect toggle button
- Save configuration option
- Status message display area

**Input Fields**:
- Label above input (text-sm, font-medium)
- Input height: h-10
- Border: border, rounded-md
- Focus state: ring-2
- Helper text below (text-xs)

### Data Display
**Layer List**:
- Checkbox + layer name + visibility icon
- Nested structure for layer groups
- Drag handle for reordering
- Context menu on right-click

**Attribute Table** (when object selected):
- Two-column layout: property name | value
- Striped rows for readability
- Monospace font for numeric values
- Copy-to-clipboard buttons for coordinates

**Info Popup** (map overlay):
- Appears on feature click
- Card-style with subtle shadow
- Close button top-right
- Compact attribute display
- Action buttons at bottom

### Overlays
**Loading States**:
- Spinner overlay on map during WMS requests
- Skeleton loaders in sidebar during data fetch
- Progress indicator for large datasets

**Modal Dialogs**:
- Settings configuration
- Error messages
- Layer metadata viewer
- Centered, max-w-2xl, backdrop blur

---

## Map-Specific Design

**Map Container**:
- Full remaining viewport height
- No background patterns (let map tiles show)
- Subtle border separating from sidebar

**Map Overlays**:
- Controls have semi-transparent white background with backdrop blur
- Shadows for elevation: shadow-lg
- Rounded corners: rounded-lg
- Proper spacing from edges: 16px margin

**Interactive States**:
- Feature hover: subtle highlight (cursor pointer)
- Feature selected: bold stroke, elevated appearance
- Drawing mode: crosshair cursor

---

## Images

**No hero images required** - this is a utility application. The interactive map IS the visual centerpiece.

**Icon Usage**:
- Use Material Icons (CDN) throughout
- Layer icons: map, layers, satellite
- Control icons: zoom_in, zoom_out, my_location, settings
- Data icons: info, table_chart, download
- Action icons: refresh, save, delete

---

## Accessibility & Polish

**Focus Management**:
- Visible focus rings on all interactive elements
- Keyboard navigation for map controls (arrow keys for pan)
- Tab order: toolbar → sidebar → map controls

**Responsive Behavior**:
- Sidebar collapses to overlay drawer on mobile (< 768px)
- Map controls stack vertically on small screens
- Touch-friendly button sizes (min h-10, w-10)

**Professional Details**:
- Consistent 8px grid alignment
- Subtle transitions (150ms) for panel expansions
- No excessive animations - keep interface snappy
- Clear loading states prevent user confusion
- Coordinate precision displayed to 6 decimal places
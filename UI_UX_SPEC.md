# UI/UX Specifications & Design System

## Product: Nexora — AI File Manager
**Tagline:** *"Your files. Your intelligence. Your control."*  
**Platform:** Windows 11 Desktop  
**Canonical Version:** `0.1.0`

---

## 1. Visual Identity & Design Philosophy

Nexora features a **cinematic, futuristic, minimal** visual aesthetic specifically tailored for Windows 11:
- **Surfaces**: Deep black (`#070707`) and dark charcoal (`#0f0f11`, `#161619`) layered surfaces evoking a high-performance intelligence console.
- **Accents**: Restrained neon-lime (`#b4ff32`) accents signifying active intelligence, verified states, and primary actions without visual clutter.
- **Glassmorphism**: Subtle transluscent backgrounds (`backdrop-filter: blur(16px)`) with ultra-fine white borders (`rgba(255, 255, 255, 0.08)`).
- **Typography**: Crisp, highly legible modern typography using system fonts (`Segoe UI Variable`, `Inter`, `-apple-system`, `sans-serif`) with strict hierarchical scale.
- **Micro-Animations**: Purposeful, snappy 150ms–250ms ease-out transitions for interactive feedback and view switching.

---

## 2. Design Tokens (`src/renderer/styles/tokens.css`)

```css
:root {
  /* Surface Layers */
  --bg-primary: #070707;
  --bg-secondary: #0f0f11;
  --bg-tertiary: #161619;
  --bg-card: rgba(22, 22, 25, 0.7);
  --bg-card-hover: rgba(30, 30, 35, 0.85);

  /* Borders & Dividers */
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-active: rgba(180, 255, 50, 0.4);

  /* Neon-Lime Brand Accents */
  --accent-lime: #b4ff32;
  --accent-lime-hover: #c6ff55;
  --accent-lime-dim: rgba(180, 255, 50, 0.15);

  /* Typography Colors */
  --text-primary: #ffffff;
  --text-secondary: #a0a0a5;
  --text-muted: #606065;
  --text-accent: #b4ff32;

  /* Status Colors */
  --status-success: #32d74b;
  --status-warning: #ff9f0a;
  --status-error: #ff453a;
  --status-info: #0a84ff;

  /* Glassmorphic Effects */
  --glass-blur: blur(16px);
  --shadow-card: 0 4px 24px rgba(0, 0, 0, 0.4);
}
```

---

## 3. Screen-by-Screen Specifications (12 Views)

### 3.1. Dashboard (`DashboardPage.tsx`)
- **Header**: Greeting, current system time, and status badge ("Local Intelligence Ready").
- **KPI Metrics Bar**: 4 dynamic metric cards:
  1. *Total Indexed Files* (numeric counter with storage badge)
  2. *Recognized People* (clusters identified count)
  3. *Reclaimable Duplicates* (space savings in GB/MB)
  4. *Active Watchers* (number of monitored root folders)
- **Quick Actions Panel**: Direct navigation shortcuts: "Scan New Folder", "Review New Faces", "Resolve Duplicates", "Open Explorer".
- **Recent Activity Feed**: Chronological list of last 5 operations with status indicators.

### 3.2. Explorer (`ExplorerPage.tsx`)
- **Logical Drive Bar**: Buttons for all detected Windows drive partitions (`C:`, `D:`, etc.) showing letter, drive label, and free space meters.
- **Navigation Controls**: Back / Forward history buttons, Home shortcut, Refresh button, and interactive clickable breadcrumb path segments.
- **View Toggles**: List View (table with Name, Size, Modified Date, Type) and Grid View (thumbnail cards with icon badges).
- **Context Actions**: Open with default OS app, Reveal in Windows File Explorer, and Inspect File Details Drawer.

### 3.3. People (`PeoplePage.tsx`)
- **Status Filter Tabs**:
  - `Unreviewed`: New face clusters identified by the AI worker awaiting user confirmation.
  - `Reviewed`: Named identities.
  - `All`: Complete list of detected individuals.
- **Identity Cards**: Circular face thumbnail crop, cluster member count badge, editable name field, "Confirm Identity" button, "Hide Person" toggle, and "Delete" option.

### 3.4. Search (`SearchPage.tsx`)
- **Search Header**: Full-width search bar with real-time query parsing and instant millisecond latency display (`duration_ms`).
- **Filter Toolbar**:
  - Extension filter chips (`All`, `Photos`, `Videos`, `Documents`, `Custom`)
  - Size boundary slider (`Min Size` - `Max Size`)
  - Date Range picker (`Start Date` - `End Date`)
  - Person filter dropdown linking to recognized identities
- **Results View**: Multi-column table or thumbnail grid with hit highlight snippet preview.

### 3.5. Timeline (`TimelinePage.tsx`)
- **Grouping Granularity**: Granularity selector tabs: `Year`, `Month`, `Day`.
- **Timeline Structure**: Sticky date headers (e.g., "October 2026", "September 2026") derived from camera EXIF `DateTimeOriginal`.
- **Media Grid**: High-density responsive photo/video grid with lazy-loaded thumbnails and hover zoom preview.

### 3.6. Events (`EventsPage.tsx`)
- **Event Containers**: Visual collections representing real-world occasions (e.g., "Vacation 2026", "Family Reunion").
- **Event Creation**: Workflow to cluster photos by date window and GPS proximity into cohesive event groups.

### 3.7. Duplicates (`DuplicatesPage.tsx`)
- **Algorithm Switcher**: Toggle between `Exact Duplicates (SHA-256)` and `Visual Duplicates (dHash)`.
- **Comparison Drawer**: Side-by-side split screen showing duplicate candidate pairs with resolution, byte size, path, and similarity percentage.
- **Resolution Toolbar**:
  - `Keep Best` (auto-marks highest resolution / original)
  - `Move to Recycle Bin` (routes redundant copies to Windows Recycle Bin)
  - `Hardlink Duplicates` (NTFS zero-copy space reclaim)

### 3.8. Storage Analytics (`StoragePage.tsx`)
- **Partition Overview**: Visual capacity gauges for each Windows volume displaying Used vs Free GB and percentage filled.
- **Media Type Breakdown**: Segmented bar visualization for Photos, Videos, Audio, Documents, and Archives.
- **Heaviest Files Table**: Top 20 largest files across all indexed roots for immediate disk reclamation.

### 3.9. Activity & Job Queue (`ActivityPage.tsx`)
- **Queue Controls**: Global "Pause Queue" and "Resume Queue" action buttons.
- **Active Jobs**: Real-time progress bars, percent completion, current file being processed, and cancel button.
- **Error Log Console**: Expandable error cards detailing timestamp, job type, affected file path, and stack trace.

### 3.10. History & Undo (`HistoryPage.tsx`)
- **Audit Table**: Chronological log of batch operations displaying operation ID, timestamp, source root, destination root, file count, and byte volume.
- **Verification Status**: Badges for `Verified (SHA-256)`, `In Progress`, or `Failed`.
- **Rollback Action**: One-click "Rollback Operation" button with safety confirmation dialog.

### 3.11. Watched Folders (`WatchedFoldersPage.tsx`)
- **Add Folder**: Prominent "+ Add Watched Folder" action triggering native Windows folder picker.
- **Folder List**: Cards showing folder path, label, recursive status, last scan timestamp, active toggle switch, and "Rescan Now" button.

### 3.12. Settings (`SettingsPage.tsx`)
- **AI Configuration**: Face detection confidence threshold slider (`0.50` - `0.95`), Cosine clustering distance threshold (`0.40` - `0.80`).
- **Database Utilities**: Database size counter, "Vacuum Database", "Rebuild FTS5 Index", "Clear Thumbnail Cache".
- **Application Info**: Canonical version display (`0.1.0`), license, and paths to user data directories.

---

## 4. Navigation Architecture & Sidebar (`Sidebar.tsx`)

The navigation sidebar is anchored to the left of the desktop shell (width: `240px`) and groups views into three intuitive sections:

1. **Core**:
   - `Dashboard` (LayoutDashboard icon)
   - `Explorer` (FolderTree icon)
   - `Search` (Search icon)
2. **Intelligence**:
   - `People` (Users icon)
   - `Timeline` (Calendar icon)
   - `Events` (Sparkles icon)
   - `Duplicates` (Copy icon)
3. **Management**:
   - `Storage` (HardDrive icon)
   - `Watched Folders` (Eye icon)
   - `Activity Queue` (Activity icon)
   - `History & Undo` (History icon)
   - `Settings` (Settings icon)

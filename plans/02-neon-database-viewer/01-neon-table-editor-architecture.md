# 01. Neon-Style Table Editor UX & Frontend Architecture

Neon's database table viewer is renowned for its speed, clarity, and spreadsheet-like simplicity. This document details how we implement this exact experience within our PaaS dashboard.

---

## 1. Neon Table Studio Layout & Components

The database viewer is mounted inside a dedicated tab in the Database Service view:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ [Schema: public ▼] [Table: users (12,482 rows) ▼]  [🔍 Search rows...]  [+ New Row]    │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ [Filters (0)]  [Sort: created_at DESC]  [Columns: 8/8 visible]  [⚡ Commit (2 edits)]   │
├─────────┬──────────────────────┬─────────────┬──────────────┬─────────────┬────────────┤
│   #     │ id (uuid) 🔑         │ name (text) │ email (text) │ org_id (fk) │ created_at │
├─────────┼──────────────────────┼─────────────┼──────────────┼─────────────┼────────────┤
│   1     │ a1b2c3d4-0001...     │ Alice Chen  │ alice@co.com │ [org: 42 ↗] │ 2 mins ago │
│   2     │ a1b2c3d4-0002...     │ Bob Smith   │ bob@co.com   │ [org: 19 ↗] │ 5 mins ago │
│   3     │ a1b2c3d4-0003...     │ Clara Diaz  │ clara@co.com │ [org: 42 ↗] │ 1 hour ago │
│  ...    │ ...                  │ ...         │ ...          │ ...         │ ...        │
└─────────┴──────────────────────┴─────────────┴──────────────┴─────────────┴────────────┘
│ Rows 1-50 of ~12,482   |   Execution: 14ms   |   Auto-save: ON   |   [Download CSV]    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Interactive Features

### 2.1 Virtualized Infinite Scrolling
Real-world tables have hundreds of thousands or millions of rows. Rendering standard DOM `<tr>` tags will crash the browser.
- **Technology**: `@tanstack/react-virtual` + `@tanstack/react-table`.
- **Performance**: Only renders rows visible in the viewport (+ 10 buffer rows above and below).
- **Smooth Pagination**: Automatically fetches the next page when the user scrolls near the bottom of the table.

### 2.2 Inline Spreadsheet-Style Cell Editing
- **Double Click to Edit**: Clicking any cell transforms it into an active editor matching its PostgreSQL type:
  - `boolean`: Checkbox toggle or two-state pill.
  - `uuid` / `text` / `varchar`: Auto-sizing text input.
  - `json` / `jsonb`: Miniature JSON tree editor or modal code editor with syntax formatting.
  - `timestamp` / `timestamptz`: Interactive date-time picker with timezone indicator.
  - `enum`: Dropdown containing all allowed PostgreSQL enum values.
- **Draft State & Undo**: Modified cells highlight with an amber border. Users can click **"Commit"** to batch-apply all updates via an atomic SQL transaction, or press `Escape` to discard.

### 2.3 Foreign Key Relationship Navigation (One-Click Traversal)
- Foreign key columns display a distinct badge: `[org_id ↗]`.
- Clicking the badge opens a preview popover displaying the referenced row in the target table (e.g., `organizations WHERE id = 42`).
- Clicking **"Go to Table"** switches the view directly to the referenced table with the filter automatically pre-applied!

### 2.4 Visual Filter & Sort Builder
Users can filter without writing SQL:
- **Conditionals**: `equals`, `contains (ILIKE)`, `starts with`, `greater than`, `is null`, `is not null`, `in list`.
- **Multi-Sort**: Add multiple sorting criteria (e.g. `ORDER BY status ASC, created_at DESC`).

---

## 3. Frontend Component Structure

```
src/components/database-studio/
├── DatabaseStudio.tsx              # Main wrapper with Sidebar (Tables list) + Main Area
├── TableNavigationSidebar.tsx      # List of schemas & tables with row counts and icons
├── TableHeaderToolbar.tsx          # Filter builder, sort selector, search input, export buttons
├── VirtualDataGrid.tsx             # TanStack Virtual table rendering engine
├── cells/                          # Type-specific cell renderers & editors
│   ├── TextCell.tsx
│   ├── NumberCell.tsx
│   ├── BooleanCell.tsx
│   ├── JsonCell.tsx                # Expandable JSON modal with formatting
│   ├── ForeignKeyCell.tsx          # Popover relationship navigator
│   └── TimestampCell.tsx
├── modals/
│   ├── InsertRowModal.tsx          # Dynamic form based on column types and defaults
│   ├── ColumnConfigModal.tsx       # Hide/show columns, adjust widths
│   └── ForeignKeyPreviewModal.tsx
└── SqlEditorPanel.tsx              # Monaco editor runner (toggleable drawer)
```

---

## 4. Virtual Data Grid Implementation Example

```tsx
// VirtualDataGrid.tsx
import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';

interface VirtualDataGridProps<TData> {
  data: TData[];
  columns: ColumnDef<TData, any>[];
  onCellChange?: (rowIndex: number, columnId: string, value: any) => void;
  isLoading: boolean;
}

export function VirtualDataGrid<TData>({
  data,
  columns,
  onCellChange,
  isLoading,
}: VirtualDataGridProps<TData>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const parentRef = useRef<HTMLDivElement>(null);
  const rows = table.getRowModel().rows;

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40, // 40px row height
    overscan: 10,
  });

  return (
    <div
      ref={parentRef}
      className="relative h-full w-full overflow-auto bg-zinc-950 font-mono text-xs border border-zinc-800 rounded-lg select-text"
    >
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-20 bg-zinc-900 shadow-md">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b border-zinc-800">
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className="px-4 py-2.5 font-medium text-zinc-300 border-r border-zinc-800/60 last:border-r-0 whitespace-nowrap"
                  style={{ width: header.getSize() }}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody
          className="relative"
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            return (
              <tr
                key={row.id}
                className="absolute left-0 w-full flex border-b border-zinc-900 hover:bg-zinc-900/50 transition-colors"
                style={{
                  top: `${virtualRow.start}px`,
                  height: `${virtualRow.size}px`,
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="px-4 py-2 border-r border-zinc-900/80 text-zinc-300 truncate"
                    style={{ width: cell.column.getSize() }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

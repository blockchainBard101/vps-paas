'use client';

import React, { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import {
  Table,
  Play,
  Database,
  Key,
  Check,
  AlertCircle,
  RefreshCw,
  Search,
  Filter,
  ArrowUpDown,
  Plus,
  X,
  FileCode,
  TableProperties,
  Download,
  Upload,
} from 'lucide-react';
import {
  introspectDatabase,
  fetchTableData,
  updateTableCell,
  executeSqlQuery,
  insertTableRow,
  createDatabaseBackup,
  getDatabaseBackupDownloadUrl,
} from '@/lib/api';
import { PostgresLogo } from '../icons/DatabaseLogos';

export interface ColumnSchema {
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
}

export interface TableSummary {
  schema: string;
  name: string;
  estimatedRows: number;
  columns: ColumnSchema[];
}

const MIGRATION_TEMPLATES: Record<string, string> = {
  auth: `-- 1. User Authentication & Session Schema
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(100),
  role VARCHAR(50) DEFAULT 'USER',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
`,
  ecommerce: `-- 2. E-Commerce & Catalog Schema
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  sku VARCHAR(100) UNIQUE NOT NULL,
  price_cents INT NOT NULL,
  inventory_count INT DEFAULT 0,
  is_published BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_email VARCHAR(255) NOT NULL,
  total_cents INT NOT NULL,
  status VARCHAR(50) DEFAULT 'PENDING',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  quantity INT DEFAULT 1,
  unit_price_cents INT NOT NULL
);
`,
  blog: `-- 3. Blog & CMS Schema
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id INT REFERENCES categories(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  content TEXT NOT NULL,
  published_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`,
  seed_users: `-- 4. Seed Mock Data
INSERT INTO users (email, password_hash, full_name, role) VALUES
  ('admin@walhost.xyz', '$2a$12$eX4mpleH4sh...', 'Platform Administrator', 'ADMIN'),
  ('dev@walhost.xyz', '$2a$12$eX4mpleH4sh...', 'Lead Engineer', 'DEVELOPER'),
  ('alice@example.com', '$2a$12$eX4mpleH4sh...', 'Alice Smith', 'USER')
ON CONFLICT (email) DO NOTHING;
`,
};

interface NeonDatabaseStudioProps {
  databaseId?: string;
  databaseName?: string;
  connectionUrl?: string;
  onClose?: () => void;
}

export function NeonDatabaseStudio({
  databaseId = 'demo-db',
  databaseName = 'production-postgres',
  connectionUrl = 'postgresql://postgres:***@paas-pg:5432/railway',
  onClose,
}: NeonDatabaseStudioProps) {
  const [activeTab, setActiveTab] = useState<'grid' | 'sql'>('grid');
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Tables state (mocked or loaded from backend API)
  const [tables, setTables] = useState<TableSummary[]>([
    {
      schema: 'public',
      name: 'users',
      estimatedRows: 42,
      columns: [
        { name: 'id', dataType: 'uuid', isNullable: false, defaultValue: 'gen_random_uuid()', isPrimaryKey: true },
        { name: 'email', dataType: 'varchar(255)', isNullable: false, defaultValue: null, isPrimaryKey: false },
        { name: 'full_name', dataType: 'text', isNullable: true, defaultValue: null, isPrimaryKey: false },
        { name: 'role', dataType: 'varchar(50)', isNullable: false, defaultValue: "'DEVELOPER'", isPrimaryKey: false },
        { name: 'is_active', dataType: 'boolean', isNullable: false, defaultValue: 'true', isPrimaryKey: false },
        { name: 'created_at', dataType: 'timestamptz', isNullable: false, defaultValue: 'now()', isPrimaryKey: false },
      ],
    },
    {
      schema: 'public',
      name: 'projects',
      estimatedRows: 12,
      columns: [
        { name: 'id', dataType: 'uuid', isNullable: false, defaultValue: 'gen_random_uuid()', isPrimaryKey: true },
        { name: 'name', dataType: 'varchar(100)', isNullable: false, defaultValue: null, isPrimaryKey: false },
        { name: 'organization_id', dataType: 'uuid', isNullable: false, defaultValue: null, isPrimaryKey: false },
        { name: 'created_at', dataType: 'timestamptz', isNullable: false, defaultValue: 'now()', isPrimaryKey: false },
      ],
    },
    {
      schema: 'public',
      name: 'deployments',
      estimatedRows: 156,
      columns: [
        { name: 'id', dataType: 'uuid', isNullable: false, defaultValue: 'gen_random_uuid()', isPrimaryKey: true },
        { name: 'service_id', dataType: 'varchar(50)', isNullable: false, defaultValue: null, isPrimaryKey: false },
        { name: 'status', dataType: 'varchar(30)', isNullable: false, defaultValue: "'HEALTHY'", isPrimaryKey: false },
        { name: 'commit_hash', dataType: 'varchar(40)', isNullable: true, defaultValue: null, isPrimaryKey: false },
        { name: 'created_at', dataType: 'timestamptz', isNullable: false, defaultValue: 'now()', isPrimaryKey: false },
      ],
    },
  ]);

  const [selectedTable, setSelectedTable] = useState<TableSummary>(tables[0]);

  // Table rows mock data
  const [rows, setRows] = useState<any[]>([
    {
      id: 'a1b2c3d4-e5f6-47a8-9b0c-1d2e3f4a5b6c',
      email: 'alice.chen@example.com',
      full_name: 'Alice Chen',
      role: 'OWNER',
      is_active: 'true',
      created_at: '2026-10-05T10:14:22Z',
    },
    {
      id: 'b2c3d4e5-f6a7-48b9-0c1d-2e3f4a5b6c7d',
      email: 'bob.smith@example.com',
      full_name: 'Bob Smith',
      role: 'ADMIN',
      is_active: 'true',
      created_at: '2026-10-05T11:20:05Z',
    },
    {
      id: 'c3d4e5f6-a7b8-49c0-1d2e-3f4a5b6c7d8e',
      email: 'clara.diaz@example.com',
      full_name: 'Clara Diaz',
      role: 'DEVELOPER',
      is_active: 'true',
      created_at: '2026-10-05T11:45:18Z',
    },
    {
      id: 'd4e5f6a7-b8c9-40d1-2e3f-4a5b6c7d8e9f',
      email: 'david.kim@example.com',
      full_name: 'David Kim',
      role: 'VIEWER',
      is_active: 'false',
      created_at: '2026-10-05T12:00:30Z',
    },
  ]);

  // SQL Runner state
  const [sqlQuery, setSqlQuery] = useState<string>(
    'SELECT id, email, role, created_at \nFROM users \nWHERE is_active = true \nORDER BY created_at DESC \nLIMIT 10;'
  );
  const [sqlResult, setSqlResult] = useState<{
    rowCount: number;
    durationMs: number;
    rows: any[];
    error?: string;
  } | null>(null);

  // Cell editing & backup feedback
  const [cellEditSuccess, setCellEditSuccess] = useState<string | null>(null);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);

  // Fetch live tables from backend
  useEffect(() => {
    if (!databaseId || databaseId === 'demo-db') return;
    introspectDatabase(databaseId)
      .then((realTables) => {
        if (realTables && realTables.length > 0) {
          setTables(realTables);
          setSelectedTable(realTables[0]);
        } else {
          setTables([]);
          setSelectedTable(null as any);
          setRows([]);
        }
      })
      .catch(() => {
        // Fallback to sample schema
      });
  }, [databaseId]);

  function exportToCsv() {
    if (!selectedTable || rows.length === 0) return;
    const headers = selectedTable.columns.map((c) => c.name);
    const csvRows = [
      headers.join(','),
      ...rows.map((r) =>
        headers
          .map((h) => {
            const val = r[h] !== undefined && r[h] !== null ? String(r[h]) : '';
            return `"${val.replace(/"/g, '""')}"`;
          })
          .join(',')
      ),
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${selectedTable.name}-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Fetch live table rows when selectedTable changes
  useEffect(() => {
    if (!databaseId || databaseId === 'demo-db' || !selectedTable) return;
    fetchTableData(databaseId, selectedTable.name, selectedTable.schema)
      .then((data) => {
        if (data && data.rows) {
          setRows(data.rows);
        }
      })
      .catch(() => {
        // Retain current rows
      });
  }, [databaseId, selectedTable]);

  async function handleCellChange(rowIndex: number, colName: string, val: string) {
    const updated = [...rows];
    updated[rowIndex] = { ...updated[rowIndex], [colName]: val };
    setRows(updated);

    if (databaseId && databaseId !== 'demo-db' && selectedTable) {
      const pkCol = selectedTable.columns.find((c) => c.isPrimaryKey) || selectedTable.columns[0];
      const pkVal = rows[rowIndex]?.[pkCol?.name || 'id'];
      if (pkCol && pkVal) {
        try {
          await updateTableCell(databaseId, selectedTable.schema, selectedTable.name, pkCol.name, pkVal, colName, val);
        } catch (e) {
          console.warn('Live cell update notice:', e);
        }
      }
    }

    setCellEditSuccess(`Updated ${colName}`);
    setTimeout(() => setCellEditSuccess(null), 2000);
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      if (content) {
        setSqlQuery(content);
        setActiveTab('sql');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function handleRunSql() {
    setLoading(true);
    const start = performance.now();

    if (databaseId && databaseId !== 'demo-db') {
      try {
        const res = await executeSqlQuery(databaseId, sqlQuery);
        setSqlResult(res);
        setLoading(false);

        // Auto-refresh tables list if a DDL migration ran
        const upper = sqlQuery.toUpperCase();
        if (upper.includes('CREATE ') || upper.includes('DROP ') || upper.includes('ALTER ') || upper.includes('TRUNCATE ')) {
          introspectDatabase(databaseId).then((refreshed) => {
            if (refreshed && refreshed.length > 0) {
              setTables(refreshed);
              setSelectedTable(refreshed[0]);
            } else {
              setTables([]);
              setSelectedTable(null as any);
            }
          }).catch(() => {});
        }
        return;
      } catch (err: any) {
        setSqlResult({
          rowCount: 0,
          durationMs: Math.round(performance.now() - start),
          rows: [],
          error: err.message,
        });
        setLoading(false);
        return;
      }
    }

    // Local execution fallback
    setTimeout(() => {
      setLoading(false);
      setSqlResult({
        rowCount: rows.length,
        durationMs: Math.round(performance.now() - start + 8),
        rows: rows,
      });
    }, 150);
  }

  return (
    <div className="h-full flex flex-col bg-zinc-950 text-zinc-100 font-sans border-0 select-text">
      {/* Studio Header Toolbar */}
      <div className="h-12 border-b border-zinc-800 bg-zinc-900/80 px-4 flex items-center justify-between backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-indigo-400 font-semibold text-xs tracking-wide uppercase">
            <PostgresLogo className="w-4 h-4" />
            <span>Neon Table Studio</span>
          </div>
          <span className="text-zinc-600">/</span>
          <span className="text-xs text-zinc-400 font-mono">{databaseName}</span>

          <div className="flex items-center gap-1 bg-zinc-950 p-0.5 rounded-lg border border-zinc-800 text-xs ml-4">
            <button
              onClick={() => setActiveTab('grid')}
              className={`px-3 py-1 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'grid'
                  ? 'bg-zinc-800 text-zinc-100 font-medium'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <TableProperties className="w-3.5 h-3.5" />
              <span>Table Grid</span>
            </button>
            <button
              onClick={() => setActiveTab('sql')}
              className={`px-3 py-1 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'sql'
                  ? 'bg-zinc-800 text-zinc-100 font-medium'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>SQL Runner</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {backupNotice && (
            <div className="flex items-center gap-1 text-[11px] text-indigo-400 font-mono animate-fade-in bg-indigo-950/40 px-2 py-0.5 rounded border border-indigo-500/30">
              <Check className="w-3.5 h-3.5" />
              <span>{backupNotice}</span>
            </div>
          )}

          {cellEditSuccess && (
            <div className="flex items-center gap-1 text-[11px] text-emerald-400 font-mono animate-fade-in">
              <Check className="w-3.5 h-3.5" />
              <span>{cellEditSuccess}</span>
            </div>
          )}

          <button
            onClick={async () => {
              if (databaseId && databaseId !== 'demo-db') {
                try {
                  const b = await createDatabaseBackup(databaseId);
                  setBackupNotice(`Snapshot: ${b.filename} (${Math.round(b.sizeBytes / 1024)} KB)`);
                  // Trigger direct download of the generated SQL dump
                  const downloadUrl = getDatabaseBackupDownloadUrl(databaseId, b.id);
                  const a = document.createElement('a');
                  a.href = downloadUrl;
                  a.download = b.filename;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  setTimeout(() => setBackupNotice(null), 4000);
                } catch (e: any) {
                  alert(`Backup error: ${e.message}`);
                }
              } else {
                setBackupNotice('Snapshot saved: backup-demo.dump (42 KB)');
                setTimeout(() => setBackupNotice(null), 4000);
              }
            }}
            className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 rounded-lg text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-indigo-400" />
            <span>Backup & Download</span>
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Tables Sidebar */}
        <div className="w-64 border-r border-zinc-800 bg-zinc-900/30 flex flex-col">
          <div className="p-3 border-b border-zinc-800/80">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tables..."
                className="w-full pl-8 pr-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider px-2 py-1">
              Public Schema ({tables.length})
            </div>
            {tables
              .filter((t) => t.name.toLowerCase().includes(searchQuery.toLowerCase()))
              .map((table) => (
                <button
                  key={table.name}
                  onClick={() => {
                    setSelectedTable(table);
                    setActiveTab('grid');
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
                    selectedTable.name === table.name && activeTab === 'grid'
                      ? 'bg-indigo-600/20 text-indigo-300 font-medium border border-indigo-500/30'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <Table className="w-3.5 h-3.5 text-zinc-500" />
                    <span className="truncate">{table.name}</span>
                  </div>
                  <span className="text-[10px] text-zinc-600">{table.estimatedRows}</span>
                </button>
              ))}
          </div>

          <div className="p-3 border-t border-zinc-800 text-[11px] text-zinc-500 font-mono truncate">
            <span>host: </span>
            <span className="text-zinc-400">paas-internal</span>
          </div>
        </div>

        {/* Viewport: Grid or SQL Runner */}
        <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950 p-4">
          {activeTab === 'grid' ? (
            !selectedTable || tables.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 border border-dashed border-zinc-800/80 rounded-2xl bg-zinc-900/10">
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-4 shadow-lg shadow-indigo-500/10">
                  <Database className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-semibold text-zinc-200 mb-1">No Tables Created Yet</h3>
                <p className="text-xs text-zinc-400 max-w-sm mb-6 leading-relaxed font-mono">
                  This PostgreSQL database is live and running. Create your first table using raw SQL or quick templates.
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setSqlQuery(`CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  full_name VARCHAR(100),
  role VARCHAR(50) DEFAULT 'USER',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO users (email, full_name, role) VALUES 
('alice@example.com', 'Alice Chen', 'ADMIN'),
('bob@example.com', 'Bob Smith', 'USER');`);
                      setActiveTab('sql');
                    }}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Create Sample Table via SQL</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('sql')}
                    className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-mono transition-colors cursor-pointer"
                  >
                    Open Empty SQL Editor
                  </button>
                </div>
              </div>
            ) : (
            <div className="h-full flex flex-col space-y-3">
              {/* Table Action Bar */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-mono">
                  <span className="text-zinc-400">table:</span>
                  <span className="text-zinc-100 font-bold">{selectedTable.name}</span>
                  <span className="text-zinc-600">•</span>
                  <span className="text-zinc-400">{rows.length} rows loaded</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={exportToCsv}
                    className="px-3 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 rounded-lg text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Export table data as CSV"
                  >
                    <Download className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Export CSV</span>
                  </button>

                  <button
                    onClick={async () => {
                      const newRow = {
                        email: `user.${Math.floor(Math.random() * 900 + 100)}@example.com`,
                        full_name: 'New Colleague',
                        role: 'DEVELOPER',
                      };
                      if (databaseId && databaseId !== 'demo-db') {
                        try {
                          const inserted = await insertTableRow(databaseId, selectedTable.name, newRow);
                          setRows([inserted, ...rows]);
                          setCellEditSuccess('Row inserted into PostgreSQL!');
                          setTimeout(() => setCellEditSuccess(null), 2000);
                          return;
                        } catch (e: any) {
                          alert(`Insert error: ${e.message}`);
                        }
                      }
                      setRows([{ id: `new-${Date.now()}`, ...newRow, is_active: 'true', created_at: new Date().toISOString() }, ...rows]);
                    }}
                    className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Insert Row</span>
                  </button>
                </div>
              </div>

              {/* Virtual Data Grid */}
              <div className="flex-1 overflow-auto border border-zinc-800 rounded-xl bg-zinc-900/30">
                <table className="w-full border-collapse text-left font-mono text-xs">
                  <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800 z-10 shadow-sm">
                    <tr>
                      <th className="px-3 py-2.5 w-12 text-zinc-600 font-medium border-r border-zinc-800/80 text-center">
                        #
                      </th>
                      {selectedTable.columns.map((col) => (
                        <th
                          key={col.name}
                          className="px-4 py-2.5 font-medium text-zinc-300 border-r border-zinc-800/80 whitespace-nowrap"
                        >
                          <div className="flex items-center gap-1.5">
                            {col.isPrimaryKey && <Key className="w-3 h-3 text-amber-400" title="Primary Key" />}
                            <span>{col.name}</span>
                            <span className="text-[10px] text-zinc-500 font-normal">({col.dataType})</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, rIdx) => (
                      <tr key={row.id || rIdx} className="border-b border-zinc-900 hover:bg-zinc-900/50 transition-colors">
                        <td className="px-3 py-2 text-zinc-600 text-center font-mono border-r border-zinc-900">
                          {rIdx + 1}
                        </td>
                        {selectedTable.columns.map((col) => (
                          <td key={col.name} className="px-2 py-1.5 border-r border-zinc-900 truncate">
                            <input
                              defaultValue={row[col.name] ?? ''}
                              onBlur={(e) => handleCellChange(rIdx, col.name, e.target.value)}
                              className="w-full bg-transparent px-2 py-1 text-zinc-300 focus:bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded truncate font-mono text-xs transition-colors"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="h-6 flex items-center justify-between text-[11px] text-zinc-500 font-mono px-1">
                <span>Double-click any cell to edit inline • Press Tab to navigate</span>
                <span>Auto-commit: ACTIVE</span>
              </div>
            </div>
            )
          ) : (
            /* Monaco SQL Runner Tab */
            <div className="h-full flex flex-col space-y-4">
              <div className="flex-1 flex flex-col space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-zinc-400 font-mono flex items-center gap-2">
                    <FileCode className="w-4 h-4 text-indigo-400" />
                    <span>Monaco Query Runner (PostgreSQL)</span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Migration & Seed Templates Dropdown */}
                    <select
                      onChange={(e) => {
                        if (e.target.value && MIGRATION_TEMPLATES[e.target.value]) {
                          setSqlQuery(MIGRATION_TEMPLATES[e.target.value]);
                          e.target.value = '';
                        }
                      }}
                      className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-indigo-500 font-mono cursor-pointer"
                    >
                      <option value="">Insert Migration / Seed Template...</option>
                      <option value="auth">Template: Auth & Users Schema</option>
                      <option value="ecommerce">Template: E-Commerce & Catalog</option>
                      <option value="blog">Template: Blog & Content CMS</option>
                      <option value="seed_users">Seed: Mock Users & Admin Data</option>
                    </select>

                    {/* Upload .sql file */}
                    <label className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white rounded-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors">
                      <Upload className="w-3.5 h-3.5 text-zinc-400" />
                      <span>Load .sql</span>
                      <input type="file" accept=".sql" className="hidden" onChange={handleFileUpload} />
                    </label>

                    <button
                      onClick={handleRunSql}
                      disabled={loading}
                      className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer shadow-lg shadow-indigo-600/20"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>{loading ? 'Running...' : 'Execute (Cmd+Enter)'}</span>
                    </button>
                  </div>
                </div>

                <div className="h-60 border border-zinc-800 rounded-xl overflow-hidden bg-[#1e1e1e]">
                  <Editor
                    height="100%"
                    defaultLanguage="sql"
                    theme="vs-dark"
                    value={sqlQuery}
                    onChange={(v: string | undefined) => setSqlQuery(v || '')}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      fontFamily: 'JetBrains Mono, Menlo, monospace',
                      automaticLayout: true,
                    }}
                  />
                </div>

                {sqlResult && (
                  <div className="flex-1 flex flex-col overflow-hidden border border-zinc-800 rounded-xl bg-zinc-900/30 p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs font-mono text-zinc-400 pb-2 border-b border-zinc-800">
                      <span>Result: {sqlResult.rowCount} rows</span>
                      <span className="text-emerald-400 font-semibold">{sqlResult.durationMs}ms</span>
                    </div>
                    <pre className="flex-1 overflow-auto text-xs font-mono text-zinc-300 p-2">
                      {JSON.stringify(sqlResult.rows, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

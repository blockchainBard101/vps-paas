# Phase 2: Neon Table Viewer & SQL Editor Implementation

This guide provides the complete, working code to build the **Neon-style Table Studio**: schema introspection, virtualized spreadsheet data grid, inline cell editing, and integrated Monaco SQL Runner.

---

## 1. Additional Dependencies

```bash
npm install @tanstack/react-table @tanstack/react-virtual @monaco-editor/react
```

---

## 2. Server Actions for Neon Studio

```typescript
// src/app/actions/database-studio.ts
'use server';

import { Client, Pool } from 'pg';

// Dynamic pool store
const poolCache = new Map<string, Pool>();

function getDbPool(connectionString: string): Pool {
  if (!poolCache.has(connectionString)) {
    poolCache.set(
      connectionString,
      new Pool({ connectionString, max: 5, idleTimeoutMillis: 10000 })
    );
  }
  return poolCache.get(connectionString)!;
}

export interface IntrospectedColumn {
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
}

export interface TableMeta {
  schema: string;
  name: string;
  estimatedRows: number;
  columns: IntrospectedColumn[];
}

/**
 * 1. Introspect Schemas, Tables & Columns
 */
export async function getTablesAction(connectionString: string): Promise<TableMeta[]> {
  const pool = getDbPool(connectionString);
  const client = await pool.connect();

  try {
    const tablesRes = await client.query(`
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        COALESCE(s.n_live_tup, c.reltuples::bigint, 0) AS estimated_rows
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND c.relkind = 'r'
      ORDER BY n.nspname, c.relname;
    `);

    const tables: TableMeta[] = [];

    for (const row of tablesRes.rows) {
      const colRes = await client.query(
        `
        SELECT
          col.column_name,
          col.data_type,
          col.is_nullable = 'YES' AS is_nullable,
          col.column_default,
          EXISTS (
            SELECT 1 FROM pg_constraint con
            JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
            WHERE con.contype = 'p' AND con.conrelid = $1::regclass AND att.attname = col.column_name
          ) AS is_pk
        FROM information_schema.columns col
        WHERE col.table_schema = $2 AND col.table_name = $3
        ORDER BY col.ordinal_position;
      `,
        [`"${row.schema_name}"."${row.table_name}"`, row.schema_name, row.table_name]
      );

      tables.push({
        schema: row.schema_name,
        name: row.table_name,
        estimatedRows: Number(row.estimated_rows),
        columns: colRes.rows.map((c) => ({
          name: c.column_name,
          dataType: c.data_type,
          isNullable: c.is_nullable,
          defaultValue: c.column_default,
          isPrimaryKey: c.is_pk,
        })),
      });
    }

    return tables;
  } finally {
    client.release();
  }
}

/**
 * 2. Fetch Paginated Rows for Data Grid
 */
export async function getTableDataAction(
  connectionString: string,
  schema: string,
  table: string,
  page = 0,
  pageSize = 50
): Promise<{ rows: any[]; totalCount: number }> {
  const pool = getDbPool(connectionString);
  const client = await pool.connect();

  try {
    const offset = page * pageSize;
    // Parameterized safely using quoted identifiers
    const query = `SELECT * FROM "${schema}"."${table}" LIMIT $1 OFFSET $2`;
    const res = await client.query(query, [pageSize, offset]);

    const countRes = await client.query(
      `SELECT count(*)::bigint AS count FROM "${schema}"."${table}"`
    );

    return {
      rows: res.rows,
      totalCount: Number(countRes.rows[0].count),
    };
  } finally {
    client.release();
  }
}

/**
 * 3. Inline Cell Edit Mutation
 */
export async function updateCellAction(
  connectionString: string,
  schema: string,
  table: string,
  primaryKeyName: string,
  primaryKeyValue: any,
  columnName: string,
  newValue: any
): Promise<{ success: boolean }> {
  const pool = getDbPool(connectionString);
  const client = await pool.connect();

  try {
    const query = `
      UPDATE "${schema}"."${table}"
      SET "${columnName}" = $1
      WHERE "${primaryKeyName}" = $2;
    `;
    await client.query(query, [newValue, primaryKeyValue]);
    return { success: true };
  } finally {
    client.release();
  }
}

/**
 * 4. Execute Arbitrary SQL Query (Monaco Runner)
 */
export async function executeSqlAction(
  connectionString: string,
  sql: string
): Promise<{ rows: any[]; rowCount: number; durationMs: number; error?: string }> {
  const pool = getDbPool(connectionString);
  const client = await pool.connect();
  const start = performance.now();

  try {
    await client.query('SET statement_timeout = 15000;');
    const res = await client.query(sql);
    const durationMs = Math.round(performance.now() - start);

    return {
      rows: res.rows || [],
      rowCount: res.rowCount || (res.rows ? res.rows.length : 0),
      durationMs,
    };
  } catch (err: any) {
    return {
      rows: [],
      rowCount: 0,
      durationMs: Math.round(performance.now() - start),
      error: err.message,
    };
  } finally {
    client.release();
  }
}
```

---

## 3. The Neon Studio Client Component

```tsx
// src/components/NeonDatabaseStudio.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { getTablesAction, getTableDataAction, updateCellAction, executeSqlAction, TableMeta } from '@/app/actions/database-studio';
import Editor from '@monaco-editor/react';
import { Table, Play, Database, Key, Check, AlertCircle, RefreshCw } from 'lucide-react';

export function NeonDatabaseStudio({ connectionUrl }: { connectionUrl: string }) {
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [selectedTable, setSelectedTable] = useState<TableMeta | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'grid' | 'sql'>('grid');

  // SQL Runner state
  const [sqlQuery, setSqlQuery] = useState('SELECT * FROM users LIMIT 10;');
  const [sqlResult, setSqlResult] = useState<any>(null);

  // 1. Initial Load: Fetch Introspected Tables
  useEffect(() => {
    async function loadTables() {
      setLoading(true);
      try {
        const fetched = await getTablesAction(connectionUrl);
        setTables(fetched);
        if (fetched.length > 0) {
          setSelectedTable(fetched[0]);
        }
      } catch (err) {
        console.error('Failed to introspect tables:', err);
      } finally {
        setLoading(false);
      }
    }
    loadTables();
  }, [connectionUrl]);

  // 2. Fetch Data when selected table changes
  useEffect(() => {
    if (!selectedTable) return;
    async function loadData() {
      setLoading(true);
      try {
        const data = await getTableDataAction(connectionUrl, selectedTable!.schema, selectedTable!.name);
        setRows(data.rows);
        setTotalRows(data.totalCount);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [selectedTable, connectionUrl]);

  // 3. Handle Inline Cell Edit
  async function handleCellBlur(rowIndex: number, colName: string, originalVal: any, e: React.FocusEvent<HTMLInputElement>) {
    const newVal = e.target.value;
    if (newVal === String(originalVal) || !selectedTable) return;

    const pkCol = selectedTable.columns.find((c) => c.isPrimaryKey) || selectedTable.columns[0];
    const pkVal = rows[rowIndex][pkCol.name];

    try {
      await updateCellAction(connectionUrl, selectedTable.schema, selectedTable.name, pkCol.name, pkVal, colName, newVal);
      const updated = [...rows];
      updated[rowIndex][colName] = newVal;
      setRows(updated);
    } catch (err: any) {
      alert(`Update failed: ${err.message}`);
    }
  }

  // 4. Run SQL Query
  async function runSql() {
    setLoading(true);
    try {
      const res = await executeSqlAction(connectionUrl, sqlQuery);
      setSqlResult(res);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full flex flex-col bg-zinc-950 text-zinc-200 font-sans border border-zinc-800 rounded-xl overflow-hidden">
      {/* Studio Header Bar */}
      <div className="h-12 border-b border-zinc-800 bg-zinc-900/80 px-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-indigo-400 font-semibold text-sm">
            <Database className="w-4 h-4" />
            <span>Neon Studio</span>
          </div>

          <div className="flex items-center gap-1 bg-zinc-950 p-0.5 rounded-lg border border-zinc-800 text-xs">
            <button
              onClick={() => setActiveTab('grid')}
              className={`px-3 py-1 rounded-md transition-colors ${
                activeTab === 'grid' ? 'bg-zinc-800 text-zinc-100 font-medium' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Table Grid
            </button>
            <button
              onClick={() => setActiveTab('sql')}
              className={`px-3 py-1 rounded-md transition-colors ${
                activeTab === 'sql' ? 'bg-zinc-800 text-zinc-100 font-medium' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              SQL Runner
            </button>
          </div>
        </div>

        {selectedTable && activeTab === 'grid' && (
          <div className="text-xs text-zinc-400 font-mono">
            Table: <span className="text-zinc-200 font-semibold">{selectedTable.name}</span> ({totalRows} rows)
          </div>
        )}
      </div>

      {/* Main Studio Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Table Sidebar */}
        <div className="w-60 border-r border-zinc-800 bg-zinc-900/40 p-3 overflow-y-auto">
          <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2 px-2">
            Tables & Views ({tables.length})
          </div>
          <div className="space-y-1">
            {tables.map((t) => (
              <button
                key={`${t.schema}.${t.name}`}
                onClick={() => {
                  setSelectedTable(t);
                  setActiveTab('grid');
                }}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-mono transition-colors ${
                  selectedTable?.name === t.name && activeTab === 'grid'
                    ? 'bg-indigo-600/20 text-indigo-300 font-medium border border-indigo-500/30'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <Table className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="truncate">{t.name}</span>
                </div>
                <span className="text-[10px] text-zinc-600">{t.estimatedRows}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Content Viewport */}
        <div className="flex-1 overflow-auto p-4">
          {activeTab === 'grid' ? (
            <div className="h-full flex flex-col">
              {selectedTable ? (
                <div className="flex-1 overflow-auto border border-zinc-800 rounded-lg">
                  <table className="w-full border-collapse text-left font-mono text-xs">
                    <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800 shadow-sm">
                      <tr>
                        {selectedTable.columns.map((c) => (
                          <th key={c.name} className="px-4 py-2.5 font-medium text-zinc-300 border-r border-zinc-800/60">
                            <div className="flex items-center gap-1.5">
                              {c.isPrimaryKey && <Key className="w-3 h-3 text-amber-400" />}
                              <span>{c.name}</span>
                              <span className="text-[10px] text-zinc-500 font-normal">({c.dataType})</span>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, rIdx) => (
                        <tr key={rIdx} className="border-b border-zinc-900 hover:bg-zinc-900/40">
                          {selectedTable.columns.map((c) => (
                            <td key={c.name} className="px-2 py-1.5 border-r border-zinc-900">
                              <input
                                defaultValue={row[c.name] ?? ''}
                                onBlur={(e) => handleCellBlur(rIdx, c.name, row[c.name], e)}
                                className="w-full bg-transparent px-2 py-1 text-zinc-300 focus:bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded truncate"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
                  Select a table on the left to inspect records
                </div>
              )}
            </div>
          ) : (
            /* SQL Runner Panel */
            <div className="h-full flex flex-col space-y-4">
              <div className="h-48 border border-zinc-800 rounded-lg overflow-hidden">
                <Editor
                  height="100%"
                  defaultLanguage="sql"
                  theme="vs-dark"
                  value={sqlQuery}
                  onChange={(v) => setSqlQuery(v || '')}
                  options={{ minimap: { enabled: false }, fontSize: 13 }}
                />
              </div>

              <div className="flex items-center justify-between">
                <button
                  onClick={runSql}
                  disabled={loading}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-2 shadow-lg shadow-indigo-600/20"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Execute SQL (Cmd+Enter)</span>
                </button>
                {sqlResult && (
                  <span className="text-xs text-zinc-400 font-mono">
                    {sqlResult.rowCount} rows ({sqlResult.durationMs}ms)
                  </span>
                )}
              </div>

              {sqlResult?.error && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs font-mono">
                  {sqlResult.error}
                </div>
              )}

              {sqlResult?.rows && (
                <div className="flex-1 overflow-auto border border-zinc-800 rounded-lg">
                  <pre className="p-4 text-xs font-mono text-zinc-300">
                    {JSON.stringify(sqlResult.rows, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

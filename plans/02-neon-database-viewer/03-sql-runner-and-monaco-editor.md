# 03. Monaco SQL Editor & Query Runner Engine

This document details the integrated SQL Runner inspired by Neon, featuring a customized Monaco Editor with context-aware auto-completion, transaction safety modes, and visual `EXPLAIN ANALYZE` execution plans.

---

## 1. Monaco Editor with Live Schema Autocompletion

Monaco (`@monaco-editor/react`) provides the IDE feel. We configure a custom completion provider that registers table names and column names dynamically from our introspection cache:

```tsx
// components/database-studio/MonacoSqlEditor.tsx
import React, { useEffect, useRef } from 'react';
import Editor, { useMonaco } from '@monaco-editor/react';
import { TableSummary } from '@/services/PostgresIntrospectionService';

interface MonacoSqlEditorProps {
  value: string;
  onChange: (val: string) => void;
  onExecute: () => void;
  tables: TableSummary[];
}

export function MonacoSqlEditor({ value, onChange, onExecute, tables }: MonacoSqlEditorProps) {
  const monaco = useMonaco();

  useEffect(() => {
    if (!monaco) return;

    // Register live Postgres schema autocompletions
    const disposable = monaco.languages.registerCompletionItemProvider('sql', {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const suggestions: any[] = [];

        // 1. Suggest Table Names
        for (const tbl of tables) {
          suggestions.push({
            label: tbl.name,
            kind: monaco.languages.CompletionItemKind.Class,
            insertText: tbl.name,
            detail: `Table (${tbl.estimatedRows} rows)`,
            range,
          });

          // 2. Suggest Column Names
          for (const col of tbl.columns) {
            suggestions.push({
              label: `${tbl.name}.${col.name}`,
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: col.name,
              detail: `${col.dataType} in ${tbl.name}`,
              range,
            });
          }
        }

        // 3. Common SQL Keywords
        const keywords = ['SELECT', 'FROM', 'WHERE', 'INSERT INTO', 'UPDATE', 'DELETE', 'JOIN', 'LEFT JOIN', 'GROUP BY', 'ORDER BY', 'LIMIT'];
        for (const kw of keywords) {
          suggestions.push({
            label: kw,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: kw,
            range,
          });
        }

        return { suggestions };
      },
    });

    return () => disposable.dispose();
  }, [monaco, tables]);

  return (
    <div className="h-64 border border-zinc-800 rounded-lg overflow-hidden bg-[#1e1e1e]">
      <Editor
        height="100%"
        defaultLanguage="sql"
        theme="vs-dark"
        value={value}
        onChange={(v) => onChange(v || '')}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          fontFamily: 'JetBrains Mono, Menlo, monospace',
        }}
        onMount={(editor) => {
          // Bind Cmd+Enter (Mac) or Ctrl+Enter (Win/Linux) to run query
          editor.addCommand(monaco!.KeyMod.CtrlCmd | monaco!.KeyCode.Enter, () => {
            onExecute();
          });
        }}
      />
    </div>
  );
}
```

---

## 2. Backend Query Execution Pipeline

The query runner handles timeout enforcement, safe read-only mode, and tracks query duration down to milliseconds:

```typescript
// services/SqlQueryRunnerService.ts
import { Pool } from 'pg';

export interface QueryExecutionResult {
  command: string;
  rowCount: number;
  durationMs: number;
  fields: { name: string; dataTypeId: number }[];
  rows: any[];
  error?: string;
}

export class SqlQueryRunnerService {
  constructor(private pool: Pool) {}

  async executeQuery({
    sql,
    readOnly = false,
    timeoutMs = 15000,
  }: {
    sql: string;
    readOnly?: boolean;
    timeoutMs?: number;
  }): Promise<QueryExecutionResult> {
    const client = await this.pool.connect();
    const startTime = performance.now();

    try {
      // 1. Set statement timeout
      await client.query(`SET statement_timeout = ${timeoutMs};`);

      // 2. Handle Read-Only transaction wrapper
      if (readOnly) {
        await client.query('BEGIN TRANSACTION READ ONLY;');
      }

      // 3. Execute query
      const result = await client.query(sql);

      if (readOnly) {
        await client.query('COMMIT;');
      }

      const durationMs = Math.round(performance.now() - startTime);

      return {
        command: result.command,
        rowCount: result.rowCount || (result.rows ? result.rows.length : 0),
        durationMs,
        fields: result.fields.map((f) => ({ name: f.name, dataTypeId: f.dataTypeID })),
        rows: result.rows,
      };
    } catch (err: any) {
      if (readOnly) {
        try {
          await client.query('ROLLBACK;');
        } catch {}
      }
      throw new Error(err.message || 'SQL execution failed');
    } finally {
      client.release();
    }
  }
}
```

---

## 3. Visual EXPLAIN (ANALYZE) Visualizer

To replicate Neon's query optimization assistance, the platform parses PostgreSQL's execution plan:

### 3.1 Fetching Plan in JSON Format
```sql
EXPLAIN (ANALYZE, COSTS, VERBOSE, BUFFERS, FORMAT JSON)
SELECT * FROM users WHERE email = 'alice@example.com';
```

### 3.2 Visualizing Bottlenecks
The JSON output contains the execution tree:
- `Node Type`: `Seq Scan`, `Index Scan`, `Hash Join`, `Sort`.
- `Total Cost`: Relative planner cost estimate.
- `Actual Total Time`: Milliseconds spent inside the node.
- **Alert Rule**: If `Node Type === 'Seq Scan'` on a table with `estimatedRows > 10,000`, the UI renders a warning:
  > ⚠️ **Sequential Scan Warning**: Table `users` was fully scanned (no index used). Adding an index on `(email)` will dramatically speed up this query.

---

## 4. Exporting Data (CSV / JSON)

The client provides 1-click download:
- **Export to CSV**: Streams RFC 4180 compliant CSV directly to the user's browser with proper escaping of strings and dates.
- **Export to JSON**: Formatted JSON array.
- **Copy as INSERT Statements**: Converts selected rows into reproducible SQL `INSERT INTO <table> VALUES (...)`.

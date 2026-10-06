# 02. PostgreSQL Database Introspection Engine

To power a Neon-style Table Studio and Monaco autocompletion, the Control Plane needs deep, high-speed introspection into the target PostgreSQL database. This document provides the SQL queries and TypeScript implementation for catalog introspection.

---

## 1. Introspection SQL Queries

### 1.1 List All User Tables with Estimated Row Counts & Sizes
Running `SELECT count(*)` on huge tables causes disk I/O spikes. We query PostgreSQL's statistics catalog (`pg_stat_user_tables` and `pg_class`) for instant, sub-millisecond table estimates:

```sql
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relkind AS table_type, -- 'r' = regular table, 'v' = view, 'm' = materialized view
  COALESCE(s.n_live_tup, c.reltuples::bigint, 0) AS estimated_row_count,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size_bytes,
  obj_description(c.oid, 'pg_class') AS description
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND c.relkind IN ('r', 'v', 'm')
ORDER BY n.nspname, c.relname;
```

---

### 1.2 Table Column Details, Data Types, and Nullability

```sql
SELECT
  col.table_schema,
  col.table_name,
  col.column_name,
  col.ordinal_position,
  col.column_default,
  col.is_nullable = 'YES' AS is_nullable,
  col.data_type,
  col.udt_name,
  col.character_maximum_length,
  col.numeric_precision,
  col.numeric_scale,
  col.is_identity = 'YES' AS is_identity,
  col.is_generated = 'ALWAYS' AS is_generated
FROM information_schema.columns col
WHERE col.table_schema = $1
  AND col.table_name = $2
ORDER BY col.ordinal_position;
```

---

### 1.3 Primary Keys, Foreign Keys & Unique Constraints

This unified constraint query extracts all primary keys and foreign key relationships (including target schema, target table, and target column) in a single round-trip:

```sql
SELECT
  con.conname AS constraint_name,
  con.contype AS constraint_type, -- 'p' = primary key, 'f' = foreign key, 'u' = unique
  att.attname AS column_name,
  -- Foreign Key Target Details:
  target_ns.nspname AS foreign_table_schema,
  target_tbl.relname AS foreign_table_name,
  target_att.attname AS foreign_column_name,
  con.confupdtype AS on_update_action,
  con.confdeltype AS on_delete_action
FROM pg_constraint con
JOIN pg_namespace ns ON ns.oid = con.connamespace
JOIN pg_class tbl ON tbl.oid = con.conrelid
JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
-- Join for foreign key target table & column:
LEFT JOIN pg_class target_tbl ON target_tbl.oid = con.confrelid
LEFT JOIN pg_namespace target_ns ON target_ns.oid = target_tbl.relnamespace
LEFT JOIN pg_attribute target_att ON target_att.attrelid = con.confrelid AND target_att.attnum = ANY(con.confkey)
WHERE ns.nspname = $1
  AND tbl.relname = $2;
```

---

### 1.4 Enum Values Introspection

```sql
SELECT
  t.typname AS enum_name,
  e.enumlabel AS enum_value
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY t.typname, e.enumsortorder;
```

---

## 2. Full TypeScript Introspection Service

```typescript
// services/PostgresIntrospectionService.ts
import { Pool, PoolClient } from 'pg';

export interface ColumnSchema {
  name: string;
  dataType: string;
  udtName: string;
  isNullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  foreignKey?: {
    targetSchema: string;
    targetTable: string;
    targetColumn: string;
  };
}

export interface TableSummary {
  schema: string;
  name: string;
  type: 'table' | 'view' | 'materialized_view';
  estimatedRows: number;
  totalSize: string;
  columns: ColumnSchema[];
}

export class PostgresIntrospectionService {
  constructor(private pool: Pool) {}

  /**
   * Introspects entire database schema and caches structure
   */
  async introspectDatabase(): Promise<{ tables: TableSummary[] }> {
    const client = await this.pool.connect();
    try {
      // 1. Fetch all tables
      const tablesRes = await client.query(`
        SELECT
          n.nspname AS schema_name,
          c.relname AS table_name,
          c.relkind AS table_type,
          COALESCE(s.n_live_tup, c.reltuples::bigint, 0) AS estimated_row_count,
          pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
          AND c.relkind IN ('r', 'v', 'm')
        ORDER BY n.nspname, c.relname;
      `);

      const tables: TableSummary[] = [];

      // 2. Introspect each table's columns and constraints
      for (const row of tablesRes.rows) {
        const columns = await this.getTableColumns(client, row.schema_name, row.table_name);
        tables.push({
          schema: row.schema_name,
          name: row.table_name,
          type: row.table_type === 'r' ? 'table' : row.table_type === 'v' ? 'view' : 'materialized_view',
          estimatedRows: Number(row.estimated_row_count),
          totalSize: row.total_size,
          columns,
        });
      }

      return { tables };
    } finally {
      client.release();
    }
  }

  private async getTableColumns(
    client: PoolClient,
    schema: string,
    table: string
  ): Promise<ColumnSchema[]> {
    // Query columns
    const columnsRes = await client.query(
      `
      SELECT
        column_name,
        data_type,
        udt_name,
        is_nullable = 'YES' AS is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position;
    `,
      [schema, table]
    );

    // Query constraints (PK & FK)
    const constraintsRes = await client.query(
      `
      SELECT
        con.contype,
        att.attname AS column_name,
        target_ns.nspname AS foreign_schema,
        target_tbl.relname AS foreign_table,
        target_att.attname AS foreign_column
      FROM pg_constraint con
      JOIN pg_namespace ns ON ns.oid = con.connamespace
      JOIN pg_class tbl ON tbl.oid = con.conrelid
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
      LEFT JOIN pg_class target_tbl ON target_tbl.oid = con.confrelid
      LEFT JOIN pg_namespace target_ns ON target_ns.oid = target_tbl.relnamespace
      LEFT JOIN pg_attribute target_att ON target_att.attrelid = con.confrelid AND target_att.attnum = ANY(con.confkey)
      WHERE ns.nspname = $1 AND tbl.relname = $2;
    `,
      [schema, table]
    );

    const pkColumns = new Set(
      constraintsRes.rows.filter((c) => c.contype === 'p').map((c) => c.column_name)
    );

    const fkMap = new Map<string, any>();
    for (const c of constraintsRes.rows.filter((c) => c.contype === 'f')) {
      fkMap.set(c.column_name, {
        targetSchema: c.foreign_schema,
        targetTable: c.foreign_table,
        targetColumn: c.foreign_column,
      });
    }

    return columnsRes.rows.map((col) => ({
      name: col.column_name,
      dataType: col.data_type,
      udtName: col.udt_name,
      isNullable: col.is_nullable,
      defaultValue: col.column_default,
      isPrimaryKey: pkColumns.has(col.column_name),
      foreignKey: fkMap.get(col.column_name),
    }));
  }
}
```

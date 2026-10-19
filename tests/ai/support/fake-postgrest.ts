// In-memory stand-in for the subset of the supabase-js query builder used by
// read-only snapshot code. It mimics PostgREST behavior that matters for
// correctness: server-side max_rows, inclusive ranges, exact counts,
// 416 for an offset past the end, column projection (unknown columns fail),
// and !inner embedded filters. Write methods record the attempt and fail.

export type FakeRow = Record<string, unknown>;

type FilterOp = "eq" | "gte" | "lte" | "in";

export type RecordedQuery = {
  table: string;
  columns: string | null;
  count: string | null;
  filters: { op: FilterOp; column: string; value: unknown }[];
  orders: { column: string; ascending: boolean }[];
  range: { from: number; to: number } | null;
};

export type FakeResult = {
  data: FakeRow[] | null;
  error: { message: string; code: string } | null;
  count: number | null;
};

export type FakePostgrestOptions = {
  serverMaxRows?: number;
  // Runs before each request executes; can mutate tables to simulate
  // concurrent writes between pages.
  beforeExecute?: (
    query: RecordedQuery,
    tables: Record<string, FakeRow[]>,
  ) => void;
  failTable?: { table: string; message: string };
};

type SelectField = {
  key: string;
  nested: SelectField[] | null;
};

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of text) {
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    }

    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function parseSelect(columns: string): SelectField[] {
  return splitTopLevel(columns).map((part) => {
    const open = part.indexOf("(");

    if (open === -1) {
      return { key: part, nested: null };
    }

    const head = part.slice(0, open);
    const inner = part.slice(open + 1, part.lastIndexOf(")"));

    return {
      key: head.split("!")[0],
      nested: parseSelect(inner),
    };
  });
}

function project(
  row: FakeRow,
  fields: SelectField[],
): FakeRow {
  const projected: FakeRow = {};

  for (const field of fields) {
    if (!(field.key in row)) {
      throw new Error(
        `column ${field.key} does not exist`,
      );
    }

    const value = row[field.key];

    projected[field.key] =
      field.nested && value && typeof value === "object"
        ? project(value as FakeRow, field.nested)
        : value;
  }

  return projected;
}

function valueAt(row: FakeRow, path: string): unknown {
  let current: unknown = row;

  for (const key of path.split(".")) {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    current = (current as FakeRow)[key];
  }

  return current;
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }

  const left = String(a);
  const right = String(b);

  return left < right ? -1 : left > right ? 1 : 0;
}

function matches(
  row: FakeRow,
  filter: RecordedQuery["filters"][number],
): boolean {
  const value = valueAt(row, filter.column);

  switch (filter.op) {
    case "eq":
      return value === filter.value;
    case "gte":
      return compareValues(value, filter.value) >= 0;
    case "lte":
      return compareValues(value, filter.value) <= 0;
    case "in":
      return (filter.value as unknown[]).includes(value);
  }
}

export class FakeQuery implements PromiseLike<FakeResult> {
  private readonly query: RecordedQuery;

  constructor(
    private readonly client: FakePostgrest,
    table: string,
  ) {
    this.query = {
      table,
      columns: null,
      count: null,
      filters: [],
      orders: [],
      range: null,
    };
  }

  select(
    columns: string,
    options?: { count?: string },
  ): this {
    this.query.columns = columns;
    this.query.count = options?.count ?? null;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.query.filters.push({ op: "eq", column, value });
    return this;
  }

  gte(column: string, value: unknown): this {
    this.query.filters.push({ op: "gte", column, value });
    return this;
  }

  lte(column: string, value: unknown): this {
    this.query.filters.push({ op: "lte", column, value });
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.query.filters.push({
      op: "in",
      column,
      value: values,
    });
    return this;
  }

  order(
    column: string,
    options?: { ascending?: boolean },
  ): this {
    this.query.orders.push({
      column,
      ascending: options?.ascending ?? true,
    });
    return this;
  }

  range(from: number, to: number): this {
    this.query.range = { from, to };
    return this;
  }

  insert(): never {
    return this.client.rejectWrite(`insert:${this.query.table}`);
  }

  update(): never {
    return this.client.rejectWrite(`update:${this.query.table}`);
  }

  upsert(): never {
    return this.client.rejectWrite(`upsert:${this.query.table}`);
  }

  delete(): never {
    return this.client.rejectWrite(`delete:${this.query.table}`);
  }

  then<TResult1 = FakeResult, TResult2 = never>(
    onfulfilled?:
      | ((value: FakeResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve()
      .then(() => this.client.execute(this.query))
      .then(onfulfilled, onrejected);
  }
}

export class FakePostgrest {
  readonly queries: RecordedQuery[] = [];
  readonly writeAttempts: string[] = [];

  constructor(
    readonly tables: Record<string, FakeRow[]>,
    readonly options: FakePostgrestOptions = {},
  ) {}

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  rpc(name: string): never {
    return this.rejectWrite(`rpc:${name}`);
  }

  rejectWrite(operation: string): never {
    this.writeAttempts.push(operation);
    throw new Error(
      `Write operation is not allowed: ${operation}`,
    );
  }

  queriesFor(table: string): RecordedQuery[] {
    return this.queries.filter(
      (query) => query.table === table,
    );
  }

  execute(query: RecordedQuery): FakeResult {
    const snapshot: RecordedQuery = structuredClone(query);

    this.queries.push(snapshot);
    this.options.beforeExecute?.(snapshot, this.tables);

    if (this.options.failTable?.table === query.table) {
      return {
        data: null,
        error: {
          message: this.options.failTable.message,
          code: "XX000",
        },
        count: null,
      };
    }

    let rows = (this.tables[query.table] ?? []).filter(
      (row) =>
        query.filters.every((filter) =>
          matches(row, filter),
        ),
    );

    rows = [...rows].sort((a, b) => {
      for (const order of query.orders) {
        const result = compareValues(
          valueAt(a, order.column),
          valueAt(b, order.column),
        );

        if (result !== 0) {
          return order.ascending ? result : -result;
        }
      }

      return 0;
    });

    const total = rows.length;
    const serverMaxRows =
      this.options.serverMaxRows ?? 1000;

    let page: FakeRow[];

    if (query.range) {
      const { from, to } = query.range;

      if (from > 0 && from >= total) {
        return {
          data: null,
          error: {
            message: "Requested range not satisfiable",
            code: "PGRST103",
          },
          count: null,
        };
      }

      page = rows.slice(
        from,
        Math.min(to + 1, from + serverMaxRows),
      );
    } else {
      page = rows.slice(0, serverMaxRows);
    }

    let data: FakeRow[];

    try {
      const fields = parseSelect(query.columns ?? "*");

      data =
        query.columns === null || query.columns === "*"
          ? page
          : page.map((row) => project(row, fields));
    } catch (error) {
      return {
        data: null,
        error: {
          message: (error as Error).message,
          code: "42703",
        },
        count: null,
      };
    }

    return {
      data,
      error: null,
      count: query.count === "exact" ? total : null,
    };
  }
}

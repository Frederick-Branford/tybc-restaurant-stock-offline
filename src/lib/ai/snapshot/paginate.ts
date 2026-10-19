// Read-only pagination for PostgREST-style range reads.
//
// PostgREST caps every response at `max_rows` (1000 in supabase/config.toml).
// A plain select silently returns the first 1000 rows, so any dataset that can
// grow past that must be read page by page and checked for completeness.
//
// This module is pure: it knows nothing about Supabase. Callers pass a
// function that reads one inclusive row range and reports the exact total
// (`count: "exact"`) for the same filters.

export const POSTGREST_MAX_ROWS = 1000;

export const DEFAULT_MAX_ROWS = 100_000;

export type PageError = {
  message: string;
  code?: string;
};

export type PageResult<Row> = {
  data: Row[] | null;
  error: PageError | null;
  count: number | null;
};

export type PageRange = {
  from: number;
  to: number;
};

export type PageFetcher<Row> = (
  range: PageRange,
) => PromiseLike<PageResult<Row>>;

export type PaginationOptions<Row> = {
  label: string;
  getRowId: (row: Row) => string;
  pageSize?: number;
  maxRows?: number;
};

export type IncompleteReason =
  | "COUNT_UNAVAILABLE"
  | "COUNT_CHANGED"
  | "MAX_ROWS_EXCEEDED"
  | "ROW_COUNT_MISMATCH"
  | "DUPLICATE_ROWS";

export type PaginatedRead<Row> = {
  rows: Row[];
  expected_rows: number | null;
  rows_read: number;
  pages: number;
  complete: boolean;
  incomplete_reason: IncompleteReason | null;
};

function assertPositiveInteger(
  name: string,
  value: number,
) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `${name} must be a positive integer.`,
    );
  }
}

/**
 * Reads every row of a filtered, stably ordered dataset.
 *
 * Termination:
 * - with an exact count: keep reading until `count` rows have been read or
 *   a page comes back empty. The next range starts at the number of rows
 *   actually received, so a server cap smaller than `pageSize` cannot end
 *   the read early, and no range past the end is requested (PostgREST
 *   answers that with 416).
 * - without a count: stop on the first short or empty page, and report the
 *   result as incomplete because it cannot be proven complete.
 *
 * Completeness is proven only when the count was available, stayed the same
 * on every page, equals the number of rows read, and every row id is unique.
 * Errors are thrown, never treated as an empty page.
 */
export async function readAllPages<Row>(
  fetchPage: PageFetcher<Row>,
  options: PaginationOptions<Row>,
): Promise<PaginatedRead<Row>> {
  const pageSize =
    options.pageSize ?? POSTGREST_MAX_ROWS;

  const maxRows =
    options.maxRows ?? DEFAULT_MAX_ROWS;

  assertPositiveInteger("pageSize", pageSize);
  assertPositiveInteger("maxRows", maxRows);

  const rows: Row[] = [];

  let expected: number | null = null;
  let countChanged = false;
  let maxRowsExceeded = false;
  let pages = 0;

  while (rows.length < maxRows) {
    const from = rows.length;

    const to =
      Math.min(from + pageSize, maxRows) - 1;

    const result = await fetchPage({ from, to });

    pages += 1;

    if (result.error) {
      throw new Error(
        `${options.label}: ${result.error.message}`,
      );
    }

    if (pages === 1) {
      expected = result.count;
    } else if (result.count !== expected) {
      countChanged = true;
    }

    const page = result.data ?? [];

    for (const row of page) {
      rows.push(row);
    }

    if (expected !== null && expected > maxRows) {
      maxRowsExceeded = true;
      break;
    }

    if (page.length === 0) {
      break;
    }

    if (expected !== null) {
      if (rows.length >= expected) {
        break;
      }
    } else if (page.length < to - from + 1) {
      break;
    }
  }

  if (
    rows.length >= maxRows &&
    (expected === null || expected > rows.length)
  ) {
    maxRowsExceeded = true;
  }

  const uniqueIds = new Set(
    rows.map((row) => options.getRowId(row)),
  );

  let incompleteReason: IncompleteReason | null =
    null;

  if (expected === null) {
    incompleteReason = "COUNT_UNAVAILABLE";
  } else if (maxRowsExceeded) {
    incompleteReason = "MAX_ROWS_EXCEEDED";
  } else if (countChanged) {
    incompleteReason = "COUNT_CHANGED";
  } else if (uniqueIds.size !== rows.length) {
    incompleteReason = "DUPLICATE_ROWS";
  } else if (rows.length !== expected) {
    incompleteReason = "ROW_COUNT_MISMATCH";
  }

  return {
    rows,
    expected_rows: expected,
    rows_read: rows.length,
    pages,
    complete: incompleteReason === null,
    incomplete_reason: incompleteReason,
  };
}

import { describe, expect, it, vi } from "vitest";

import {
  readAllPages,
  type PageRange,
  type PageResult,
} from "@/lib/ai/snapshot/paginate";

type Row = { id: string };

function rowsOf(count: number, prefix = "r"): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${String(index).padStart(6, "0")}`,
  }));
}

/**
 * Simulates PostgREST range reads: inclusive ranges, a server-side row cap,
 * an exact count, and 416 (PGRST103) for an offset past the end.
 */
function postgrestLike(
  source: () => Row[],
  options: {
    serverMaxRows?: number;
    withCount?: boolean;
  } = {},
) {
  const serverMaxRows = options.serverMaxRows ?? 1000;
  const withCount = options.withCount ?? true;

  return vi.fn(
    async ({
      from,
      to,
    }: PageRange): Promise<PageResult<Row>> => {
      const rows = source();

      if (from > 0 && from >= rows.length) {
        return {
          data: null,
          error: {
            message: "Requested range not satisfiable",
            code: "PGRST103",
          },
          count: null,
        };
      }

      const end = Math.min(to + 1, from + serverMaxRows);

      return {
        data: rows.slice(from, end),
        error: null,
        count: withCount ? rows.length : null,
      };
    },
  );
}

const options = {
  label: "test_rows",
  getRowId: (row: Row) => row.id,
};

describe("readAllPages", () => {
  it.each([
    [0, 1],
    [1, 1],
    [999, 1],
    [1000, 1],
    [1001, 2],
    [2500, 3],
    [5000, 5],
  ])(
    "reads all %d rows in %d page(s) and proves completeness",
    async (total, expectedPages) => {
      const source = rowsOf(total);
      const fetchPage = postgrestLike(() => source);

      const result = await readAllPages(fetchPage, options);

      expect(result.rows).toEqual(source);
      expect(result.pages).toBe(expectedPages);
      expect(fetchPage).toHaveBeenCalledTimes(expectedPages);
      expect(result).toMatchObject({
        expected_rows: total,
        rows_read: total,
        complete: true,
        incomplete_reason: null,
      });
    },
  );

  it("requests contiguous inclusive ranges", async () => {
    const fetchPage = postgrestLike(() => rowsOf(2500));

    await readAllPages(fetchPage, options);

    expect(
      fetchPage.mock.calls.map(([range]) => range),
    ).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
      { from: 2000, to: 2999 },
    ]);
  });

  it("does not request a page past the end at exactly 1000 rows", async () => {
    const fetchPage = postgrestLike(() => rowsOf(1000));

    const result = await readAllPages(fetchPage, options);

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.complete).toBe(true);
  });

  it("stays complete when the server cap is smaller than the page size", async () => {
    const source = rowsOf(1001);

    const fetchPage = postgrestLike(() => source, {
      serverMaxRows: 300,
    });

    const result = await readAllPages(fetchPage, options);

    expect(result.rows).toEqual(source);
    expect(result.pages).toBe(4);
    expect(result.complete).toBe(true);
    expect(fetchPage.mock.calls[1][0]).toEqual({
      from: 300,
      to: 1299,
    });
  });

  it("marks the read incomplete when the count changes between pages", async () => {
    let source = rowsOf(1500);

    const fetchPage = postgrestLike(() => source);

    fetchPage.mockImplementationOnce(async () => {
      const page = source.slice(0, 1000);
      const count = source.length;

      // A concurrent insert lands after the first page was read.
      source = [...source, { id: "late-row" }];

      return { data: page, error: null, count };
    });

    const result = await readAllPages(fetchPage, options);

    expect(result.complete).toBe(false);
    expect(result.incomplete_reason).toBe("COUNT_CHANGED");
  });

  it("marks the read incomplete when rows disappear before the count is reached", async () => {
    const fetchPage = vi.fn(
      async ({ from }: PageRange): Promise<PageResult<Row>> => ({
        data: from === 0 ? rowsOf(1000) : [],
        error: null,
        count: 1500,
      }),
    );

    const result = await readAllPages(fetchPage, options);

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      rows_read: 1000,
      expected_rows: 1500,
      complete: false,
      incomplete_reason: "ROW_COUNT_MISMATCH",
    });
  });

  it("detects duplicate rows from unstable ordering", async () => {
    const fetchPage = vi.fn(
      async ({ from }: PageRange): Promise<PageResult<Row>> => ({
        data:
          from === 0
            ? rowsOf(1000)
            : rowsOf(2, "r").slice(1, 2),
        error: null,
        count: 1001,
      }),
    );

    const result = await readAllPages(fetchPage, options);

    expect(result.rows_read).toBe(1001);
    expect(result.complete).toBe(false);
    expect(result.incomplete_reason).toBe("DUPLICATE_ROWS");
  });

  it("cannot prove completeness without an exact count", async () => {
    const source = rowsOf(1500);

    const fetchPage = postgrestLike(() => source, {
      withCount: false,
    });

    const result = await readAllPages(fetchPage, options);

    expect(result.rows).toEqual(source);
    expect(result.complete).toBe(false);
    expect(result.incomplete_reason).toBe(
      "COUNT_UNAVAILABLE",
    );
  });

  it("stops early and reports incomplete when the dataset exceeds maxRows", async () => {
    const fetchPage = postgrestLike(() => rowsOf(5000));

    const result = await readAllPages(fetchPage, {
      ...options,
      maxRows: 2000,
    });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      expected_rows: 5000,
      rows_read: 1000,
      complete: false,
      incomplete_reason: "MAX_ROWS_EXCEEDED",
    });
  });

  it("is complete when the dataset is exactly maxRows", async () => {
    const fetchPage = postgrestLike(() => rowsOf(2000));

    const result = await readAllPages(fetchPage, {
      ...options,
      maxRows: 2000,
    });

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(result.complete).toBe(true);
  });

  it("throws on a query error instead of treating it as an empty page", async () => {
    const fetchPage = vi.fn(
      async (): Promise<PageResult<Row>> => ({
        data: null,
        error: { message: "permission denied" },
        count: null,
      }),
    );

    await expect(
      readAllPages(fetchPage, options),
    ).rejects.toThrow("test_rows: permission denied");
  });

  it("rejects an invalid page size", async () => {
    const fetchPage = postgrestLike(() => rowsOf(1));

    await expect(
      readAllPages(fetchPage, { ...options, pageSize: 0 }),
    ).rejects.toThrow("pageSize must be a positive integer.");
    expect(fetchPage).not.toHaveBeenCalled();
  });
});

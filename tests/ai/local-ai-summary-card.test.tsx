// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalAiSummaryCard } from "@/components/local-ai-summary-card";
import type { LocalAiSummaryResponse } from "@/lib/ai/local/api-contract";
import {
  LOCAL_AI_FAILURE_MESSAGES,
  LOCAL_AI_SUMMARY_ENDPOINT,
} from "@/lib/ai/local/ui-view";

import {
  FIXTURE_ACTION,
  FIXTURE_NOTE,
  FIXTURE_OVERVIEW,
  INJECTED_TEXT,
  chickenFacts,
  summaryFixture,
  summaryWithUnknownFields,
} from "./support/local-ui-fixtures";

afterEach(cleanup);

const IDLE_LABEL = "วิเคราะห์ด้วย Local AI";
const LOADING_LABEL = "กำลังวิเคราะห์...";

// Raw server text that must never be displayed.
const SERVER_ERROR_TEXT =
  "connect ECONNREFUSED 127.0.0.1:11434 at TCPConnectWrap.afterConnect";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function errorResponse(status: number, code: string): Response {
  return jsonResponse(status, { code, error: SERVER_ERROR_TEXT });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

type FetchArgs = [input: RequestInfo | URL, init?: RequestInit];

function stubFetch(
  ...responses: Array<Response | Promise<Response>>
) {
  const fetchMock = vi.fn(async (...args: FetchArgs) => {
    void args;
    const next = responses.shift();

    if (!next) {
      throw new Error("Unexpected extra fetch");
    }

    return next;
  });

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

function analyzeButton(): HTMLButtonElement {
  return screen.getByRole("button", {
    name: new RegExp(`${IDLE_LABEL}|${LOADING_LABEL}`),
  });
}

function renderCard(
  availability: "enabled" | "disabled" | "misconfigured" = "enabled",
) {
  return render(<LocalAiSummaryCard availability={availability} />);
}

async function analyzeWith(body: unknown) {
  const fetchMock = stubFetch(jsonResponse(200, body));

  renderCard();
  fireEvent.click(analyzeButton());
  await screen.findByTestId("local-ai-result");

  return fetchMock;
}

async function analyzeExpectingAlert(response: Response) {
  const fetchMock = stubFetch(response);

  renderCard();
  fireEvent.click(analyzeButton());

  const alert = await screen.findByRole("alert");

  return { alert, fetchMock };
}

function withResult(
  update: (summary: LocalAiSummaryResponse) => void,
): LocalAiSummaryResponse {
  const summary = summaryFixture();
  update(summary);

  return summary;
}

describe("LocalAiSummaryCard — success rendering", () => {
  it("calls only the Local AI endpoint with POST and no body", async () => {
    const fetchMock = await analyzeWith(summaryFixture());

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [input, init] = fetchMock.mock.calls[0];

    expect(input).toBe(LOCAL_AI_SUMMARY_ENDPOINT);
    expect(input).toBe("/api/ai/local/summary");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
    expect(init?.cache).toBe("no-store");
  });

  it("1. renders the overview", async () => {
    await analyzeWith(summaryFixture());

    expect(
      screen.getByRole("heading", { name: "ภาพรวม" }),
    ).toBeInTheDocument();
    expect(screen.getByText(FIXTURE_OVERVIEW)).toBeInTheDocument();
  });

  it("1. explains a missing overview", async () => {
    await analyzeWith(
      withResult((summary) => {
        summary.result.overview = null;
      }),
    );

    expect(
      screen.getByText("Local AI ไม่ได้สรุปภาพรวมในรอบนี้"),
    ).toBeInTheDocument();
  });

  it("2. resolves the attention SKU to the item name from facts", async () => {
    await analyzeWith(summaryFixture());

    const attention = within(screen.getByTestId("local-ai-attention"));

    expect(attention.getByText("อกไก่")).toBeInTheDocument();
    expect(attention.getByText("SKU: CHICKEN-BREAST")).toBeInTheDocument();
    expect(attention.getByText("มีของเสีย")).toBeInTheDocument();
    expect(attention.getByText(FIXTURE_NOTE)).toBeInTheDocument();
  });

  it("3. shows quantities and the reorder position from facts", async () => {
    await analyzeWith(summaryFixture());

    const facts = within(
      screen.getByTestId("local-ai-facts-CHICKEN-BREAST"),
    );

    expect(facts.getByText("11,700 g")).toBeInTheDocument();
    expect(facts.getByText("7,000 g")).toBeInTheDocument();
    expect(facts.getByText("3,000 g")).toBeInTheDocument();
    expect(facts.getByText("600 g")).toBeInTheDocument();
    expect(
      facts.getByText("สูงกว่าจุดสั่งซื้อ 4,700 g"),
    ).toBeInTheDocument();
  });

  it("3. follows the facts when they change (nothing hard-coded)", async () => {
    await analyzeWith(
      withResult((summary) => {
        summary.facts.items[0] = chickenFacts({
          current_quantity: 12345.5,
          reorder_point: 7000,
        });
      }),
    );

    const facts = within(
      screen.getByTestId("local-ai-facts-CHICKEN-BREAST"),
    );

    expect(facts.getByText("12,345.5 g")).toBeInTheDocument();
    expect(
      facts.getByText("สูงกว่าจุดสั่งซื้อ 5,345.5 g"),
    ).toBeInTheDocument();
    expect(facts.queryByText("11,700 g")).not.toBeInTheDocument();
  });

  it("renders actions as plain text", async () => {
    await analyzeWith(summaryFixture());

    expect(
      screen.getByRole("heading", { name: "คำแนะนำ" }),
    ).toBeInTheDocument();
    expect(screen.getByText(FIXTURE_ACTION)).toBeInTheDocument();
  });

  it("4. shows the empty state when there are no actions", async () => {
    await analyzeWith(
      withResult((summary) => {
        summary.result.actions = [];
      }),
    );

    expect(
      screen.getByText("ยังไม่มีคำแนะนำเพิ่มเติมจากการวิเคราะห์รอบนี้"),
    ).toBeInTheDocument();
  });

  it("5. maps server data limits to Thai and hides the codes", async () => {
    await analyzeWith(
      withResult((summary) => {
        summary.result.server_data_limits = [
          "ITEMS_OMITTED",
          "USAGE_RATE_UNAVAILABLE",
          "FORECAST_UNAVAILABLE",
        ];
        summary.facts.data_quality.omitted_count = 3;
      }),
    );

    expect(
      screen.getByText("ยังไม่มีข้อมูลอัตราการใช้สินค้าเพียงพอ"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("ยังไม่สามารถคาดการณ์วันที่ Stock จะหมดได้"),
    ).toBeInTheDocument();
    expect(screen.getByText(/อีก 3 รายการ/)).toBeInTheDocument();

    const text = document.body.textContent ?? "";

    expect(text).not.toContain("USAGE_RATE_UNAVAILABLE");
    expect(text).not.toContain("FORECAST_UNAVAILABLE");
    expect(text).not.toContain("ITEMS_OMITTED");
  });

  it("lists facts items the model did not mention", async () => {
    await analyzeWith(summaryFixture());

    expect(
      screen.getByText("รายการอื่นที่ระบบตรวจพบ (1 รายการ)"),
    ).toBeInTheDocument();

    const basil = within(screen.getByTestId("local-ai-facts-THAI-BASIL"));

    expect(basil.getByText("800 g")).toBeInTheDocument();
    expect(
      basil.getByText(
        "ต่ำกว่าจุดสั่งซื้อ 200 g · มี PO ค้างรับ 2,000 g เมื่อรับครบจะสูงกว่าจุดสั่งซื้อ",
      ),
    ).toBeInTheDocument();
  });

  it("11. footer shows Local AI and qwen3.5:4b, never gpt-6.1-sol", async () => {
    await analyzeWith(summaryFixture());

    const footer = screen.getByTestId("local-ai-footer");

    expect(footer).toHaveTextContent(
      /^Local AI · qwen3\.5:4b · ประมวลผลบนเครื่อง · .*14:05/,
    );
    expect(document.body.textContent).not.toContain("gpt-6.1-sol");
    expect(screen.getAllByText("Local AI").length).toBeGreaterThan(0);
  });

  it("11. never renders a non-Ollama result as Local AI", async () => {
    const { alert } = await analyzeExpectingAlert(
      jsonResponse(200, {
        ...summaryFixture(),
        meta: {
          ...summaryFixture().meta,
          provider: "openai",
          model: "gpt-6.1-sol",
        },
      }),
    );

    expect(alert).toHaveTextContent(
      LOCAL_AI_FAILURE_MESSAGES.INVALID_RESPONSE,
    );
    expect(screen.queryByTestId("local-ai-result")).toBeNull();
    expect(document.body.textContent).not.toContain("gpt-6.1-sol");
  });

  it("12. unknown extra fields never become UI content", async () => {
    await analyzeWith(summaryWithUnknownFields());

    const text = document.body.textContent ?? "";

    for (const injected of Object.values(INJECTED_TEXT)) {
      expect(text).not.toContain(injected);
    }

    expect(text).not.toContain("11434");
    expect(screen.getByText(FIXTURE_OVERVIEW)).toBeInTheDocument();
  });

  it("13. model prose is shown verbatim but never used for numeric facts", async () => {
    await analyzeWith(
      withResult((summary) => {
        summary.result.overview = "คงเหลือ 99 kg";
        summary.result.attention[0].note = "เหลือ 5 g ต่ำกว่าจุดสั่งซื้อ 9,999 g";
        summary.result.actions = ["สั่งเพิ่ม 42 kg"];
      }),
    );

    expect(screen.getByText("คงเหลือ 99 kg")).toBeInTheDocument();
    expect(
      screen.getByText("เหลือ 5 g ต่ำกว่าจุดสั่งซื้อ 9,999 g"),
    ).toBeInTheDocument();

    const factsElement = screen.getByTestId(
      "local-ai-facts-CHICKEN-BREAST",
    );
    const facts = within(factsElement);

    expect(facts.getByText("11,700 g")).toBeInTheDocument();
    expect(
      facts.getByText("สูงกว่าจุดสั่งซื้อ 4,700 g"),
    ).toBeInTheDocument();

    const factsText = factsElement.textContent ?? "";

    for (const fromProse of ["99", "5 g", "9,999", "42"]) {
      expect(factsText).not.toContain(fromProse);
    }
  });
});

describe("LocalAiSummaryCard — loading and concurrency", () => {
  it("6. disables the button and marks the card busy while loading", async () => {
    const pending = deferred<Response>();
    stubFetch(pending.promise);

    renderCard();

    const region = screen.getByRole("region", { name: "AI วิเคราะห์ร้าน" });

    expect(region).toHaveAttribute("aria-busy", "false");

    fireEvent.click(analyzeButton());

    expect(analyzeButton()).toBeDisabled();
    expect(analyzeButton()).toHaveTextContent(LOADING_LABEL);
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Local AI กำลังวิเคราะห์ข้อมูล",
    );

    await act(async () => {
      pending.resolve(jsonResponse(200, summaryFixture()));
    });

    await screen.findByTestId("local-ai-result");

    expect(analyzeButton()).toBeEnabled();
    expect(analyzeButton()).toHaveTextContent(IDLE_LABEL);
    expect(region).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("status")).toHaveTextContent(
      "ผลวิเคราะห์จาก Local AI พร้อมแล้ว",
    );
  });

  it("7. repeated clicks while loading start no concurrent request", async () => {
    const pending = deferred<Response>();
    const fetchMock = stubFetch(
      pending.promise,
      jsonResponse(200, summaryFixture()),
    );

    renderCard();

    const button = analyzeButton();

    // Same tick, before React re-renders the disabled button.
    act(() => {
      button.click();
      button.click();
      button.click();
    });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(jsonResponse(200, summaryFixture()));
    });

    await waitFor(() => expect(analyzeButton()).toBeEnabled());

    // The guard is released afterwards: a new click starts one request.
    fireEvent.click(analyzeButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("keeps the previous result visible while refreshing", async () => {
    const second = deferred<Response>();
    stubFetch(jsonResponse(200, summaryFixture()), second.promise);

    renderCard();
    fireEvent.click(analyzeButton());
    await screen.findByText(FIXTURE_OVERVIEW);

    fireEvent.click(analyzeButton());

    expect(analyzeButton()).toBeDisabled();
    expect(screen.getByText(FIXTURE_OVERVIEW)).toBeInTheDocument();
    expect(
      screen.getByText("กำลังวิเคราะห์รอบใหม่ ผลด้านล่างเป็นของรอบก่อนหน้า"),
    ).toBeInTheDocument();

    await act(async () => {
      second.resolve(
        jsonResponse(
          200,
          withResult((summary) => {
            summary.result.overview = "ผลรอบใหม่";
          }),
        ),
      );
    });

    await screen.findByText("ผลรอบใหม่");
    expect(screen.queryByText(FIXTURE_OVERVIEW)).toBeNull();
  });

  it("keeps the previous result when a refresh fails", async () => {
    stubFetch(
      jsonResponse(200, summaryFixture()),
      errorResponse(429, "LOCAL_AI_BUSY"),
    );

    renderCard();
    fireEvent.click(analyzeButton());
    await screen.findByText(FIXTURE_OVERVIEW);

    fireEvent.click(analyzeButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      LOCAL_AI_FAILURE_MESSAGES.BUSY,
    );
    expect(screen.getByText(FIXTURE_OVERVIEW)).toBeInTheDocument();
  });
});

describe("LocalAiSummaryCard — error UX", () => {
  it("8. 429 shows the busy message and re-enables the button", async () => {
    const { alert } = await analyzeExpectingAlert(
      errorResponse(429, "LOCAL_AI_BUSY"),
    );

    expect(alert).toHaveTextContent(
      "Local AI กำลังวิเคราะห์คำขอก่อนหน้า กรุณารอสักครู่",
    );
    expect(analyzeButton()).toBeEnabled();
  });

  it("9. 404 says Local AI is not enabled on this machine", async () => {
    const { alert } = await analyzeExpectingAlert(
      errorResponse(404, "LOCAL_AI_DISABLED"),
    );

    expect(alert).toHaveTextContent(
      "Local AI ยังไม่ได้เปิดใช้งานบนเครื่องนี้",
    );
  });

  it("10. 503 asks to check Ollama and never falls back to Cloud AI", async () => {
    const { alert, fetchMock } = await analyzeExpectingAlert(
      errorResponse(503, "OLLAMA_UNREACHABLE"),
    );

    expect(alert).toHaveTextContent(
      "ไม่สามารถเชื่อมต่อ Local AI ได้ กรุณาตรวจสอบ Ollama",
    );

    // Give any (forbidden) follow-up request a chance to start.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/ai/local/summary");

    for (const [input] of fetchMock.mock.calls) {
      expect(String(input)).not.toBe("/api/ai/summary");
    }
  });

  it.each([
    [401, "UNAUTHENTICATED", LOCAL_AI_FAILURE_MESSAGES.UNAUTHENTICATED],
    [403, "FORBIDDEN", LOCAL_AI_FAILURE_MESSAGES.FORBIDDEN],
    [504, "OLLAMA_TIMEOUT", "Local AI ใช้เวลานานเกินไป กรุณาลองใหม่"],
    [502, "INVALID_MODEL_OUTPUT", LOCAL_AI_FAILURE_MESSAGES.LOCAL_AI_FAILED],
    [500, "SNAPSHOT_FAILED", LOCAL_AI_FAILURE_MESSAGES.SYSTEM],
  ])("%s shows a fixed message", async (status, code, message) => {
    const { alert } = await analyzeExpectingAlert(
      errorResponse(status, code),
    );

    expect(alert).toHaveTextContent(message);
  });

  it("401 offers a link to sign in again", async () => {
    const { alert } = await analyzeExpectingAlert(
      errorResponse(401, "UNAUTHENTICATED"),
    );

    expect(
      within(alert).getByRole("link", { name: "ไปหน้าเข้าสู่ระบบ" }),
    ).toHaveAttribute("href", "/login");
  });

  it.each([401, 403, 404, 429, 500, 502, 503, 504])(
    "%s never displays server error text",
    async (status) => {
      await analyzeExpectingAlert(errorResponse(status, "INTERNAL_ERROR"));

      const text = document.body.textContent ?? "";

      expect(text).not.toContain("ECONNREFUSED");
      expect(text).not.toContain("127.0.0.1");
      expect(text).not.toContain("TCPConnectWrap");
    },
  );

  it("a network failure shows a fixed message", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError(SERVER_ERROR_TEXT);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderCard();
    fireEvent.click(analyzeButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      LOCAL_AI_FAILURE_MESSAGES.NETWORK,
    );
    expect(document.body.textContent).not.toContain("ECONNREFUSED");
    expect(analyzeButton()).toBeEnabled();
  });

  it("an unreadable 200 body shows a fixed message", async () => {
    stubFetch({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    } as unknown as Response);

    renderCard();
    fireEvent.click(analyzeButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      LOCAL_AI_FAILURE_MESSAGES.INVALID_RESPONSE,
    );
    expect(document.body.textContent).not.toContain("Unexpected token");
  });
});

describe("LocalAiSummaryCard — availability", () => {
  it("disabled: explains and never calls the API", () => {
    const fetchMock = stubFetch();

    renderCard("disabled");

    expect(analyzeButton()).toBeDisabled();
    expect(
      screen.getByText(/Local AI ยังไม่ได้เปิดใช้งานบนเครื่องนี้/),
    ).toBeInTheDocument();

    fireEvent.click(analyzeButton());

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("misconfigured: explains and never calls the API", () => {
    const fetchMock = stubFetch();

    renderCard("misconfigured");

    expect(analyzeButton()).toBeDisabled();
    expect(
      screen.getByText(LOCAL_AI_FAILURE_MESSAGES.MISCONFIGURED),
    ).toBeInTheDocument();

    fireEvent.click(analyzeButton());

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enabled: shows the primary action before any request", () => {
    const fetchMock = stubFetch();

    renderCard();

    expect(analyzeButton()).toBeEnabled();
    expect(analyzeButton()).toHaveTextContent(IDLE_LABEL);
    expect(screen.getByText("Local AI")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

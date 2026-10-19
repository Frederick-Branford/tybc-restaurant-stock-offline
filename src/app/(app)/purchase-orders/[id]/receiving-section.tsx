import { randomUUID } from "node:crypto";
import {
  PackageCheck,
  ReceiptText,
} from "lucide-react";

import { Field } from "@/components/app/form-controls";
import { Notice } from "@/components/app/notice";
import {
  Panel,
  SectionHeader,
} from "@/components/app/page-header";
import { SubmitButton } from "@/components/app/submit-button";
import { Input } from "@/components/ui/input";
import {
  formatDateTime,
  formatQuantity,
} from "@/lib/ui/format";
import { createClient } from "@/lib/supabase/server";

import {
  receivePurchaseOrderItem,
} from "../actions";

type ReceivingSectionProps = {
  purchaseOrderId: string;
  status: string;
};

type ReceiptItemRow = {
  purchase_receipt_id: string;
  item_id: string;
  received_quantity: number;
  receive_unit_id: string;
};

export async function ReceivingSection({
  purchaseOrderId,
  status,
}: ReceivingSectionProps) {
  if (
    ![
      "ORDERED",
      "PARTIALLY_RECEIVED",
      "RECEIVED",
    ].includes(status)
  ) {
    return null;
  }

  const supabase =
    await createClient();

  const {
    data: lines,
    error: linesError,
  } = await supabase
    .from("purchase_order_items")
    .select(
      "id, item_id, ordered_quantity, received_quantity, order_unit_id",
    )
    .eq(
      "purchase_order_id",
      purchaseOrderId,
    )
    .order("created_at");

  if (linesError) {
    throw new Error(
      `Unable to load receiving lines: ${linesError.message}`,
    );
  }

  const itemIds = [
    ...new Set(
      (lines ?? []).map(
        (line) => line.item_id,
      ),
    ),
  ];

  const unitIds = [
    ...new Set(
      (lines ?? []).map(
        (line) =>
          line.order_unit_id,
      ),
    ),
  ];

  const {
    data: items,
  } =
    itemIds.length > 0
      ? await supabase
          .from("items")
          .select(
            "id, sku, name",
          )
          .in(
            "id",
            itemIds,
          )
      : {
          data: [],
        };

  const {
    data: units,
  } =
    unitIds.length > 0
      ? await supabase
          .from("units")
          .select(
            "id, name, symbol",
          )
          .in(
            "id",
            unitIds,
          )
      : {
          data: [],
        };

  const {
    data: receipts,
    error: receiptsError,
  } = await supabase
    .from("purchase_receipts")
    .select(
      "id, receipt_number, note, received_at",
    )
    .eq(
      "purchase_order_id",
      purchaseOrderId,
    )
    .order(
      "received_at",
      {
        ascending: false,
      },
    );

  if (receiptsError) {
    throw new Error(
      `Unable to load receiving history: ${receiptsError.message}`,
    );
  }

  const receiptIds =
    (receipts ?? []).map(
      (receipt) => receipt.id,
    );

  const {
    data: receiptItems,
  } =
    receiptIds.length > 0
      ? await supabase
          .from(
            "purchase_receipt_items",
          )
          .select(
            "purchase_receipt_id, item_id, received_quantity, receive_unit_id",
          )
          .in(
            "purchase_receipt_id",
            receiptIds,
          )
      : {
          data: [],
        };

  const itemMap =
    new Map(
      (items ?? []).map(
        (item) => [
          item.id,
          item,
        ],
      ),
    );

  const unitMap =
    new Map(
      (units ?? []).map(
        (unit) => [
          unit.id,
          unit,
        ],
      ),
    );

  const receiptItemRows =
    (receiptItems ?? []) as ReceiptItemRow[];

  const receiptItemsByReceipt =
    new Map<
      string,
      ReceiptItemRow[]
    >();

  for (
    const receiptItem of
    receiptItemRows
  ) {
    const existing =
      receiptItemsByReceipt.get(
        receiptItem
          .purchase_receipt_id,
      ) ?? [];

    existing.push(
      receiptItem,
    );

    receiptItemsByReceipt.set(
      receiptItem
        .purchase_receipt_id,
      existing,
    );
  }

  return (
    <Panel aria-labelledby="po-receiving-title">
      <SectionHeader
        id="po-receiving-title"
        title="รับสินค้าเข้าคลัง"
        description="บันทึกจำนวนที่ได้รับจริง รับบางส่วนได้ ระบบจะเพิ่ม Stock ทันที"
        icon={PackageCheck}
      />

      {status === "RECEIVED" ? (
        <Notice tone="success" className="mt-4">
          ใบสั่งซื้อนี้รับสินค้าครบแล้ว
        </Notice>
      ) : (
        <div className="mt-4 grid gap-3">
          {(lines ?? []).map(
            (line) => {
              const item =
                itemMap.get(
                  line.item_id,
                );

              const unit =
                unitMap.get(
                  line.order_unit_id,
                );

              const ordered =
                Number(
                  line.ordered_quantity,
                );

              const received =
                Number(
                  line.received_quantity,
                );

              const remaining =
                ordered - received;

              if (
                remaining <= 0
              ) {
                return null;
              }

              const symbol =
                unit?.symbol ?? "";

              const name =
                item?.name ??
                "ไม่ทราบสินค้า";

              return (
                <form
                  key={line.id}
                  action={
                    receivePurchaseOrderItem
                  }
                  className="rounded-xl border bg-surface-warm/60 p-4"
                >
                  <input
                    type="hidden"
                    name="purchase_order_item_id"
                    value={line.id}
                  />

                  <input
                    type="hidden"
                    name="idempotency_key"
                    value={`po-receive:${purchaseOrderId}:${line.id}:${randomUUID()}`}
                  />

                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{name}</p>
                      <p className="text-xs text-muted-foreground">
                        {item?.sku}
                      </p>
                    </div>

                    <p className="text-sm text-muted-foreground">
                      คงเหลือต้องรับ{" "}
                      <span className="text-lg font-semibold text-foreground tabular-nums">
                        {formatQuantity(remaining, symbol)}
                      </span>
                    </p>
                  </div>

                  <p className="mt-1 text-xs text-muted-foreground">
                    สั่ง {formatQuantity(ordered, symbol)} · รับแล้ว{" "}
                    {formatQuantity(received, symbol)}
                  </p>

                  <div className="mt-3 grid gap-3 md:grid-cols-[12rem_minmax(0,1fr)_auto] md:items-end">
                    <Field
                      label={`จำนวนที่รับ (${symbol || "หน่วย"})`}
                      htmlFor={`receive-qty-${line.id}`}
                      required
                    >
                      <Input
                        id={`receive-qty-${line.id}`}
                        type="number"
                        name="quantity"
                        inputMode="decimal"
                        min="0.0001"
                        max={remaining}
                        step="0.0001"
                        required
                        placeholder={String(
                          remaining,
                        )}
                        className="font-semibold tabular-nums"
                      />
                    </Field>

                    <Field
                      label="หมายเหตุ"
                      htmlFor={`receive-note-${line.id}`}
                    >
                      <Input
                        id={`receive-note-${line.id}`}
                        name="note"
                        maxLength={1000}
                        placeholder="เช่น ส่งรอบเช้า"
                      />
                    </Field>

                    <SubmitButton
                      className="w-full md:w-auto"
                      pendingLabel="กำลังรับเข้า..."
                    >
                      <PackageCheck className="size-4" aria-hidden="true" />
                      รับเข้าคลัง
                    </SubmitButton>
                  </div>
                </form>
              );
            },
          )}
        </div>
      )}

      <div className="mt-5 border-t pt-4">
        <h3 className="flex items-center gap-2 font-semibold">
          <ReceiptText className="size-4 text-muted-foreground" aria-hidden="true" />
          ประวัติการรับสินค้า
        </h3>

        {(receipts ?? []).length ===
        0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            ยังไม่มีการรับสินค้าสำหรับ PO นี้
          </p>
        ) : (
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {(receipts ?? []).map(
              (receipt) => (
                <li
                  key={receipt.id}
                  className="rounded-xl border p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-medium">
                      {
                        receipt.receipt_number
                      }
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(
                        receipt.received_at,
                      )}
                    </p>
                  </div>

                  <ul className="mt-2 space-y-1">
                    {(
                      receiptItemsByReceipt.get(
                        receipt.id,
                      ) ?? []
                    ).map(
                      (
                        receiptItem,
                        index,
                      ) => {
                        const item =
                          itemMap.get(
                            receiptItem.item_id,
                          );

                        const unit =
                          unitMap.get(
                            receiptItem.receive_unit_id,
                          );

                        return (
                          <li
                            key={`${receipt.id}-${index}`}
                            className="flex justify-between gap-3 text-sm"
                          >
                            <span>{item?.name}</span>
                            <span className="font-semibold text-success tabular-nums">
                              +{formatQuantity(
                                receiptItem.received_quantity,
                                unit?.symbol ?? "",
                              )}
                            </span>
                          </li>
                        );
                      },
                    )}
                  </ul>

                  {receipt.note ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {receipt.note}
                    </p>
                  ) : null}
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </Panel>
  );
}

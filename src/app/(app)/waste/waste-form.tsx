"use client";

import {
  useMemo,
  useState,
} from "react";
import { Trash2 } from "lucide-react";

import {
  Field,
  MobileActionBar,
  NativeSelect,
  ReadOnlyValue,
} from "@/components/app/form-controls";
import { SubmitButton } from "@/components/app/submit-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatQuantity } from "@/lib/ui/format";

import { createWaste } from "./actions";

type UnitOption = {
  id: string;
  label: string;
};

type ItemOption = {
  id: string;
  sku: string;
  name: string;
  currentQuantity: number;
  baseUnitSymbol: string;
  units: UnitOption[];
};

type WasteReasonOption = {
  id: string;
  code: string;
  name: string;
};

type WasteFormProps = {
  items: ItemOption[];
  reasons: WasteReasonOption[];
};

export function WasteForm({
  items,
  reasons,
}: WasteFormProps) {
  const [itemId, setItemId] =
    useState(
      items[0]?.id ?? "",
    );

  const selectedItem =
    useMemo(
      () =>
        items.find(
          (item) =>
            item.id === itemId,
        ),
      [itemId, items],
    );

  const units =
    selectedItem?.units ?? [];

  const outOfStock =
    !selectedItem ||
    selectedItem.currentQuantity <= 0;

  return (
    <form
      action={createWaste}
      className="grid gap-5"
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Field
          label="สินค้า / วัตถุดิบ"
          htmlFor="itemId"
          required
        >
          <NativeSelect
            id="itemId"
            name="itemId"
            value={itemId}
            onChange={(event) =>
              setItemId(
                event.target.value,
              )
            }
            required
          >
            {items.map((item) => (
              <option
                key={item.id}
                value={item.id}
              >
                {item.name}
                {" · "}
                {item.sku}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <ReadOnlyValue label="Stock ปัจจุบัน">
          <span aria-live="polite">
            {selectedItem
              ? formatQuantity(
                  selectedItem.currentQuantity,
                  selectedItem.baseUnitSymbol,
                )
              : "-"}
          </span>
        </ReadOnlyValue>
      </div>

      {selectedItem && outOfStock ? (
        <p role="status" className="rounded-lg border border-critical-border bg-critical-soft px-3 py-2 text-sm text-critical">
          สินค้านี้หมด Stock แล้ว จึงบันทึกของเสียไม่ได้
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="จำนวนของเสีย"
          htmlFor="quantity"
          required
        >
          <Input
            id="quantity"
            name="quantity"
            type="number"
            inputMode="decimal"
            min="0.0001"
            step="0.0001"
            placeholder="500"
            required
            className="text-lg font-semibold tabular-nums md:text-base"
          />
        </Field>

        <Field
          label="หน่วย"
          htmlFor="inputUnitId"
          required
        >
          <NativeSelect
            key={itemId}
            id="inputUnitId"
            name="inputUnitId"
            required
            defaultValue={
              units[0]?.id ?? ""
            }
          >
            {units.map((unit) => (
              <option
                key={unit.id}
                value={unit.id}
              >
                {unit.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <Field
        label="สาเหตุ"
        htmlFor="wasteReasonId"
        required
      >
        <NativeSelect
          id="wasteReasonId"
          name="wasteReasonId"
          required
          defaultValue=""
        >
          <option
            value=""
            disabled
          >
            เลือกสาเหตุของเสีย
          </option>
          {reasons.map((reason) => (
            <option
              key={reason.id}
              value={reason.id}
            >
              {reason.name}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field
        label="หมายเหตุ"
        htmlFor="note"
        hint="ไม่บังคับ"
      >
        <Textarea
          id="note"
          name="note"
          placeholder="เช่น เนื้อเสียจากการจัดเก็บ"
          maxLength={500}
        />
      </Field>

      <MobileActionBar>
        <SubmitButton
          className="w-full sm:w-auto"
          disabled={
            !selectedItem ||
            selectedItem.currentQuantity <= 0 ||
            units.length === 0 ||
            reasons.length === 0
          }
        >
          <Trash2 className="size-4" aria-hidden="true" />
          บันทึกของเสีย
        </SubmitButton>
      </MobileActionBar>
    </form>
  );
}

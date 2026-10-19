"use client";

import { useMemo, useState } from "react";
import { PackagePlus } from "lucide-react";

import {
  Field,
  MobileActionBar,
  NativeSelect,
} from "@/components/app/form-controls";
import { SubmitButton } from "@/components/app/submit-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { createStockIn } from "./actions";

type UnitOption = {
  id: string;
  label: string;
  conversionToBase: number;
};

type ItemOption = {
  id: string;
  sku: string;
  name: string;
  units: UnitOption[];
};

type StockInFormProps = {
  items: ItemOption[];
};

export function StockInForm({
  items,
}: StockInFormProps) {
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

  const unitOptions =
    selectedItem?.units ?? [];

  return (
    <form
      action={createStockIn}
      className="grid gap-5"
    >
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="จำนวนที่รับเข้า"
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
            placeholder="10000"
            required
            className="text-lg font-semibold tabular-nums md:text-base"
          />
        </Field>

        <Field
          label="หน่วยที่รับเข้า"
          htmlFor="inputUnitId"
          required
        >
          <NativeSelect
            key={itemId}
            id="inputUnitId"
            name="inputUnitId"
            required
            defaultValue={
              unitOptions[0]?.id ??
              ""
            }
          >
            {unitOptions.map(
              (unit) => (
                <option
                  key={unit.id}
                  value={unit.id}
                >
                  {unit.label}
                </option>
              ),
            )}
          </NativeSelect>
        </Field>
      </div>

      <Field
        label="หมายเหตุ"
        htmlFor="note"
        hint="ไม่บังคับ"
      >
        <Textarea
          id="note"
          name="note"
          placeholder="เช่น รับสินค้าจาก Supplier / ซื้อเข้าร้าน"
          maxLength={500}
        />
      </Field>

      <MobileActionBar>
        <SubmitButton
          className="w-full sm:w-auto"
          disabled={
            items.length === 0 ||
            unitOptions.length === 0
          }
        >
          <PackagePlus className="size-4" aria-hidden="true" />
          บันทึกรับสินค้าเข้า
        </SubmitButton>
      </MobileActionBar>
    </form>
  );
}

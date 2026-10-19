import type { LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import {
  Panel,
  SectionHeader,
} from "@/components/app/page-header";
import {
  RecordItem,
  RecordList,
} from "@/components/app/record-list";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  formatActivityTime,
  formatDateTime,
} from "@/lib/ui/format";

export type TransactionRow = {
  id: string;
  name: string;
  sku?: string | null;
  // Already formatted, including sign and unit.
  quantity: string;
  tone?: "in" | "out" | "waste";
  reason?: string | null;
  note?: string | null;
  occurredAt: string;
};

const TONE: Record<NonNullable<TransactionRow["tone"]>, string> = {
  in: "text-success",
  out: "text-foreground",
  waste: "text-danger",
};

/** Recent Stock In / Stock Out / Waste records: list on phones, table from md. */
export function TransactionHistory({
  id,
  title,
  description,
  icon,
  rows,
  emptyTitle,
  emptyDescription,
  showReason = false,
}: {
  id: string;
  title: string;
  description?: string;
  icon: LucideIcon;
  rows: TransactionRow[];
  emptyTitle: string;
  emptyDescription?: string;
  showReason?: boolean;
}) {
  return (
    <Panel aria-labelledby={id}>
      <SectionHeader
        id={id}
        title={title}
        description={description}
        icon={icon}
      />

      {rows.length === 0 ? (
        <EmptyState
          className="mt-4"
          icon={icon}
          title={emptyTitle}
          description={emptyDescription}
        />
      ) : (
        <>
          <RecordList className="mt-4 md:hidden" label={title}>
            {rows.map((row) => (
              <RecordItem
                key={row.id}
                title={row.name}
                subtitle={[
                  showReason ? row.reason : null,
                  formatActivityTime(row.occurredAt),
                ]
                  .filter(Boolean)
                  .join(" · ")}
                meta={row.note || undefined}
                value={row.quantity}
                valueClassName={row.tone ? TONE[row.tone] : undefined}
              />
            ))}
          </RecordList>

          <div className="mt-4 hidden overflow-hidden rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>รายการ</TableHead>
                  {showReason ? <TableHead>เหตุผล</TableHead> : null}
                  <TableHead className="text-right">จำนวน</TableHead>
                  <TableHead>หมายเหตุ</TableHead>
                  <TableHead>เวลา</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-normal">
                      <p className="font-medium text-foreground">{row.name}</p>
                      {row.sku ? (
                        <p className="text-xs text-muted-foreground">
                          {row.sku}
                        </p>
                      ) : null}
                    </TableCell>
                    {showReason ? (
                      <TableCell className="whitespace-normal">
                        {row.reason || "-"}
                      </TableCell>
                    ) : null}
                    <TableCell
                      className={cn(
                        "text-right font-semibold tabular-nums",
                        row.tone ? TONE[row.tone] : undefined,
                      )}
                    >
                      {row.quantity}
                    </TableCell>
                    <TableCell className="max-w-64 whitespace-normal text-muted-foreground">
                      {row.note || "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(row.occurredAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </Panel>
  );
}

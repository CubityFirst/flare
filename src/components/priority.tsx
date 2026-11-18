import { ArrowDown, ArrowUp, BellOff, Minus, Siren } from "lucide-react";
import { PRIORITIES, type Priority } from "@shared/types";
import { cn } from "@/lib/utils";

const STYLES: Record<Priority, { icon: typeof Siren; className: string }> = {
  [-2]: { icon: ArrowDown, className: "text-muted-foreground" },
  [-1]: { icon: BellOff, className: "text-muted-foreground" },
  0: { icon: Minus, className: "text-muted-foreground" },
  1: { icon: ArrowUp, className: "text-amber-600 dark:text-amber-400" },
  2: { icon: Siren, className: "text-red-600 dark:text-red-400" },
};

export function priorityLabel(p: Priority) {
  return PRIORITIES.find((x) => x.value === p)?.label ?? String(p);
}

export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  const { icon: Icon, className: tone } = STYLES[priority];
  return <Icon aria-label={`${priorityLabel(priority)} priority`} className={cn("size-4", tone, className)} />;
}

/** Thin colored bar on the leading edge of feed items. */
export function priorityAccent(p: Priority) {
  if (p === 2) return "before:bg-red-500";
  if (p === 1) return "before:bg-amber-500";
  return "before:bg-transparent";
}

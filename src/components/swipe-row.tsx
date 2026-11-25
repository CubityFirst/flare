import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface SwipeAction {
  label: string;
  icon: React.ReactNode;
  /** Background of the strip revealed behind the row, e.g. "bg-sky-600". */
  className: string;
  onSwipe: () => void;
  /** Slide the row off screen instead of springing it back (for actions that remove it). */
  removes?: boolean;
}

/**
 * A row that can be swiped sideways on touch screens, like a mail app. Swiping right runs
 * `left` (the action revealed on the left), swiping left runs `right`. Mice and pens are
 * ignored, so desktop text selection and clicks work as before; give those users a button too.
 */
export function SwipeRow({
  left,
  right,
  className,
  children,
}: {
  left?: SwipeAction;
  right?: SwipeAction;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; width: number; axis: "x" | "y" | null } | null>(null);
  const suppressClick = useRef(false);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const width = drag.current?.width ?? ref.current?.offsetWidth ?? 0;
  const threshold = Math.min(width * 0.35, 140);
  const action = dx < 0 ? right : dx > 0 ? left : undefined;
  const armed = Math.abs(dx) >= threshold && threshold > 0;

  function end(cancelled: boolean) {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (d?.axis !== "x") return;
    const chosen = !cancelled && Math.abs(dx) >= Math.min(d.width * 0.35, 140) ? action : undefined;
    if (chosen?.removes) {
      setDx(dx < 0 ? -d.width : d.width);
      timer.current = setTimeout(() => {
        chosen.onSwipe();
        // If the row is still here (the action failed), bring it back.
        timer.current = setTimeout(() => setDx(0), 800);
      }, 180);
      return;
    }
    chosen?.onSwipe();
    setDx(0);
  }

  return (
    <div ref={ref} className={cn("relative overflow-hidden rounded-xl", className)}>
      {action && (
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 flex items-center gap-2 px-5 text-sm font-medium text-white",
            dx < 0 ? "justify-end" : "justify-start",
            action.className,
          )}
        >
          <span className={cn("flex items-center gap-2 transition-transform duration-150", armed ? "scale-100" : "scale-90 opacity-70")}>
            {action.icon}
            {action.label}
          </span>
        </div>
      )}
      <div
        className={cn("relative touch-pan-y", !dragging && "transition-transform duration-200 ease-out")}
        style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" || e.pointerType === "pen" || (!left && !right)) return;
          clearTimeout(timer.current);
          drag.current = { x: e.clientX, y: e.clientY, width: ref.current?.offsetWidth ?? 0, axis: null };
          suppressClick.current = false;
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const x = e.clientX - d.x;
          const y = e.clientY - d.y;
          if (!d.axis) {
            if (Math.abs(x) < 10 && Math.abs(y) < 10) return;
            d.axis = Math.abs(x) > Math.abs(y) ? "x" : "y";
            if (d.axis === "y") return;
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
            suppressClick.current = true;
          }
          if (d.axis !== "x") return;
          setDx((x > 0 && !left) || (x < 0 && !right) ? 0 : x);
        }}
        onPointerUp={() => end(false)}
        onPointerCancel={() => end(true)}
        onClickCapture={(e) => {
          if (!suppressClick.current) return;
          suppressClick.current = false;
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        {children}
      </div>
    </div>
  );
}

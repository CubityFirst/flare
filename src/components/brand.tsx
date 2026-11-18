import { cn } from "@/lib/utils";

export function FlareMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden className={cn("size-8", className)}>
      <rect width="100" height="100" rx="22" className="fill-primary" />
      <path
        fill="#fff"
        d="M50 14Q50 50 86 50Q50 50 50 86Q50 50 14 50Q50 50 50 14ZM73.5 16Q73.5 27 84.5 27Q73.5 27 73.5 38Q73.5 27 62.5 27Q73.5 27 73.5 16Z"
      />
    </svg>
  );
}

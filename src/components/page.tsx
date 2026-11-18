import { useEffect } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} · Flare`;
  }, [title]);
  return (
    <header className="flex flex-wrap items-start gap-3 py-5 sm:py-8">
      <SidebarTrigger className="-ml-1 hidden md:inline-flex" />
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

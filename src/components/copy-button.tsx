import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : label}
    </Button>
  );
}

export function CodeBlock({ code, className }: { code: string; className?: string }) {
  return (
    <div className={`group relative ${className ?? ""}`}>
      <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 pr-20 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
      <CopyButton value={code} className="absolute top-2 right-2 h-7" />
    </div>
  );
}

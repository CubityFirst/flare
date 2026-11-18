import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { playSound } from "@/lib/sounds";

const DEFAULT = "__default__";

/** Sound picker with a preview button. `null` means "use the default". */
export function SoundSelect({
  value,
  onChange,
  defaultLabel = "Default",
  id,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  defaultLabel?: string;
  id?: string;
}) {
  const sounds = useQuery({ queryKey: ["sounds"], queryFn: api.sounds });
  const builtin = sounds.data?.filter((s) => s.builtin) ?? [];
  const custom = sounds.data?.filter((s) => !s.builtin) ?? [];
  const selected = sounds.data?.find((s) => s.slug === value);

  return (
    <div className="flex gap-2">
      <Select value={value ?? DEFAULT} onValueChange={(v) => onChange(v === DEFAULT ? null : v)}>
        <SelectTrigger id={id} className="flex-1">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT}>{defaultLabel}</SelectItem>
          <SelectGroup>
            <SelectLabel>Built-in</SelectLabel>
            {builtin.map((s) => (
              <SelectItem key={s.slug} value={s.slug}>
                {s.name}
              </SelectItem>
            ))}
          </SelectGroup>
          {custom.length > 0 && (
            <SelectGroup>
              <SelectLabel>Your sounds</SelectLabel>
              {custom.map((s) => (
                <SelectItem key={s.slug} value={s.slug}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Preview sound"
        onClick={() => playSound(value, selected?.url)}
      >
        <Play />
      </Button>
    </div>
  );
}

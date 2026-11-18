import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, ChevronRight, Plus, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useMe } from "@/hooks/use-me";
import { api, errorMessage } from "@/lib/api";
import { slugify } from "@/lib/format";

function CreateGroupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const create = useMutation({
    mutationFn: () => api.createGroup({ name, slug, description: description || null }),
    onSuccess: (g) => {
      void qc.invalidateQueries({ queryKey: ["groups"] });
      onOpenChange(false);
      navigate(`/groups/${g.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>New group</DialogTitle>
            <DialogDescription>Send one notification to everyone in the group. You'll be its owner.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="g-name">Name</FieldLabel>
              <Input
                id="g-name"
                required
                autoFocus
                maxLength={80}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
                placeholder="On-call team"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="g-slug">Address</FieldLabel>
              <Input
                id="g-slug"
                required
                pattern="[a-z0-9][a-z0-9\-]{1,39}"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value.toLowerCase());
                }}
                className="font-mono"
              />
              <FieldDescription>
                Send to it with <code>to: "group:{slug || "…"}"</code>
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="g-desc">Description</FieldLabel>
              <Textarea id="g-desc" rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              Create group
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function GroupsPage() {
  const { user } = useMe();
  const [showAll, setShowAll] = useState(false);
  const groups = useQuery({ queryKey: ["groups", showAll], queryFn: () => api.groups(showAll) });
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Groups"
        description="Notify several people at once. Members can mute a group without leaving it."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New group
          </Button>
        }
      />
      {user.role === "admin" && (
        <label className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={showAll} onCheckedChange={setShowAll} /> Show all groups (admin)
        </label>
      )}

      {groups.data?.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users />
            </EmptyMedia>
            <EmptyTitle>No groups yet</EmptyTitle>
            <EmptyDescription>Create a group for your family, team or on-call rotation.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setCreating(true)}>
              <Plus /> Create a group
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <ul className="divide-y rounded-xl border">
          {groups.data?.map((g) => (
            <li key={g.id}>
              <Link to={`/groups/${g.id}`} className="flex items-center gap-3 p-4 hover:bg-muted/50">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Users className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <span className="truncate">{g.name}</span>
                    {g.myRole === "owner" && <Badge variant="secondary">Owner</Badge>}
                    {g.muted && <BellOff className="size-3.5 text-muted-foreground" aria-label="Muted" />}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    <span className="font-mono">group:{g.slug}</span> · {g.memberCount} {g.memberCount === 1 ? "member" : "members"}
                  </p>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <CreateGroupDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

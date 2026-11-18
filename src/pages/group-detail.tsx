import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Crown, LogOut, MoreHorizontal, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import type { GroupMember } from "@shared/types";
import { Confirm } from "@/components/confirm";
import { PageHeader } from "@/components/page";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useMe } from "@/hooks/use-me";
import { api, errorMessage } from "@/lib/api";
import { initials, timeAgo } from "@/lib/format";

export function GroupDetailPage() {
  const { id = "" } = useParams();
  const { user } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const group = useQuery({ queryKey: ["group", id], queryFn: () => api.group(id) });
  const [email, setEmail] = useState("");

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["group", id] });
    void qc.invalidateQueries({ queryKey: ["groups"] });
  };
  const onError = (e: unknown) => toast.error(errorMessage(e));

  const add = useMutation({
    mutationFn: () => api.addMember(id, email),
    onSuccess: () => {
      setEmail("");
      refresh();
    },
    onError,
  });
  const mute = useMutation({ mutationFn: (muted: boolean) => api.updateMember(id, user.id, { muted }), onSuccess: refresh, onError });
  const setRole = useMutation({
    mutationFn: (m: { userId: string; role: "owner" | "member" }) => api.updateMember(id, m.userId, { role: m.role }),
    onSuccess: refresh,
    onError,
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => api.removeMember(id, userId),
    onSuccess: (_, userId) => {
      if (userId === user.id) navigate("/groups");
      refresh();
    },
    onError,
  });
  const deleteGroup = useMutation({
    mutationFn: () => api.deleteGroup(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["groups"] });
      navigate("/groups");
    },
    onError,
  });

  if (group.isPending) return <Skeleton className="mt-8 h-40 w-full" />;
  if (group.isError) return <p className="py-8 text-sm text-destructive">{errorMessage(group.error)}</p>;

  const g = group.data;
  const canManage = g.myRole === "owner" || user.role === "admin";
  const members = g.members ?? [];

  const memberActions = (m: GroupMember) => {
    if (!canManage || m.userId === user.id) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Member actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setRole.mutate({ userId: m.userId, role: m.role === "owner" ? "member" : "owner" })}>
            <Crown /> {m.role === "owner" ? "Make member" : "Make owner"}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => removeMember.mutate(m.userId)}>
            <Trash2 /> Remove from group
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mt-4 -ml-2">
        <Link to="/groups">
          <ArrowLeft /> Groups
        </Link>
      </Button>
      <PageHeader
        title={g.name}
        description={
          <>
            <span className="font-mono">group:{g.slug}</span>
            {g.description && ` · ${g.description}`}
          </>
        }
      />

      <div className="space-y-6">
        {g.myRole && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Your notifications</CardTitle>
              <CardDescription>Muted groups still show up in your feed, but don't buzz your devices.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={g.muted} onCheckedChange={(v) => mute.mutate(v)} /> Mute this group
              </label>
              <Confirm
                title={`Leave ${g.name}?`}
                description="You'll stop receiving its notifications. An owner can add you back."
                confirmLabel="Leave"
                onConfirm={() => removeMember.mutateAsync(user.id)}
              >
                <Button variant="outline" size="sm">
                  <LogOut /> Leave group
                </Button>
              </Confirm>
            </CardContent>
          </Card>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            {members.length} {members.length === 1 ? "member" : "members"}
          </h2>
          {canManage && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                add.mutate();
              }}
            >
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Add someone by email"
                aria-label="Email address"
              />
              <Button type="submit" disabled={add.isPending}>
                <UserPlus /> Add
              </Button>
            </form>
          )}
          <ul className="divide-y rounded-xl border">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center gap-3 p-3">
                <Avatar className="size-8">
                  {m.picture && <AvatarImage src={m.picture} alt="" />}
                  <AvatarFallback>{initials(m.name, m.email)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    {m.name ?? m.email}
                    {m.userId === user.id && <span className="text-muted-foreground">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.name && m.email ? `${m.email} · ` : ""}joined {timeAgo(m.joinedAt)}
                  </p>
                </div>
                {m.role === "owner" && <Badge variant="secondary">Owner</Badge>}
                {m.muted && <Badge variant="outline">Muted</Badge>}
                {memberActions(m)}
              </li>
            ))}
          </ul>
        </section>

        {canManage && (
          <Confirm
            title={`Delete ${g.name}?`}
            description="Everyone is removed and the group address stops working. Past messages stay in feeds."
            onConfirm={() => deleteGroup.mutateAsync()}
          >
            <Button variant="destructive">
              <Trash2 /> Delete group
            </Button>
          </Confirm>
        )}
      </div>
    </>
  );
}

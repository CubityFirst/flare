import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Navigate } from "react-router";
import { toast } from "sonner";
import type { User } from "@shared/types";
import { PageHeader } from "@/components/page";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMe } from "@/hooks/use-me";
import { type AdminUser, api, errorMessage } from "@/lib/api";
import { initials, timeAgo } from "@/lib/format";

export function AdminPage() {
  const { user: me } = useMe();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["admin-users"], queryFn: api.adminUsers, enabled: me.role === "admin" });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; role?: User["role"]; status?: User["status"] }) => api.updateUser(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (me.role !== "admin") return <Navigate to="/" replace />;

  const pending = users.data?.filter((u) => u.status === "pending") ?? [];

  const row = (u: AdminUser) => (
    <li key={u.id} className="flex flex-wrap items-center gap-3 p-3">
      <Avatar className="size-8">
        {u.picture && <AvatarImage src={u.picture} alt="" />}
        <AvatarFallback>{initials(u.name, u.email)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {u.name ?? u.email} {u.id === me.id && <span className="text-muted-foreground">(you)</span>}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {u.name && u.email ? `${u.email} · ` : ""}
          {u.deviceCount} devices · {u.appCount} apps · {u.lastLoginAt ? `seen ${timeAgo(u.lastLoginAt)}` : "never signed in"}
        </p>
      </div>
      {u.status === "pending" ? (
        <Button size="sm" onClick={() => update.mutate({ id: u.id, status: "active" })}>
          <Check /> Approve
        </Button>
      ) : (
        <>
          <Select
            value={u.status}
            onValueChange={(status) => update.mutate({ id: u.id, status: status as User["status"] })}
            disabled={u.id === me.id}
          >
            <SelectTrigger size="sm" className="w-28" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={u.role}
            onValueChange={(role) => update.mutate({ id: u.id, role: role as User["role"] })}
            disabled={u.id === me.id}
          >
            <SelectTrigger size="sm" className="w-24" aria-label="Role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        </>
      )}
    </li>
  );

  return (
    <>
      <PageHeader
        title="Users"
        description="Everyone who has signed in with your identity provider. New users wait here for approval."
      />
      <div className="space-y-6">
        {pending.length > 0 && (
          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              Waiting for approval <Badge>{pending.length}</Badge>
            </h2>
            <ul className="divide-y rounded-xl border border-primary/40">{pending.map(row)}</ul>
          </section>
        )}
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">All users</h2>
          <ul className="divide-y rounded-xl border">{users.data?.filter((u) => u.status !== "pending").map(row)}</ul>
        </section>
      </div>
    </>
  );
}

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, Trash2, Shield } from "lucide-react";

interface SceneAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sceneId: number;
  sceneName: string;
}

interface SceneMemberInfo {
  id: number;
  sceneId: number;
  userId: string;
  role: string;
  addedAt: string;
  username?: string;
  firstName?: string | null;
  lastName?: string | null;
}

interface UserInfo {
  id: string;
  username: string;
  role: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  isActive: string;
}

function getInitials(user: { username?: string; firstName?: string | null; lastName?: string | null }): string {
  if (user.firstName && user.lastName) {
    return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
  }
  return (user.username || "?")[0].toUpperCase();
}

function getDisplayName(user: { username?: string; firstName?: string | null; lastName?: string | null }): string {
  if (user.firstName || user.lastName) {
    return [user.firstName, user.lastName].filter(Boolean).join(" ");
  }
  return user.username || "—";
}

function getRoleLabel(role: string): string {
  switch (role) {
    case "owner": return "Владелец";
    case "editor": return "Редактор";
    case "viewer": return "Просмотр";
    default: return role;
  }
}

export function SceneAccessDialog({ open, onOpenChange, sceneId, sceneName }: SceneAccessDialogProps) {
  const { toast } = useToast();
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRole, setSelectedRole] = useState("viewer");

  const { data: members = [], isLoading: membersLoading } = useQuery<SceneMemberInfo[]>({
    queryKey: ["/api/scenes", sceneId, "members"],
    queryFn: async () => {
      const res = await fetch(`/api/scenes/${sceneId}/members`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch members");
      return res.json();
    },
    enabled: open,
  });

  const { data: allUsers = [], isLoading: usersLoading } = useQuery<UserInfo[]>({
    queryKey: ["/api/admin/users"],
    enabled: open,
  });

  const availableUsers = allUsers.filter(
    (u) => u.isActive === "true" && !members.some((m) => m.userId === u.id)
  );

  const addMemberMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const res = await apiRequest("POST", `/api/scenes/${sceneId}/members`, { userId, role });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", sceneId, "members"] });
      setSelectedUserId("");
      setSelectedRole("viewer");
      toast({ title: "Доступ предоставлен" });
    },
    onError: () => {
      toast({ title: "Ошибка при добавлении пользователя", variant: "destructive" });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("DELETE", `/api/scenes/${sceneId}/members/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", sceneId, "members"] });
      toast({ title: "Доступ отозван" });
    },
    onError: () => {
      toast({ title: "Ошибка при удалении пользователя", variant: "destructive" });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const res = await apiRequest("PATCH", `/api/scenes/${sceneId}/members/${userId}`, { role });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenes", sceneId, "members"] });
      toast({ title: "Роль обновлена" });
    },
    onError: () => {
      toast({ title: "Ошибка при обновлении роли", variant: "destructive" });
    },
  });

  const handleAddMember = () => {
    if (!selectedUserId) return;
    addMemberMutation.mutate({ userId: selectedUserId, role: selectedRole });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Управление доступом
          </DialogTitle>
          <DialogDescription>
            Сцена: {sceneName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Добавить пользователя</p>
            <div className="flex items-center gap-2">
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger className="flex-1" data-testid="select-user">
                  <SelectValue placeholder={usersLoading ? "Загрузка..." : "Выберите пользователя"} />
                </SelectTrigger>
                <SelectContent>
                  {availableUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id} data-testid={`select-user-option-${u.id}`}>
                      {getDisplayName(u)} ({u.username})
                    </SelectItem>
                  ))}
                  {availableUsers.length === 0 && (
                    <SelectItem value="__none__" disabled>
                      Нет доступных пользователей
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger className="w-[140px]" data-testid="select-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Просмотр</SelectItem>
                  <SelectItem value="editor">Редактор</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="icon"
                onClick={handleAddMember}
                disabled={!selectedUserId || addMemberMutation.isPending}
                data-testid="button-add-member"
              >
                <UserPlus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <p className="text-sm font-medium">
              Участники ({members.length})
            </p>
            {membersLoading ? (
              <p className="text-sm text-muted-foreground">Загрузка...</p>
            ) : members.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет участников</p>
            ) : (
              <ScrollArea className="max-h-[300px]">
                <div className="space-y-2">
                  {members.map((member) => (
                    <div
                      key={member.userId}
                      className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50"
                      data-testid={`member-row-${member.userId}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs">
                            {getInitials(member)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {getDisplayName(member)}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {member.username}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {member.role === "owner" ? (
                          <Badge variant="default" data-testid={`badge-member-role-${member.userId}`}>
                            {getRoleLabel(member.role)}
                          </Badge>
                        ) : (
                          <>
                            <Select
                              value={member.role}
                              onValueChange={(newRole) =>
                                updateRoleMutation.mutate({ userId: member.userId, role: newRole })
                              }
                            >
                              <SelectTrigger className="w-[120px]" data-testid={`select-member-role-${member.userId}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="viewer">Просмотр</SelectItem>
                                <SelectItem value="editor">Редактор</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeMemberMutation.mutate(member.userId)}
                              disabled={removeMemberMutation.isPending}
                              data-testid={`button-remove-member-${member.userId}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
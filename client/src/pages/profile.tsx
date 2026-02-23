import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Loader2, Eye, EyeOff, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface ProfileData {
  id: string;
  username: string;
  role: string;
  firstName: string | null;
  lastName: string | null;
  middleName: string | null;
  position: string | null;
  organization: string | null;
  phone: string | null;
  email: string | null;
  isActive: string;
  createdAt: string;
}

export default function ProfilePage() {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  const { data: profile, isLoading } = useQuery<ProfileData>({
    queryKey: ["/api/profile"],
  });

  const changePasswordMutation = useMutation({
    mutationFn: async (data: { currentPassword: string; newPassword: string }) => {
      const res = await apiRequest("POST", "/api/profile/password", data);
      return res.json();
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Пароль успешно изменён" });
    },
    onError: (error: any) => {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    },
  });

  const handleChangePassword = () => {
    if (newPassword !== confirmPassword) {
      toast({ title: "Ошибка", description: "Пароли не совпадают", variant: "destructive" });
      return;
    }
    if (newPassword.length < 4) {
      toast({ title: "Ошибка", description: "Новый пароль должен быть не менее 4 символов", variant: "destructive" });
      return;
    }
    changePasswordMutation.mutate({ currentPassword, newPassword });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const fullName = [profile?.lastName, profile?.firstName, profile?.middleName].filter(Boolean).join(" ");

  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b px-4">
        <Link href="/app">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-sm font-semibold">Профиль пользователя</h1>
      </header>

      <div className="container mx-auto p-6 max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Данные пользователя
            </CardTitle>
            <CardDescription>Основная информация вашей учётной записи</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground text-xs">Логин</Label>
                <p className="font-medium" data-testid="text-profile-username">{profile?.username}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Роль</Label>
                <div>
                  <Badge variant={profile?.role === "admin" ? "default" : "secondary"} data-testid="badge-profile-role">
                    {profile?.role === "admin" ? "Администратор" : "Пользователь"}
                  </Badge>
                </div>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label className="text-muted-foreground text-xs">Фамилия</Label>
                <p className="font-medium" data-testid="text-profile-lastname">{profile?.lastName || "—"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Имя</Label>
                <p className="font-medium" data-testid="text-profile-firstname">{profile?.firstName || "—"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Отчество</Label>
                <p className="font-medium" data-testid="text-profile-middlename">{profile?.middleName || "—"}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground text-xs">Должность</Label>
                <p className="font-medium" data-testid="text-profile-position">{profile?.position || "—"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Организация</Label>
                <p className="font-medium" data-testid="text-profile-organization">{profile?.organization || "—"}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground text-xs">Номер телефона</Label>
                <p className="font-medium" data-testid="text-profile-phone">{profile?.phone || "—"}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Электронная почта</Label>
                <p className="font-medium" data-testid="text-profile-email">{profile?.email || "—"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Смена пароля</CardTitle>
            <CardDescription>Введите текущий пароль и новый для изменения</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-password">Текущий пароль</Label>
              <div className="relative">
                <Input
                  id="current-password"
                  type={showCurrentPassword ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  data-testid="input-current-password"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  data-testid="button-toggle-current-password"
                >
                  {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">Новый пароль</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  data-testid="input-new-password"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  data-testid="button-toggle-new-password"
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Подтвердите новый пароль</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                data-testid="input-confirm-password"
              />
            </div>
            <Button
              onClick={handleChangePassword}
              disabled={!currentPassword || !newPassword || !confirmPassword || changePasswordMutation.isPending}
              data-testid="button-change-password"
            >
              {changePasswordMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Изменить пароль
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

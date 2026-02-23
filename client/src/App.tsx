import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ZuluConnectionProvider } from "@/contexts/zulu-connection-context";
import { SceneProvider } from "@/contexts/scene-context";
import { BaseLayersProvider } from "@/contexts/base-layers-context";
import { ProjectionProvider } from "@/contexts/projection-context";
import { ProtectedRoute } from "@/components/protected-route";
import NotFound from "@/pages/not-found";
import LandingPage from "@/pages/landing";
import Home from "@/pages/home";
import Settings from "@/pages/settings";
import AdminUsers from "@/pages/admin-users";
import AdminLayerManager from "@/pages/admin-layer-manager";
import LoginPage from "@/pages/login";
import ScenesPage from "@/pages/scenes";
import ProfilePage from "@/pages/profile";

function Router() {
  return (
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/scenes">
        <ProtectedRoute>
          <ScenesPage />
        </ProtectedRoute>
      </Route>
      <Route path="/app">
        <ProtectedRoute>
          <Home />
        </ProtectedRoute>
      </Route>
      <Route path="/profile">
        <ProtectedRoute>
          <ProfilePage />
        </ProtectedRoute>
      </Route>
      <Route path="/settings">
        <ProtectedRoute>
          <Settings />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/users">
        <ProtectedRoute requireAdmin>
          <AdminUsers />
        </ProtectedRoute>
      </Route>
      <Route path="/admin/layers">
        <ProtectedRoute requireAdmin>
          <AdminLayerManager />
        </ProtectedRoute>
      </Route>
      <Route path="/admin">
        <ProtectedRoute requireAdmin>
          <AdminUsers />
        </ProtectedRoute>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SceneProvider>
          <ProjectionProvider>
            <BaseLayersProvider>
              <ZuluConnectionProvider>
              <Toaster />
              <Router />
            </ZuluConnectionProvider>
            </BaseLayersProvider>
          </ProjectionProvider>
        </SceneProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

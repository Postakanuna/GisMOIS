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
import AdminUsers from "@/pages/admin-users";
import AdminLayerManager from "@/pages/admin-layer-manager";
import AdminReferencesPage from "@/pages/admin-references";
import LoginPage from "@/pages/login";
import ScenesPage from "@/pages/scenes";
import ProfilePage from "@/pages/profile";

function Router() {
  return (
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/gis/login" component={LoginPage} />
      <Route path="/gis/scenes">
        <ProtectedRoute>
          <ScenesPage />
        </ProtectedRoute>
      </Route>
      <Route path="/gis/app">
        <ProtectedRoute>
          <Home />
        </ProtectedRoute>
      </Route>
      <Route path="/gis/profile">
        <ProtectedRoute>
          <ProfilePage />
        </ProtectedRoute>
      </Route>
      <Route path="/gis/admin/settings">
        <ProtectedRoute requireAdmin>
          <AdminUsers />
        </ProtectedRoute>
      </Route>
      <Route path="/gis/admin/layers">
        <ProtectedRoute requireAdmin>
          <AdminLayerManager />
        </ProtectedRoute>
      </Route>
      <Route path="/gis/admin/references">
        <ProtectedRoute requireAdmin>
          <AdminReferencesPage />
        </ProtectedRoute>
      </Route>
      <Route path="/gis/admin">
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

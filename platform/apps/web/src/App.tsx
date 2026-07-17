import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { useAuth } from "./lib/auth";
import { AgentDetailPage } from "./pages/AgentDetailPage";
import { DiscoveryDashboardPage } from "./pages/DiscoveryDashboardPage";
import { DiscoveryEventsPage } from "./pages/DiscoveryEventsPage";
import { ExecutiveDashboardPage } from "./pages/ExecutiveDashboardPage";
import { InventoryPage } from "./pages/InventoryPage";
import { LoginPage } from "./pages/LoginPage";
import { OperationsDashboardPage } from "./pages/OperationsDashboardPage";
import { RelationshipExplorerPage } from "./pages/RelationshipExplorerPage";
import { SearchPage } from "./pages/SearchPage";
import { TimelinePage } from "./pages/TimelinePage";
import { TopologyMapPage } from "./pages/TopologyMapPage";
import { ConnectorsPage } from "./pages/ConnectorsPage";
import { ShadowAiPage } from "./pages/ShadowAiPage";
import { CoveragePage } from "./pages/CoveragePage";
import { AuditPage } from "./pages/AuditPage";
import { UsageDashboardPage } from "./pages/UsageDashboardPage";
import { DiscoveryChangesPage } from "./pages/DiscoveryChangesPage";
import { MeshPage } from "./pages/MeshPage";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="loading-state">Restoring secure AgentRadar session...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/executive" replace />} />
        <Route path="/executive" element={<ExecutiveDashboardPage />} />
        <Route path="/mesh" element={<MeshPage />} />
        <Route path="/operations" element={<OperationsDashboardPage />} />
        <Route path="/shadow-ai" element={<ShadowAiPage />} />
        <Route path="/discovery" element={<DiscoveryDashboardPage />} />
        <Route path="/discovery/events" element={<DiscoveryEventsPage />} />
        <Route path="/discovery/changes" element={<DiscoveryChangesPage />} />
        <Route path="/coverage" element={<CoveragePage />} />
        <Route path="/inventory" element={<InventoryPage title="Asset Inventory" />} />
        <Route path="/inventory/explorer" element={<Navigate to="/inventory" replace />} />
        <Route path="/agents/:id" element={<AgentDetailPage />} />
        <Route path="/topology" element={<TopologyMapPage />} />
        <Route path="/relationships" element={<RelationshipExplorerPage />} />
        <Route path="/usage" element={<Navigate to="/usage/models" replace />} />
        <Route path="/usage/models" element={<UsageDashboardPage kind="models" title="Model Usage" />} />
        <Route
          path="/usage/frameworks"
          element={<UsageDashboardPage kind="frameworks" title="Framework Usage" />}
        />
        <Route path="/usage/cloud" element={<UsageDashboardPage kind="cloud" title="Cloud Usage" />} />
        <Route path="/usage/ide" element={<UsageDashboardPage kind="ide" title="IDE Usage" />} />
        <Route path="/timeline" element={<TimelinePage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/settings/connectors" element={<ConnectorsPage />} />
        <Route path="/settings/audit" element={<AuditPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/executive" replace />} />
    </Routes>
  );
}

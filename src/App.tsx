import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { useSession } from "./lib/auth";
import { Account } from "./pages/Account";
import { ClientDetail } from "./pages/ClientDetail";
import { Clients } from "./pages/Clients";
import { Dashboard } from "./pages/Dashboard";
import { DocumentView } from "./pages/DocumentView";
import { EmployeeDetail } from "./pages/EmployeeDetail";
import { Engagements } from "./pages/Engagements";
import { Handbook } from "./pages/Handbook";
import { Login } from "./pages/Login";
import { MyProfile } from "./pages/MyProfile";
import { Onboarding } from "./pages/Onboarding";
import { People } from "./pages/People";
import { PortalAdmin } from "./pages/PortalAdmin";
import { Notifications } from "./pages/Notifications";
import { Reports } from "./pages/Reports";
import { Setup } from "./pages/Setup";
import { TaskDetail } from "./pages/TaskDetail";
import { Tasks } from "./pages/Tasks";
import { Team } from "./pages/Team";
import { Templates } from "./pages/Templates";
import type { Role } from "@shared/workflow";

/** Blocks a route until the session is known, then requires a minimum grade. */
function Protected({
  minimum,
  children,
}: {
  minimum?: Role;
  children: React.ReactNode;
}) {
  const { user, loading, can } = useSession();
  const location = useLocation();

  if (loading) return <Spinner label="Checking your session" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  // A forced password change blocks everything except the account screen.
  if (user.must_change_password && location.pathname !== "/account") {
    return <Navigate to="/account" replace />;
  }

  if (minimum && !can(minimum)) {
    return (
      <div className="card p-6">
        <h1 className="section-title">Not available at your grade</h1>
        <p className="muted mt-2">
          This area is restricted. Speak to a partner if you need access.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/setup" element={<Setup />} />

      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/clients/:id" element={<ClientDetail />} />
        <Route path="/engagements" element={<Engagements />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/account" element={<Account />} />

        {/* Employee portal */}
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/handbook" element={<Handbook />} />
        <Route path="/documents/:id" element={<DocumentView />} />
        <Route path="/my-profile" element={<MyProfile />} />
        <Route
          path="/people"
          element={
            <Protected minimum="manager">
              <People />
            </Protected>
          }
        />
        <Route path="/people/:id" element={<EmployeeDetail />} />
        <Route
          path="/portal-admin"
          element={
            <Protected minimum="partner">
              <PortalAdmin />
            </Protected>
          }
        />
        <Route
          path="/reports"
          element={
            <Protected minimum="manager">
              <Reports />
            </Protected>
          }
        />
        <Route
          path="/team"
          element={
            <Protected minimum="partner">
              <Team />
            </Protected>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

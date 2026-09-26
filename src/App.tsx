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
import { ReviewDetailPage } from "./pages/ReviewDetail";
import { Engagements } from "./pages/Engagements";
import { Directory } from "./pages/Directory";
import { MyClients } from "./pages/MyClients";
import { StatusReports } from "./pages/StatusReports";
import { Guide } from "./pages/Guide";
import { Handbook } from "./pages/Handbook";
import { ClientPortal, ClientPublic } from "./components/ClientLayout";
import { PartnerPortal, PartnerPublic } from "./components/PartnerLayout";
import { PartnerLogin } from "./pages/partner/PartnerLogin";
import { PartnerInvitation } from "./pages/partner/PartnerInvitation";
import { PartnerPipeline } from "./pages/partner/PartnerPipeline";
import { PartnerEarnings } from "./pages/partner/PartnerEarnings";
import { PartnerAccount } from "./pages/partner/PartnerAccount";
import { PartnerAgreement } from "./pages/partner/PartnerAgreement";
import { ProposalView } from "./pages/ProposalView";
import { GrowthPartners } from "./pages/GrowthPartners";
import { ClientLogin } from "./pages/client/ClientLogin";
import { ClientInvitation } from "./pages/client/ClientInvitation";
import { ClientSubscription } from "./pages/client/ClientSubscription";
import { ClientInvoices } from "./pages/client/ClientInvoices";
import { ClientInvoiceDetail } from "./pages/client/ClientInvoiceDetail";
import { ClientAccount } from "./pages/client/ClientAccount";
import { Login } from "./pages/Login";
import { MyProfile } from "./pages/MyProfile";
import { Onboarding } from "./pages/Onboarding";
import { MyTraining } from "./pages/MyTraining";
import { People } from "./pages/People";
import { PortalAdmin } from "./pages/PortalAdmin";
import { Notifications } from "./pages/Notifications";
import { Reports } from "./pages/Reports";
import { Subscriptions } from "./pages/Subscriptions";
import { Invoices } from "./pages/Invoices";
import { InvoiceDetail } from "./pages/InvoiceDetail";
import { Setup } from "./pages/Setup";
import { TaskDetail } from "./pages/TaskDetail";
import { Tasks } from "./pages/Tasks";
import { Team } from "./pages/Team";
import { Templates } from "./pages/Templates";
import type { Role } from "@shared/workflow";
import { firstRunDestination } from "@shared/first-run";

/** Blocks a route until the session is known, then requires a minimum grade. */
function Protected({
  minimum,
  children,
}: {
  minimum?: Role;
  children: React.ReactNode;
}) {
  const { user, loading, can, firstRunStep } = useSession();
  const location = useLocation();

  if (loading) return <Spinner label="Checking your session" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  /*
   * Somebody part-way through their first sign-in is sent to the screen that lets them
   * finish, and the server confines them to the same place. The step and the
   * destination both come from shared/first-run.ts, so the two cannot disagree and
   * leave somebody bouncing between screens.
   *
   * Onboarding first, then the password, then two-step sign-in.
   */
  if (firstRunStep) {
    const destination = firstRunDestination(firstRunStep);
    if (location.pathname !== destination) {
      return <Navigate to={destination} replace />;
    }
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

      {/*
        The client portal. Outside Protected and outside Layout, because a client is not
        a user of this portal - they have their own session, their own cookie and their
        own shell. Nothing under /client can reach a staff page, and nothing above can
        reach these.
      */}
      <Route
        path="/client/login"
        element={
          <ClientPublic>
            <ClientLogin />
          </ClientPublic>
        }
      />
      <Route
        path="/client/invitation/:token"
        element={
          <ClientPublic>
            <ClientInvitation />
          </ClientPublic>
        }
      />
      <Route path="/client" element={<ClientPortal />}>
        <Route index element={<ClientSubscription />} />
        <Route path="invoices" element={<ClientInvoices />} />
        <Route path="invoices/:id" element={<ClientInvoiceDetail />} />
        <Route path="account" element={<ClientAccount />} />
      </Route>

      {/*
        The growth partner portal. A third population with a third session, outside both
        of the above for the same reason they are outside each other: nothing under
        /partner can reach a staff or client page, and nothing there can reach these.

        There is no public way in: a partner exists because the firm added them.
      */}
      <Route
        path="/partner/login"
        element={
          <PartnerPublic>
            <PartnerLogin />
          </PartnerPublic>
        }
      />
      <Route
        path="/partner/invitation/:token"
        element={
          <PartnerPublic>
            <PartnerInvitation />
          </PartnerPublic>
        }
      />
      <Route path="/partner" element={<PartnerPortal />}>
        <Route index element={<PartnerPipeline />} />
        <Route path="earnings" element={<PartnerEarnings />} />
        <Route path="engagement" element={<PartnerAgreement />} />
        <Route path="account" element={<PartnerAccount />} />
      </Route>

      {/*
        A proposal, opened from the link that was emailed. No account and no session:
        the token in the path is what stands in for one, and it opens exactly the one
        document it was minted for.
      */}
      <Route path="/proposal/:token" element={<ProposalView />} />

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
        <Route path="/directory" element={<Directory />} />
        <Route path="/my-clients" element={<MyClients />} />
        <Route path="/status-reports" element={<StatusReports />} />
        <Route path="/engagements" element={<Engagements />} />
        <Route
          path="/subscriptions"
          element={
            <Protected minimum="manager">
              <Subscriptions />
            </Protected>
          }
        />
        <Route
          path="/invoices"
          element={
            <Protected minimum="manager">
              <Invoices />
            </Protected>
          }
        />
        {/*
          Manager and above, the same line the client record draws around money: a
          growth partner's commission is what the firm pays out on a client's fees.
        */}
        <Route
          path="/growth-partners"
          element={
            <Protected minimum="manager">
              <GrowthPartners />
            </Protected>
          }
        />
        <Route
          path="/invoices/:id"
          element={
            <Protected minimum="manager">
              <InvoiceDetail />
            </Protected>
          }
        />
        <Route path="/templates" element={<Templates />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/account" element={<Account />} />

        {/* Employee portal */}
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/my-training" element={<MyTraining />} />
        <Route path="/handbook" element={<Handbook />} />
        <Route path="/guide" element={<Guide />} />
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
        <Route path="/reviews/:id" element={<ReviewDetailPage />} />
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

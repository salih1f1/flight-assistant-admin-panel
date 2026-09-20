import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { RequireAdmin } from '@/components/RequireAdmin'
import { Dashboard } from '@/pages/Dashboard'
import { TravelerDetailPage } from '@/pages/travelers/TravelerDetailPage'
import { FlightDetailPage } from '@/pages/flights/FlightDetailPage'
import { TrackFlightPage } from '@/pages/flights/TrackFlightPage'
import { AirlineFormPage } from '@/pages/airlines/AirlineFormPage'
import { AirportFormPage } from '@/pages/airports/AirportFormPage'
import { LoyaltyProgramFormPage } from '@/pages/loyalty/LoyaltyProgramFormPage'
import { LoungeFormPage } from '@/pages/lounges/LoungeFormPage'
import { DataBrowserRoute } from '@/pages/data/DataBrowserPage'
import { RecordPage, RedirectToRecord } from '@/pages/data/RecordPage'
import { SystemHealthPage } from './pages/health/SystemHealthPage'
import { ProvidersPage } from '@/pages/providers/ProvidersPage'
import { ImportPage } from '@/pages/import/ImportPage'
import { AuditLogPage } from '@/pages/audit/AuditLogPage'
import { TestsPage } from '@/pages/tests/TestsPage'

export const router = createBrowserRouter([
  {
    element: <RequireAdmin />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <Dashboard /> },
          // The old list pages: every list is the raw grid now.
          { path: '/travelers', element: <Navigate to="/data/travelers" replace /> },
          { path: '/travelers/:id', element: <TravelerDetailPage /> },
          { path: '/flights', element: <Navigate to="/data/flights" replace /> },
          { path: '/flights/track', element: <TrackFlightPage /> },
          { path: '/flights/:id', element: <FlightDetailPage /> },
          { path: '/alliances', element: <Navigate to="/data/alliances" replace /> },
          // The airlines are a section of the alliance's record now (#174): no page of its own left.
          { path: '/alliances/:id', element: <RedirectToRecord table="alliances" /> },
          { path: '/airlines', element: <Navigate to="/data/airlines" replace /> },
          { path: '/airlines/new', element: <AirlineFormPage /> },
          { path: '/airlines/:id/edit', element: <RedirectToRecord table="airlines" mode="edit" /> },
          { path: '/airports', element: <Navigate to="/data/airports" replace /> },
          { path: '/airports/new', element: <AirportFormPage /> },
          { path: '/airports/:id/edit', element: <RedirectToRecord table="airports" mode="edit" /> },
          { path: '/countries', element: <Navigate to="/data/countries" replace /> },
          { path: '/loyalty', element: <Navigate to="/data/loyalty-programs" replace /> },
          { path: '/loyalty/new', element: <LoyaltyProgramFormPage /> },
          { path: '/loyalty/:id/edit', element: <RedirectToRecord table="loyalty-programs" mode="edit" /> },
          { path: '/lounges', element: <Navigate to="/data/lounges" replace /> },
          { path: '/lounges/new', element: <LoungeFormPage /> },
          { path: '/lounges/:id/edit', element: <RedirectToRecord table="lounges" mode="edit" /> },
          // The tables are in the side menu now; the old table picker has no page of its own.
          { path: '/data', element: <Navigate to="/" replace /> },
          { path: '/data/:table', element: <DataBrowserRoute /> },
          { path: '/data/:table/:id', element: <RecordPage /> },
          { path: '/health', element: <SystemHealthPage /> },
          { path: '/providers', element: <ProvidersPage /> },
          { path: '/import', element: <ImportPage /> },
          { path: '/audit', element: <AuditLogPage /> },
          { path: '/tests', element: <TestsPage /> },
        ],
      },
    ],
  },
])

import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { RequireAdmin } from '@/components/RequireAdmin'
import { Dashboard } from '@/pages/Dashboard'
import { TravelerDetailPage } from '@/pages/travelers/TravelerDetailPage'
import { FlightDetailPage } from '@/pages/flights/FlightDetailPage'
import { AirlineFormPage } from '@/pages/airlines/AirlineFormPage'
import { AirportFormPage } from '@/pages/airports/AirportFormPage'
import { LoyaltyProgramFormPage } from '@/pages/loyalty/LoyaltyProgramFormPage'
import { LoungeFormPage } from '@/pages/lounges/LoungeFormPage'
import { DataBrowserPage } from '@/pages/data/DataBrowserPage'
import { RecordPage, RedirectToRecord } from '@/pages/data/RecordPage'
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
          { path: '/flights/:id', element: <FlightDetailPage /> },
          { path: '/airlines', element: <Navigate to="/data/airlines" replace /> },
          { path: '/airlines/new', element: <AirlineFormPage /> },
          { path: '/airlines/:id/edit', element: <RedirectToRecord table="airlines" /> },
          { path: '/airports', element: <Navigate to="/data/airports" replace /> },
          { path: '/airports/new', element: <AirportFormPage /> },
          { path: '/airports/:id/edit', element: <RedirectToRecord table="airports" /> },
          { path: '/countries', element: <Navigate to="/data/countries" replace /> },
          { path: '/loyalty', element: <Navigate to="/data/loyalty-programs" replace /> },
          { path: '/loyalty/new', element: <LoyaltyProgramFormPage /> },
          { path: '/loyalty/:id/edit', element: <RedirectToRecord table="loyalty-programs" /> },
          { path: '/lounges', element: <Navigate to="/data/lounges" replace /> },
          { path: '/lounges/new', element: <LoungeFormPage /> },
          { path: '/lounges/:id/edit', element: <RedirectToRecord table="lounges" /> },
          // The tables are in the side menu now; the old table picker has no page of its own.
          { path: '/data', element: <Navigate to="/" replace /> },
          { path: '/data/:table', element: <DataBrowserPage /> },
          { path: '/data/:table/:id', element: <RecordPage /> },
          { path: '/import', element: <ImportPage /> },
          { path: '/audit', element: <AuditLogPage /> },
          { path: '/tests', element: <TestsPage /> },
        ],
      },
    ],
  },
])

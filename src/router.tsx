import { createBrowserRouter } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { RequireAdmin } from '@/components/RequireAdmin'
import { Dashboard } from '@/pages/Dashboard'
import { TravelersPage } from '@/pages/travelers/TravelersPage'
import { TravelerDetailPage } from '@/pages/travelers/TravelerDetailPage'
import { FlightsPage } from '@/pages/flights/FlightsPage'
import { FlightDetailPage } from '@/pages/flights/FlightDetailPage'
import { AirlinesPage } from '@/pages/airlines/AirlinesPage'
import { AirlineFormPage } from '@/pages/airlines/AirlineFormPage'
import { AirportsPage } from '@/pages/airports/AirportsPage'
import { AirportFormPage } from '@/pages/airports/AirportFormPage'
import { CountriesPage } from '@/pages/countries/CountriesPage'
import { LoyaltyProgramsPage } from '@/pages/loyalty/LoyaltyProgramsPage'
import { LoyaltyProgramFormPage } from '@/pages/loyalty/LoyaltyProgramFormPage'
import { LoungesPage } from '@/pages/lounges/LoungesPage'
import { LoungeFormPage } from '@/pages/lounges/LoungeFormPage'
import { DataBrowserPage } from '@/pages/data/DataBrowserPage'
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
          { path: '/travelers', element: <TravelersPage /> },
          { path: '/travelers/:id', element: <TravelerDetailPage /> },
          { path: '/flights', element: <FlightsPage /> },
          { path: '/flights/:id', element: <FlightDetailPage /> },
          { path: '/airlines', element: <AirlinesPage /> },
          { path: '/airlines/new', element: <AirlineFormPage /> },
          { path: '/airlines/:id/edit', element: <AirlineFormPage /> },
          { path: '/airports', element: <AirportsPage /> },
          { path: '/airports/new', element: <AirportFormPage /> },
          { path: '/airports/:id/edit', element: <AirportFormPage /> },
          { path: '/countries', element: <CountriesPage /> },
          { path: '/loyalty', element: <LoyaltyProgramsPage /> },
          { path: '/loyalty/new', element: <LoyaltyProgramFormPage /> },
          { path: '/loyalty/:id/edit', element: <LoyaltyProgramFormPage /> },
          { path: '/lounges', element: <LoungesPage /> },
          { path: '/lounges/new', element: <LoungeFormPage /> },
          { path: '/lounges/:id/edit', element: <LoungeFormPage /> },
          { path: '/data', element: <DataBrowserPage /> },
          { path: '/data/:table', element: <DataBrowserPage /> },
          { path: '/import', element: <ImportPage /> },
          { path: '/audit', element: <AuditLogPage /> },
          { path: '/tests', element: <TestsPage /> },
        ],
      },
    ],
  },
])

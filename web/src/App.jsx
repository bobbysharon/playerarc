import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { AppShell, Spinner } from './components/ui';
import PageErrorBoundary from './components/PageErrorBoundary';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Players from './pages/Players';
import PlayerProfile from './pages/PlayerProfile';
import Teams from './pages/Teams';
import TeamDetail from './pages/TeamDetail';
import Coaches from './pages/Coaches';
import Tournaments from './pages/Tournaments';
import TournamentDetail from './pages/TournamentDetail';
import Matches from './pages/Matches';
import MatchDetail from './pages/MatchDetail';
import MatchAnalysis from './pages/MatchAnalysis';
import MatchScoring from './pages/MatchScoring';
import Training from './pages/Training';
import TrainingDetail from './pages/TrainingDetail';
import Assessments from './pages/Assessments';
import Achievements from './pages/Achievements';
import Rankings from './pages/Rankings';
import Reports from './pages/Reports';
import Sports from './pages/Sports';
import Settings from './pages/Settings';
import Drills from './pages/Drills';
import Tracking from './pages/Tracking';
import Announcements from './pages/Announcements';
import Showcase from './pages/Showcase';
import GuestBooking from './pages/GuestBooking';
import AthletePortal from './pages/AthletePortal';
import UserManager from './pages/UserManager';
import ChangePassword from './pages/ChangePassword';

function Protected({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="min-h-screen grid place-items-center"><Spinner label="Loading your workspace" /></div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  // An administrator issued this password and asked for it to be replaced.
  if (user.mustChangePassword) return <ChangePassword />;
  // The boundary sits inside the shell, so a page that fails to render leaves
  // the navigation intact and the person is never stranded on a blank screen.
  return (
    <AppShell>
      <PageErrorBoundary routeKey={location.pathname}>{children}</PageErrorBoundary>
    </AppShell>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* Public: the link is the credential, so no sign-in and no shell. */}
      <Route path="/showcase/:token" element={<Showcase />} />
      {/* Booking needs no account, so it sits outside the signed-in shell. */}
      <Route path="/book" element={<GuestBooking />} />
      {/* The athlete portal is its own surface: an athlete login cannot reach
          any staff route, so it gets no staff navigation. */}
      <Route path="/my" element={<AthletePortal />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/players" element={<Protected><Players /></Protected>} />
      <Route path="/players/:id" element={<Protected><PlayerProfile /></Protected>} />
      <Route path="/teams" element={<Protected><Teams /></Protected>} />
      <Route path="/teams/:id" element={<Protected><TeamDetail /></Protected>} />
      <Route path="/coaches" element={<Protected><Coaches /></Protected>} />
      <Route path="/coaches/:id" element={<Protected><Coaches /></Protected>} />
      <Route path="/tournaments" element={<Protected><Tournaments /></Protected>} />
      <Route path="/tournaments/:id" element={<Protected><TournamentDetail /></Protected>} />
      <Route path="/matches" element={<Protected><Matches /></Protected>} />
      <Route path="/matches/:id" element={<Protected><MatchDetail /></Protected>} />
      <Route path="/matches/:id/analysis" element={<Protected><MatchAnalysis /></Protected>} />
      <Route path="/matches/:id/scoring" element={<Protected><MatchScoring /></Protected>} />
      <Route path="/drills" element={<Protected><Drills /></Protected>} />
      <Route path="/tracking" element={<Protected><Tracking /></Protected>} />
      <Route path="/announcements" element={<Protected><Announcements /></Protected>} />
      <Route path="/training" element={<Protected><Training /></Protected>} />
      <Route path="/training/:id" element={<Protected><TrainingDetail /></Protected>} />
      <Route path="/assessments" element={<Protected><Assessments /></Protected>} />
      <Route path="/achievements" element={<Protected><Achievements /></Protected>} />
      <Route path="/rankings" element={<Protected><Rankings /></Protected>} />
      <Route path="/reports" element={<Protected><Reports /></Protected>} />
      <Route path="/sports" element={<Protected><Sports /></Protected>} />
      <Route path="/users" element={<Protected><UserManager /></Protected>} />
      <Route path="/settings" element={<Protected><Settings /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

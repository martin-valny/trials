import { HashRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { ChangesFeed } from "./components/ChangesFeed";
import { Explore } from "./components/explore/Explore";
import { FreshnessBadge } from "./components/FreshnessBadge";
import { MechanismsPage } from "./components/mechanisms/MechanismsPage";
import { Methods } from "./components/Methods";
import { PipelinePage } from "./components/pipeline/PipelinePage";
import { TargetPage } from "./components/target/TargetPage";
import { Brand, SiteNav } from "./components/SiteNav";
import { ThemeSwitch } from "./components/ThemeSwitch";
import { TrialDetail } from "./components/TrialDetail";
import { TrialsList } from "./components/TrialsList";
import { WatchlistPage } from "./components/watchlist/WatchlistPage";

/** The old /mechanisms/... address: same path and query under /approaches. */
function MechanismsRedirect() {
  const rest = useParams()["*"] ?? "";
  const { search } = useLocation();
  return <Navigate to={`/approaches${rest ? `/${rest}` : ""}${search}`} replace />;
}

/** The header and routes, inside whatever router the caller provides. */
export function AppRoutes() {
  return (
    <>
      <header className="site-header">
        <Brand />
        <SiteNav />
        <FreshnessBadge />
        <ThemeSwitch />
      </header>
      <main>
        <Routes>
          <Route path="/" element={<PipelinePage />} />
          <Route path="/target/:slug" element={<TargetPage />} />
          <Route path="/watchlist" element={<WatchlistPage />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/mechanisms/*" element={<MechanismsRedirect />} />
          <Route path="/approaches" element={<Navigate to="/approaches/targeted" replace />} />
          <Route path="/approaches/:approach" element={<MechanismsPage />} />
          <Route path="/changes" element={<ChangesFeed />} />
          <Route path="/trials" element={<TrialsList />} />
          <Route path="/trial/:nct" element={<TrialDetail />} />
          <Route path="/methods" element={<Methods />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}

export function App() {
  return (
    <HashRouter>
      <AppRoutes />
    </HashRouter>
  );
}

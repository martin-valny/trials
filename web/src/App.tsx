import { HashRouter, Link, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { ChangesFeed } from "./components/ChangesFeed";
import { Explore } from "./components/explore/Explore";
import { FreshnessBadge } from "./components/FreshnessBadge";
import { Methods } from "./components/Methods";
import { ThemeSwitch } from "./components/ThemeSwitch";
import { TrialDetail } from "./components/TrialDetail";
import { TrialsList } from "./components/TrialsList";

export function App() {
  return (
    <HashRouter>
      <header className="site-header">
        <Link to="/explore" className="brand">
          Trial Radar
        </Link>
        <nav aria-label="Main">
          <NavLink to="/explore">Explore</NavLink>
          <NavLink to="/changes">Changes</NavLink>
          <NavLink to="/trials">Trials</NavLink>
          <NavLink to="/methods">Methods</NavLink>
        </nav>
        <FreshnessBadge />
        <ThemeSwitch />
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/explore" replace />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/changes" element={<ChangesFeed />} />
          <Route path="/trials" element={<TrialsList />} />
          <Route path="/trial/:nct" element={<TrialDetail />} />
          <Route path="/methods" element={<Methods />} />
          <Route path="*" element={<Navigate to="/explore" replace />} />
        </Routes>
      </main>
    </HashRouter>
  );
}

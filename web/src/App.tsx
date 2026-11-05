import { HashRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { ChangesFeed } from "./components/ChangesFeed";
import { FreshnessBadge } from "./components/FreshnessBadge";
import { Methods } from "./components/Methods";
import { TrialDetail } from "./components/TrialDetail";
import { TrialsList } from "./components/TrialsList";

export function App() {
  return (
    <HashRouter>
      <header className="site-header">
        <Link to="/changes" className="brand">
          Trial Radar
        </Link>
        <nav aria-label="Main">
          <Link to="/changes">Changes</Link>
          <Link to="/trials">Trials</Link>
          <Link to="/methods">Methods</Link>
        </nav>
        <FreshnessBadge />
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/changes" replace />} />
          <Route path="/changes" element={<ChangesFeed />} />
          <Route path="/trials" element={<TrialsList />} />
          <Route path="/trial/:nct" element={<TrialDetail />} />
          <Route path="/methods" element={<Methods />} />
          <Route path="*" element={<Navigate to="/changes" replace />} />
        </Routes>
      </main>
    </HashRouter>
  );
}

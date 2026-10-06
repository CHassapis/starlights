import { Link, Outlet } from "react-router-dom";
import { Header, LandingBackground3 } from "./pages/layouts/default-layout";

function App() {
  return (
    <>
      <Header />
      <div className="container mx-auto px-4">
        <LandingBackground3 />
        <main className="mt-12">
          <Outlet />
        </main>
      </div>
      <Credits />
    </>
  );
}

function AppWide() {
  return (
    <>
      <Header />
      <main>
        <LandingBackground3 />
        <Outlet />
      </main>
      <Credits />
    </>
  );
}
/** The thanks at the foot of every page: what this site is built on (the About page has the rest). */
function Credits() {
  return (
    <footer className="relative border-t border-border/50 px-4 pt-4 pb-24 text-center text-xs text-muted-foreground">
      Built on{" "}
      <a href="https://github.com/swdriessen/starlights" target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
        Project Starlights
      </a>{" "}
      and{" "}
      <a href="https://www.aurorabuilder.com" target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
        Aurora Builder
      </a>{" "}
      by Bas Driessen, with content from{" "}
      <a href="https://github.com/AuroraLegacy/elements" target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
        Aurora Legacy
      </a>{" "}
      and{" "}
      <a href="https://github.com/5etools-mirror-3/5etools-src" target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
        5etools
      </a>
      . Unofficial fan project, not affiliated with Wizards of the Coast. ·{" "}
      <Link to="/about" className="underline underline-offset-2">
        About &amp; credits
      </Link>
    </footer>
  );
}

export { AppWide };
export default App;

import { Toaster } from "@/components/ui/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { ThemeProvider } from "./components/theme-provider.tsx";
import "./index.css";
import AboutPage from "./pages/about/Index.tsx";
import CharactersPage from "./pages/characters/Index.tsx";
import CharactersCreatePage from "./pages/characters/create/Index.tsx";
import CharactersDetailsPage from "./pages/characters/details/Index.tsx";
import { CompendiumPage } from "./pages/compendium/Index.tsx";
import { HomebrewPage } from "./pages/homebrew/Index.tsx";
import { CharacterBuilderPage } from "./pages/characters/builder/builder-page.tsx";
import { CharacterSheetPage } from "./pages/characters/sheet/sheet-page.tsx";
import { PlayerProvider } from "./lib/player.tsx";
import { LandingPage2 } from "./pages/landing/Index.tsx";
// import "./styles/typography.css";
import App, { AppWide } from "./App.tsx";
import { CharacterDetailsPage } from "./pages/characters/builder/index.tsx";
import { DevelopmentPage } from "./pages/development/Index.tsx";
import { LibraryDevelopmentPage } from "./pages/development/library-page.tsx";
import BuilderAppLayout2 from "./pages/layouts/builder-app-layout-2.tsx";
import BuilderAppLayout from "./pages/layouts/builder-app-layout.tsx";
import CharactersLayout from "./pages/layouts/builder-layout.tsx";
import { CampaignsPage } from "./pages/campaigns/campaigns-page";
import { CampaignPage } from "./pages/campaigns/campaign-page";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5_000,
      refetchOnWindowFocus: false,
    },
  },
});

const router = createBrowserRouter([
  {
    path: "/app",
    element: <BuilderAppLayout />,
    index: true,
  },
  {
    path: "/app2",
    element: <BuilderAppLayout2 />,
    index: true,
  },
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <LandingPage2 /> },
      { path: "about", element: <AboutPage /> },
      { path: "development", element: <DevelopmentPage /> },
      { path: "lib", element: <LibraryDevelopmentPage /> },
      { path: "compendium", element: <CompendiumPage /> },
      { path: "homebrew", element: <HomebrewPage /> },
    ],
  },
  {
    path: "/characters",
    element: <AppWide />,
    children: [
      { index: true, element: <CharactersPage /> },
      { path: ":id", element: <CharacterBuilderPage /> },
      // the upstream test page, still handy for looking at raw registrations and statistics
      { path: ":id/debug", element: <CharactersDetailsPage /> },
      { path: "create", element: <CharactersCreatePage /> },
    ],
  },
  {
    // the Compendium of Lore: its own bundle, loaded when first opened
    path: "/lore",
    element: <AppWide />,
    children: [
      {
        lazy: () => import("./pages/lore/lore-shell.tsx").then((m) => ({ Component: m.LoreShell })),
        children: [
            { index: true, lazy: () => import("./pages/lore/lore-home.tsx").then((m) => ({ Component: m.LoreHome })) },
            { path: "books", lazy: () => import("./pages/lore/library-page.tsx").then((m) => ({ Component: m.BooksPage })) },
            { path: "adventures", lazy: () => import("./pages/lore/library-page.tsx").then((m) => ({ Component: m.AdventuresPage })) },
            { path: "books/:id", lazy: () => import("./pages/lore/book-reader.tsx").then((m) => ({ Component: m.BookReader })) },
            { path: "adventures/:id", lazy: () => import("./pages/lore/book-reader.tsx").then((m) => ({ Component: m.BookReader })) },
            { path: ":category", lazy: () => import("./pages/lore/category-page.tsx").then((m) => ({ Component: m.CategoryPage })) },
            { path: "compare", lazy: () => import("./pages/lore/compare-page.tsx").then((m) => ({ Component: m.ComparePage })) },
            { path: ":category/:key", lazy: () => import("./pages/lore/category-page.tsx").then((m) => ({ Component: m.CategoryPage })) },
        ],
      },
    ],
  },
  {
    path: "/battle",
    element: <AppWide />,
    children: [
      { index: true, lazy: () => import("./pages/battle/battle-index.tsx").then((m) => ({ Component: m.BattleIndexPage })) },
      { path: ":id", lazy: () => import("./pages/battle/battle-page.tsx").then((m) => ({ Component: m.CharacterBattlePage })) },
    ],
  },
  {
    path: "/campaigns",
    element: <AppWide />,
    children: [
      { index: true, element: <CampaignsPage /> },
      { path: ":id", element: <CampaignPage /> },
    ],
  },
  {
    // the printable sheet has no app chrome
    path: "/characters/:id/sheet",
    element: <CharacterSheetPage />,
  },
  {
    path: "/characters/:id/builder",
    element: <CharactersLayout />,
    children: [{ index: true, element: <CharacterDetailsPage /> }],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark" storageKey="starlights-ui-theme">
        <PlayerProvider>
          <RouterProvider router={router} />
        </PlayerProvider>
        {/* <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" /> */}
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);

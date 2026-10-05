import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { BookOpenIcon, CrownIcon, FlaskConicalIcon, LibraryBigIcon, OrbitIcon, ScrollTextIcon, SwordsIcon, UserIcon } from "lucide-react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { ModeToggle } from "@/components/mode-toggle";
import { GitHubIconButton } from "@/components/navigation/github-icon-button";
import { usePlayer } from "@/lib/player";
import { AdminButton } from "@/components/admin-button";

export function LandingBackground() {
  return (
    <>
      <div
        className="absolute inset-0 -z-10 pointer-events-none bg-background dark:hidden"
        style={{
          backgroundImage: `
        linear-gradient(45deg, transparent 49%, #e5e7eb 49%, #e5e7eb 51%, transparent 51%),
        linear-gradient(-45deg, transparent 49%, #e5e7eb 49%, #e5e7eb 51%, transparent 51%)
            `,
          backgroundSize: "40px 40px",
          WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 0%, #000 60%, transparent 100%)",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 0%, #000 60%, transparent 100%)",
        }}
      />
      <div
        className="absolute inset-0 -z-10 pointer-events-none bg-background hidden dark:block"
        style={{
          backgroundImage: `
        linear-gradient(45deg, transparent 49%, rgba(255,255,255,0.06) 49%, rgba(255,255,255,0.06) 51%, transparent 51%),
        linear-gradient(-45deg, transparent 49%, rgba(255,255,255,0.04) 49%, rgba(255,255,255,0.04) 51%, transparent 51%)
            `,
          backgroundSize: "40px 40px",
          WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 0%, #000 60%, transparent 100%)",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 0%, #000 60%, transparent 100%)",
        }}
      />
    </>
  );
}

export function LandingBackground2() {
  return (
    <>
      <div
        className="absolute inset-0 -z-10 pointer-events-none bg-background dark:hidden"
        style={{
          backgroundImage: `
        linear-gradient(45deg, transparent 49%, #e5e7eb 49%, #e5e7eb 51%, transparent 51%),
        linear-gradient(-45deg, transparent 49%, #e5e7eb 49%, #e5e7eb 51%, transparent 51%)
            `,
          backgroundSize: "40px 40px",
          WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 0%, #000 60%, transparent 100%)",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 0%, #000 60%, transparent 100%)",
        }}
      />
      <div
        className="absolute inset-0 -z-10 pointer-events-none bg-background hidden dark:block"
        style={{
          backgroundImage: `
        linear-gradient(45deg, transparent 49%, rgba(255,255,255,0.06) 49%, rgba(255,255,255,0.06) 51%, transparent 51%),
        linear-gradient(-45deg, transparent 49%, rgba(255,255,255,0.04) 49%, rgba(255,255,255,0.04) 51%, transparent 51%)
            `,
          backgroundSize: "40px 40px",
          WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 0%, #000 60%, transparent 100%)",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 0%, #000 60%, transparent 100%)",
        }}
      />
    </>
  );
}

export function LandingBackground3() {
  return (
    <>
      <div
        className="absolute inset-0 -z-10 pointer-events-none bg-background dark:hidden"
        style={{
          backgroundImage: `
        linear-gradient(45deg, transparent 49%, #e5e7eb 49%, #e5e7eb 51%, transparent 51%),
        linear-gradient(-45deg, transparent 49%, #e5e7eb 49%, #e5e7eb 51%, transparent 51%)
            `,
          backgroundSize: "40px 40px",
          WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 0%, #000 60%, transparent 100%)",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 0%, #000 60%, transparent 100%)",
        }}
      />
      <div
        className="absolute inset-0 -z-10 pointer-events-none bg-background hidden dark:block"
        style={{
          backgroundImage: `
        linear-gradient(45deg, transparent 49%, rgba(255,255,255,0.06) 49%, rgba(255,255,255,0.06) 51%, transparent 51%),
        linear-gradient(-45deg, transparent 49%, rgba(255,255,255,0.04) 49%, rgba(255,255,255,0.04) 51%, transparent 51%)
            `,
          backgroundSize: "40px 40px",
          WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 0%, #000 60%, transparent 100%)",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 0%, #000 60%, transparent 100%)",
        }}
      />
    </>
  );
}

function SizeIndicatorBadge({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("uppercase", className)} {...props}>
      <Badge variant={"default"} className="bg-starlights-development block sm:hidden">
        xs
      </Badge>
      <Badge variant={"default"} className="bg-starlights-development hidden sm:block md:hidden">
        sm
      </Badge>
      <Badge variant={"default"} className="bg-starlights-development hidden md:block lg:hidden">
        md
      </Badge>
      <Badge variant={"default"} className="bg-starlights-development hidden lg:block xl:hidden ">
        lg
      </Badge>
      <Badge variant={"default"} className="bg-starlights-development hidden xl:block 2xl:hidden">
        xl
      </Badge>
      <Badge variant={"default"} className="bg-starlights-development hidden 2xl:block">
        2xl
      </Badge>
    </div>
  );
}

export function MainNavigation() {
  return (
    <>
      <nav className="flex items-center justify-between h-16 ">
        <div className="flex items-center justify-start gap-2 ">
          <Link to="/" className=" flex items-center font-heading relative">
            <OrbitIcon className="size-6 mr-3 stroke-starlights-purple-600" />
            <span className="hidden lg:inline tracking-widest mt-0.5">Project Starlights</span>
            <span className="hidden sm:inline lg:hidden tracking-widest mt-0.5">Starlights</span>
          </Link>

          <MainLinks className="ms-6 hidden md:flex" />
        </div>

        <div className="flex items-center justify-end gap-2">
          {/* phones: the same places as icons */}
          <MainLinks className="md:hidden" compact />
          <PlayerChip />
          <AdminButton />
          <div className="flex items-center justify-end gap-2">
            <ModeToggle />
            {/* room for the menu icons on a phone */}
            <span className="hidden sm:contents">
              <GitHubIconButton />
            </span>
          </div>

          {import.meta.env.DEV && (
            <>
              <Separator orientation="vertical" className="min-h-5" />
              <SizeIndicatorBadge className="ms-2" />
            </>
          )}

          {/* <div className="flex items-center justify-end gap-2">
            <AppMenuComponent />
          </div> */}
        </div>
      </nav>
    </>
  );
}

/** The app's main places, as plain links (icons only on a phone); the current one is highlighted. */
const MAIN_LINKS = [
  { to: "/characters", label: "Characters", icon: CrownIcon },
  { to: "/campaigns", label: "Campaigns", icon: ScrollTextIcon },
  { to: "/battle", label: "Battle", icon: SwordsIcon },
  { to: "/lore", label: "Lore", icon: LibraryBigIcon },
  { to: "/compendium", label: "Compendium", icon: BookOpenIcon },
  { to: "/homebrew", label: "Homebrew", icon: FlaskConicalIcon },
];

function MainLinks({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <nav aria-label="Main" className={cn("items-center gap-0.5", compact ? "flex" : "", className)}>
      {MAIN_LINKS.map(({ to, label, icon: LinkIcon }) => (
        <NavLink
          key={to}
          to={to}
          aria-label={compact ? label : undefined}
          title={compact ? label : undefined}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-1.5 rounded-md text-sm transition-colors hover:bg-muted hover:text-foreground",
              compact ? "p-2" : "px-2.5 py-1.5",
              isActive ? "text-foreground bg-muted/60" : "text-muted-foreground",
              compact && (to === "/compendium" || to === "/homebrew") && "hidden sm:flex",
            )
          }
        >
          <LinkIcon className={compact ? "size-5" : "size-4"} />
          {!compact && <span className={cn(to === "/compendium" || to === "/homebrew" ? "hidden lg:inline" : "")}>{label}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

function PlayerChip() {
  const { player } = usePlayer();
  if (!player) return null;
  return (
    <Link to="/characters" title="Your characters" className="hidden items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-muted sm:flex">
      <UserIcon className="size-3.5" />
      {player}
    </Link>
  );
}

export function Header() {
  return (
    <div className="sticky top-0 bg-background/80 backdrop-blur-md z-20 border-b print:hidden">
      <header className="container mx-auto px-4 ">
        <MainNavigation />
      </header>
    </div>
  );
}

export function CharactersLayout() {
  return (
    <>
      <Header />
      {/* <div className="border-b border-b-slate-200/50 dark:border-b-slate-700/50">
        <NavigationMenuDemo />
      </div> */}

      <div className="">
        <div className="">
          <LandingBackground2 />
          <Outlet />
        </div>
      </div>
    </>
  );
}

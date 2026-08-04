import { NavLink, Outlet } from "react-router-dom";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive ? "" : "hover:opacity-80"
  }`;

const linkStyle = ({ isActive }: { isActive: boolean }) =>
  isActive
    ? {
        background: "color-mix(in oklab, var(--series-1) 14%, transparent)",
        color: "var(--series-1)",
      }
    : { color: "var(--text-secondary)" };

export default function Layout() {
  return (
    <div className="w-full px-4 pb-16">
      <header className="flex flex-wrap items-center gap-4 py-4">
        <div className="flex items-center gap-2">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="var(--series-1)"
          >
            <path d="M12 2 4 5v6c0 5.25 3.4 9.74 8 11 4.6-1.26 8-5.75 8-11V5l-8-3zm-1.2 13.5-3.3-3.3 1.4-1.4 1.9 1.9 4.3-4.3 1.4 1.4-5.7 5.7z" />
          </svg>
          <h1 className="text-lg font-semibold">Provider Ban Server</h1>
          <span
            className="hidden rounded-full px-2 py-0.5 text-xs sm:inline"
            style={{
              color: "var(--text-muted)",
              border: "1px solid var(--grid)",
            }}
          >
            common ban — all requestors
          </span>
        </div>
        <nav className="flex gap-1">
          <NavLink to="/" end className={linkClass} style={linkStyle}>
            Dashboard
          </NavLink>
          <NavLink to="/providers" className={linkClass} style={linkStyle}>
            Providers
          </NavLink>
          <NavLink to="/bans" className={linkClass} style={linkStyle}>
            Bans
          </NavLink>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}

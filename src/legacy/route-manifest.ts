import manifest from "../../routes.legacy.json";

type LegacyRoute = {
  path: string;
  route: string;
  tab: string;
  title: string;
};

export type LegacyRouteManifest = LegacyRoute[];

export const legacyRoutes = manifest as LegacyRouteManifest;

export function findLegacyRoute(pathname: string): LegacyRoute | undefined {
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return legacyRoutes.find((entry) => entry.path === normalized);
}

// Hash routes: #/ (overview map), #/list (glacier table) and #/glacier/GID278?trace=…&scene=…&season=JJA&color=season
// (shareable, and safe from Pages 404s).

export type Route = { view: "overview" } | { view: "list" }
  | { view: "glacier"; id: string; trace?: string; scene?: string; seasons?: string[]; color?: "season" };

export function parseRoute(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#/, "").split("?");
  if (path === "/list") return { view: "list" };
  const match = path.match(/^\/glacier\/(GID\w+)$/);
  if (!match) return { view: "overview" };
  const params = new URLSearchParams(query);
  const route: Route = { view: "glacier", id: match[1] };
  for (const key of ["trace", "scene"] as const) {
    const value = params.get(key);
    if (value) route[key] = value;
  }
  const seasons = params.getAll("season");
  if (seasons.length) route.seasons = seasons;
  if (params.get("color") === "season") route.color = "season"; // coloring by sensor is the default
  return route;
}

export function formatRoute(route: Route): string {
  if (route.view === "overview") return "#/";
  if (route.view === "list") return "#/list";
  const params = new URLSearchParams();
  if (route.trace) params.set("trace", route.trace);
  if (route.scene) params.set("scene", route.scene);
  for (const season of route.seasons ?? []) params.append("season", season);
  if (route.color) params.set("color", route.color);
  const query = params.toString();
  return `#/glacier/${route.id}${query ? `?${query}` : ""}`;
}

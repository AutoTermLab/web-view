// Hash routes: #/ (glacier list) and #/glacier/GID278?trace=…&scene=… (shareable, and safe from Pages 404s).

export type Route = { view: "list" } | { view: "glacier"; id: string; trace?: string; scene?: string };

export function parseRoute(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#/, "").split("?");
  const match = path.match(/^\/glacier\/(GID\w+)$/);
  if (!match) return { view: "list" };
  const params = new URLSearchParams(query);
  const route: Route = { view: "glacier", id: match[1] };
  for (const key of ["trace", "scene"] as const) {
    const value = params.get(key);
    if (value) route[key] = value;
  }
  return route;
}

export function formatRoute(route: Route): string {
  if (route.view === "list") return "#/";
  const params = new URLSearchParams();
  if (route.trace) params.set("trace", route.trace);
  if (route.scene) params.set("scene", route.scene);
  const query = params.toString();
  return `#/glacier/${route.id}${query ? `?${query}` : ""}`;
}

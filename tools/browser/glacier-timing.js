// Times opening a glacier view: run with shot.py from #/list (no map yet), with GLACIER replaced by an id, e.g.
//   docker run --rm --network host web-view-browser shot.py http://localhost:5173/web-view/#/list -o /tmp/x.png \
//     --wait 'window.ready === true' --settle 25 --eval "$(sed s/GLACIER/GID150/ tools/browser/glacier-timing.js)" | grep TIMING
// Prints ms from navigation to: map created, traces drawn, scene preview drawn, all basemap tiles loaded (idle),
// plus basemap tile stats. A glacier's basemap tiles are slow the first time anyone opens it (OpenFreeMap's cache is cold),
// so compare runs on glaciers not opened before.
void (() => {
  const t0 = performance.now(), marks = {}, starts = new Map(), tiles = [];
  const now = () => Math.round(performance.now() - t0);
  location.hash = "#/glacier/GLACIER";
  const poll = setInterval(() => {
    const map = window.map;
    if (!map) return;
    if (!marks.created) {
      marks.created = now();
      map.on("dataloading", (e) => { if (e.tile && e.sourceId === "openmaptiles") starts.set(e.tile.tileID.key, now()); });
      map.on("data", (e) => {
        if (!e.tile || e.sourceId !== "openmaptiles" || !starts.has(e.tile.tileID.key)) return;
        tiles.push(now() - starts.get(e.tile.tileID.key)); starts.delete(e.tile.tileID.key);
      });
    }
    if (!marks.traces && map.getLayer("selected")) marks.traces = now();
    if (!marks.scene && map.getLayer("scene")) marks.scene = now();
    if (marks.traces && marks.scene && window.ready) {
      clearInterval(poll);
      const done = () => {
        marks.basemap = now();
        tiles.sort((a, b) => a - b);
        console.log("TIMING", JSON.stringify({ ...marks, tiles: tiles.length, tileMedian: tiles[tiles.length >> 1], tileMax: tiles.at(-1) }));
      };
      map.areTilesLoaded() && map.loaded() ? done() : map.once("idle", done);
    }
  }, 5);
})();

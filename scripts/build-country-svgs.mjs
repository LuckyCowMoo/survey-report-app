import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "src", "assets", "tutorial");

function decodeTopology(topology) {
  const { scale, translate } = topology.transform;
  const arcs = topology.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });

  const arcPoints = (index) => {
    const pts = arcs[index < 0 ? ~index : index];
    return index < 0 ? pts.slice().reverse() : pts;
  };

  const ringFromArcs = (indexes) => {
    const ring = [];
    for (const idx of indexes) {
      const pts = arcPoints(idx);
      const start = ring.length ? 1 : 0;
      for (let i = start; i < pts.length; i++) ring.push(pts[i]);
    }
    return ring;
  };

  const polygonsFromGeometry = (geom) => {
    if (geom.type === "Polygon") return [geom.arcs.map(ringFromArcs)];
    if (geom.type === "MultiPolygon") {
      return geom.arcs.map((poly) => poly.map(ringFromArcs));
    }
    return [];
  };

  return { polygonsFromGeometry };
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}

function largestPolygon(polygons) {
  let best = polygons[0];
  let bestA = 0;
  for (const poly of polygons) {
    const a = ringArea(poly[0] ?? []);
    if (a > bestA) {
      bestA = a;
      best = poly;
    }
  }
  return best;
}

function mercator([lon, lat]) {
  const x = lon;
  const y =
    (180 / Math.PI) *
    Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return [x, y];
}

function toPath(rings, bounds, pad, size) {
  const [minX, minY, maxX, maxY] = bounds;
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const sx = (size - pad * 2) / w;
  const sy = (size - pad * 2) / h;
  const s = Math.min(sx, sy);
  const ox = (size - w * s) / 2;
  const oy = (size - h * s) / 2;
  const map = ([x, y]) => [
    ox + (x - minX) * s,
    size - (oy + (y - minY) * s)
  ];
  return rings
    .map((ring) => {
      return ring
        .map((p, i) => {
          const [x, y] = map(p);
          return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
        })
        .join(" ");
    })
    .join(" ") + " Z";
}

function boundsOf(rings) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

function projectRings(rings) {
  return rings.map((ring) => ring.map(mercator));
}

function geomToProjected(decoder, geom) {
  const polygons = decoder.polygonsFromGeometry(geom);
  const poly = largestPolygon(polygons);
  return projectRings(poly);
}

function writeSvg(name, d, size = 120) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" fill="black"><path d="${d}"/></svg>\n`;
  writeFileSync(join(dir, name), svg);
}

const uk = JSON.parse(readFileSync(join(dir, "CTRY_UK.json"), "utf8"));
const ukDec = decodeTopology(uk);
const byName = Object.fromEntries(
  uk.objects.geog.geometries.map((g) => [g.properties.name, g])
);

const world = JSON.parse(readFileSync(join(dir, "ireland-110m.json"), "utf8"));
const worldDec = decodeTopology(world);
const irelandGeom = world.objects.countries.geometries.find(
  (g) => g.properties.name === "Ireland"
);

const england = geomToProjected(ukDec, byName.England);
const wales = geomToProjected(ukDec, byName.Wales);
const scotland = geomToProjected(ukDec, byName.Scotland);
const ni = geomToProjected(ukDec, byName["Northern Ireland"]);
const ireland = geomToProjected(worldDec, irelandGeom);

writeSvg("map-england.svg", toPath(england, boundsOf(england), 8, 120));
writeSvg("map-wales.svg", toPath(wales, boundsOf(wales), 8, 120));
writeSvg("map-scotland.svg", toPath(scotland, boundsOf(scotland), 8, 120));

const island = [...ireland, ...ni];
const islandBounds = boundsOf(island);
writeSvg("map-ireland.svg", toPath(ireland, islandBounds, 6, 140), 140);
writeSvg("map-ni.svg", toPath(ni, islandBounds, 6, 140), 140);

mkdirSync(dir, { recursive: true });
console.log("wrote country outline svgs");

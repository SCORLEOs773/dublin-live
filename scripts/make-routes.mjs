import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const input = process.argv[2];
if (!input) {
  console.error("Usage: node scripts/make-routes.mjs path/to/routes.txt");
  process.exit(1);
}

// Minimal CSV reader that copes with quoted commas
function parseLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const lines = readFileSync(input, "utf8")
  .replace(/^\uFEFF/, "")
  .split(/\r?\n/)
  .filter(Boolean);
const header = parseLine(lines[0]);
const iId = header.indexOf("route_id");
const iShort = header.indexOf("route_short_name");
const iLong = header.indexOf("route_long_name");

if (iId < 0 || iShort < 0) {
  console.error(
    "routes.txt doesn't have the expected columns:",
    header.join(", "),
  );
  process.exit(1);
}

const routes = {};
for (const line of lines.slice(1)) {
  const c = parseLine(line);
  routes[c[iId]] = { n: c[iShort], l: iLong >= 0 ? c[iLong] : "" };
}

mkdirSync("public", { recursive: true });
writeFileSync("public/routes.json", JSON.stringify(routes));
console.log(
  `Wrote public/routes.json with ${Object.keys(routes).length} routes`,
);

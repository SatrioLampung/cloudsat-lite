import fs from "fs";
import path from "path";

const root = process.cwd();
const source = path.join(root, "node_modules", "cesium", "Build", "Cesium");
const target = path.join(root, "public", "cesium");

if (!fs.existsSync(source)) {
  console.log("[cesium-assets] source not found yet, run npm install first.");
  process.exit(0);
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.cpSync(source, target, { recursive: true });

console.log("[cesium-assets] copied to public/cesium");

// Mark each build folder with its module type so Node loads it correctly.
const fs = require("fs");
const path = require("path");
for (const [dir, type] of [["esm", "module"], ["cjs", "commonjs"]]) {
  fs.writeFileSync(path.join(__dirname, "..", "dist", dir, "package.json"), JSON.stringify({ type }) + "\n");
}

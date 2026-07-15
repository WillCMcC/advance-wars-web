import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFieldKitServer } from "../server/app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 4173);
const server = createFieldKitServer({
  distDir: path.join(root, "dist"),
  dataDir: process.env.FIELD_KIT_DATA_DIR || path.join(root, ".e2e-data")
});
await server.ready;
server.listen(port, "127.0.0.1", () => console.log(`Field Kit preview listening at http://127.0.0.1:${port}`));

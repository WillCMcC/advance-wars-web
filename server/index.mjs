import { createFieldKitServer } from "./app.mjs";

const port = Number(process.env.PORT || 8080);
const server = createFieldKitServer();
await server.ready;
server.listen(port, "0.0.0.0", () => console.log(`Field Kit listening on ${port}`));

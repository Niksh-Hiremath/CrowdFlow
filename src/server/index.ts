import "dotenv/config";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { createCrowdFlowApp } from "./app.js";

const host = process.env.HOST?.trim() || "0.0.0.0";
const port = Number(process.env.PORT || 7860);

const { app, sessions } = createCrowdFlowApp();
const server = createServer(app);
const sockets = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const match = /^\/api\/sessions\/([^/]+)\/stream$/.exec(url.pathname);
  const session = match ? sessions.get(decodeURIComponent(match[1]!)) : undefined;
  if (!session) {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(request, socket, head, (webSocket) => {
    sessions.addSocket(session, webSocket);
  });
});

server.listen(port, host, () => {
  process.stdout.write(`CrowdFlow listening on http://${host}:${port}\n`);
});

const shutdown = (): void => {
  sessions.stopAll();
  for (const client of sockets.clients) client.terminate();
  sockets.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_000).unref();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

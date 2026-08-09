import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { createCrowdFlowApp } from "../../src/server/app.js";

const host = "127.0.0.1";
const port = 7878;

export default async function globalSetup(): Promise<() => Promise<void>> {
  const { app, sessions } = createCrowdFlowApp();
  const server = createServer(app);
  const sockets = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);
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

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });

  return async () => {
    sessions.stopAll();
    for (const client of sockets.clients) client.terminate();
    sockets.close();

    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  };
}

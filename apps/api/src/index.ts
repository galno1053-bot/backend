import express from "express";
import http from "http";
import cors from "cors";
import pinoHttp from "pino-http";
import { Server as SocketServer } from "socket.io";
import { config } from "./config.js";
import { buildRouter } from "./routes.js";
import { GameEngine } from "./game.js";
import { setupSocket } from "./socket.js";
import { startEvmListener, startSolanaListener } from "./services/listeners.js";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));
const httpLogger = (pinoHttp as unknown as (opts?: any) => any)();
app.use(httpLogger);

const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: { origin: true, credentials: true }
});

const game = new GameEngine(io);
app.use(buildRouter(game));
setupSocket(io, game);

server.listen(config.port, async () => {
  await game.start();
  await startEvmListener();
  await startSolanaListener();
  console.log(`API listening on :${config.port}`);
});

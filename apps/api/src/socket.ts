import { Server as SocketServer } from "socket.io";
import { prisma } from "./db.js";
import { getUserFromToken } from "./auth.js";
import { GameEngine } from "./game.js";

const sanitizeText = (text: string) => {
  const stripped = text.replace(/<[^>]*>?/gm, "");
  return stripped.slice(0, 240);
};

export const setupSocket = (io: SocketServer, game: GameEngine) => {
  const onlineUsers = new Map<string, { userId: string; username: string }>();
  const lastChatAt = new Map<string, number>();
  const lastBetAt = new Map<string, number>();

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Unauthorized"));
    const user = await getUserFromToken(token);
    if (!user) return next(new Error("Unauthorized"));
    socket.data.user = user;
    next();
  });

  io.on("connection", async (socket) => {
    const user = socket.data.user as { id: string; username: string };
    onlineUsers.set(socket.id, { userId: user.id, username: user.username });

    io.emit("presence:update", {
      onlineCount: onlineUsers.size,
      users: Array.from(onlineUsers.values())
    });

    socket.emit("round:state", game.getState());

    socket.on("bet:place", async (payload, ack) => {
      const now = Date.now();
      const last = lastBetAt.get(user.id) ?? 0;
      if (now - last < 800) {
        if (ack) ack({ ok: false, error: "Rate limited." });
        return;
      }
      lastBetAt.set(user.id, now);
      const amount = Number(payload?.amount ?? 0);
      const result = await game.placeBet(user.id, amount);
      if (ack) ack(result);
    });

    socket.on("bet:cashout", async (_payload, ack) => {
      const now = Date.now();
      const last = lastBetAt.get(user.id) ?? 0;
      if (now - last < 300) {
        if (ack) ack({ ok: false, error: "Rate limited." });
        return;
      }
      lastBetAt.set(user.id, now);
      const result = await game.cashout(user.id);
      if (ack) ack(result);
    });

    socket.on("chat:send", async (payload, ack) => {
      const now = Date.now();
      const last = lastChatAt.get(user.id) ?? 0;
      if (now - last < 2000) {
        if (ack) ack({ ok: false, error: "Rate limited." });
        return;
      }
      lastChatAt.set(user.id, now);

      const text = sanitizeText(String(payload?.text ?? ""));
      if (!text) {
        if (ack) ack({ ok: false, error: "Empty message." });
        return;
      }
      const message = await prisma.chatMessage.create({
        data: {
          userId: user.id,
          text
        },
        include: { user: true }
      });
      io.emit("chat:new", {
        id: message.id,
        userId: message.userId,
        username: message.user.username,
        text: message.text,
        createdAt: message.createdAt.toISOString()
      });
      if (ack) ack({ ok: true });
    });

    socket.on("ping", (ack) => {
      if (ack) ack();
    });

    socket.on("disconnect", () => {
      onlineUsers.delete(socket.id);
      io.emit("presence:update", {
        onlineCount: onlineUsers.size,
        users: Array.from(onlineUsers.values())
      });
    });
  });
};

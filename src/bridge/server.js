import { randomBytes } from "node:crypto";
import http from "node:http";
import { WebSocketServer } from "ws";

const PAIR_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function pairCode() {
  const bytes = randomBytes(6);
  return [...bytes].map((byte) => PAIR_ALPHABET[byte % PAIR_ALPHABET.length]).join("");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function createBridge() {
  let server = null;
  let wss = null;
  let boundPort = 0;
  let code = null;
  let token = null;
  const sockets = new Set();
  const pending = new Map();
  let nextId = 1;

  function send(socket, message) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }

  function failPending(error) {
    for (const [id, waiter] of pending) {
      clearTimeout(waiter.timer);
      pending.delete(id);
      waiter.resolve({ ok: false, error });
    }
  }

  async function listen(host, port) {
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url || "/", `http://${host}`);
      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: "ok", port: boundPort || port }));
        return;
      }
      if (req.method === "POST" && url.pathname === "/pair") {
        const raw = await readBody(req);
        let body = {};
        try {
          body = JSON.parse(raw || "{}");
        } catch {
          body = {};
        }
        if (!code || body.code !== code) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "That code is not valid." }));
          return;
        }
        code = null;
        token = randomBytes(32).toString("hex");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ token }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url || "/", `http://${host}`);
      if (url.pathname !== "/ws") {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        let authed = false;
        const timer = setTimeout(() => {
          if (!authed) ws.close(4001, "auth required");
        }, 5000);
        ws.on("message", (data) => {
          let message;
          try {
            message = JSON.parse(String(data));
          } catch {
            ws.close(4002, "bad json");
            return;
          }
          if (!authed) {
            if (message.type !== "auth" || !token || message.token !== token) {
              ws.close(4001, "bad token");
              return;
            }
            authed = true;
            clearTimeout(timer);
            sockets.add(ws);
            return;
          }
          if (message.type === "ping") {
            send(ws, { type: "pong" });
            return;
          }
          if (message.type === "result" && pending.has(String(message.id))) {
            const waiter = pending.get(String(message.id));
            clearTimeout(waiter.timer);
            pending.delete(String(message.id));
            waiter.resolve({
              ok: Boolean(message.ok),
              data: message.data,
              error: message.error,
            });
          }
        });
        ws.on("close", () => {
          clearTimeout(timer);
          sockets.delete(ws);
          if (sockets.size === 0) failPending("The browser is not connected.");
        });
      });
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });
  }

  return {
    address() {
      return server?.address() ?? null;
    },
    port() {
      return boundPort;
    },
    currentCode() {
      return code;
    },
    connected() {
      return sockets.size > 0 && Boolean(token);
    },
    beginPair() {
      code = pairCode();
      return code;
    },
    revoke() {
      token = null;
      code = null;
      for (const socket of sockets) socket.close(4000, "revoked");
      sockets.clear();
      failPending("The browser is not connected.");
    },
    async start({ host = "127.0.0.1", port = 47321, maxPort = 47330 } = {}) {
      let lastError = null;
      for (let candidate = port; candidate <= maxPort; candidate += 1) {
        try {
          await listen(host, candidate);
          boundPort = server.address().port;
          return { host, port: boundPort };
        } catch (error) {
          lastError = error;
          server = null;
          wss = null;
          if (error.code !== "EADDRINUSE") break;
        }
      }
      throw lastError ?? new Error("No local port available.");
    },
    call(tool, args, timeoutMs = 20000) {
      const socket = [...sockets][0];
      if (!socket || !token) {
        return Promise.resolve({ ok: false, error: "The browser is not connected." });
      }
      const id = String(nextId);
      nextId += 1;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ ok: false, error: "The browser did not answer." });
        }, timeoutMs);
        pending.set(id, { resolve, timer });
        send(socket, { id, type: "call", tool, args: args ?? {} });
      });
    },
    async close() {
      this.revoke();
      await new Promise((resolve) => {
        if (!server) {
          resolve();
          return;
        }
        server.close(() => resolve());
      });
      wss?.close();
    },
  };
}

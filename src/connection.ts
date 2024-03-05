import WebSocket from "ws";
import { Client, InValue, ResultSet, createClient } from "@libsql/client";
import net from "net";
import child_process from "child_process";
import crypto from "crypto";

type HandshakeMessage = {
  type: "hello";
  jwt: string;
};

type RequestExecuteMessage = {
  type: "execute";
  stream_id: number;
  stmt: {
    sql: string;
    args: { type: string; value: InValue }[];
    named_args: unknown[];
    want_rows: boolean;
  };
};

type RequestOpenStreamMessage = {
  type: "open_stream";
  stream_id: number;
};

type RequestCloseStreamMessage = {
  type: "close_stream";
  stream_id: number;
};

type RequestMessageBody =
  | RequestExecuteMessage
  | RequestOpenStreamMessage
  | RequestCloseStreamMessage;

type RequestMessage = {
  type: "request";
  request_id: number;
  request: RequestMessageBody;
};

type Message = HandshakeMessage | RequestMessage;

function getValueType(value: unknown) {
  if (typeof value === "string") return "text";
  if (typeof value === "number") return "float";
  if (value === null) return "null";
  return "text";
}

class MessageHandler {
  protected current: Promise<void>;
  protected socket: WebSocket;
  protected db: Client;
  protected token: string;

  constructor(socket: WebSocket, db: Client, token: string) {
    this.current = Promise.resolve();
    this.socket = socket;
    this.db = db;
    this.token = token;

    socket.on("message", (msg) => {
      this.push(async () => {
        await this.handleMessage(JSON.parse(msg.toString()));
      });
    });
  }

  push(handler: () => Promise<void>) {
    this.current.then(handler);
  }

  async handleMessage(msg: Message) {
    if (msg.type === "hello") {
      await this.handleAuth(msg);
    } else if (msg.type === "request") {
      const body = msg.request;
      const requestId = msg.request_id;

      if (body.type === "open_stream") {
        await this.handleOpenStream(requestId, body);
      } else if (body.type === "close_stream") {
        await this.handleCloseStream();
      } else if (body.type === "execute") {
        await this.handleExecuteRequest(requestId, body);
      }
    }
  }

  async handleAuth(msg: HandshakeMessage) {
    if (msg.jwt === this.token) {
      this.socket.send(
        JSON.stringify({
          type: "hello_ok",
        })
      );
    } else {
      this.socket.send(
        JSON.stringify({
          type: "hello_error",
          error: {
            message: "Authentication failed: The JWT is invalid",
            code: "AUTH_JWT_INVALID",
          },
        })
      );

      throw new Error("Authentication failed: The JWT is invalid");
    }
  }

  async handleOpenStream(requestId: number, msg: RequestOpenStreamMessage) {
    this.socket.send(
      JSON.stringify({
        type: "response_ok",
        request_id: requestId,
        response: { type: "open_stream" },
      })
    );
  }

  async handleCloseStream() {}

  async handleExecuteRequest(requestId: number, body: RequestExecuteMessage) {
    try {
      const r = await this.db.execute({
        sql: body.stmt.sql,
        args: body.stmt.args.map((arg) => arg.value),
      });

      this.socket.send(this.prepareResult(requestId, r));
    } catch (e) {
      this.socket.send(
        JSON.stringify({
          type: "response_error",
          request_id: requestId,
          error: {
            message: e.message,
          },
        })
      );
    }
  }

  prepareResult(requestId: number, r: ResultSet) {
    return JSON.stringify({
      type: "response_ok",
      request_id: requestId,
      response: {
        type: "execute",
        result: {
          cols: r.columns.map((col, colIdx) => ({
            name: col,
            decltype: r.columnTypes[colIdx],
          })),
          rows: r.rows.map((row) =>
            r.columns.map((col) => ({
              type: getValueType(row[col]),
              value: row[col],
            }))
          ),
          last_insert_rowid:
            r.lastInsertRowid === null || r.lastInsertRowid === undefined
              ? null
              : r.lastInsertRowid.toString(),
          affected_row_count: r.rowsAffected,
        },
      },
    });
  }
}

function checkPortUsed(port: number) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", function (err) {
      if ((err as any).code === "EADDRINUSE") {
        resolve(true);
      }
    });

    server.once("listening", function () {
      server.close();
      resolve(false);
    });

    server.listen(port);
  });
}

export default async function handleConnection(file: string) {
  const db = createClient({
    url: "file:" + file,
  });

  console.info("Generating authentication token");
  const token = crypto.randomBytes(12).toString("hex");

  let port = 4000;

  // Find unused port
  for (let i = 0; i < 10; i++) {
    const used = await checkPortUsed(port);
    if (!used) break;
    console.log(`Port ${port} is already used. Trying another port`);
    port = port + 1;
  }

  console.log("Listening to port " + port);
  const ws = new WebSocket.Server({
    port,
  });

  ws.on("connection", function (socket) {
    new MessageHandler(socket, db, token);
  });

  console.info("Open LibSQL Studio in the browser");
  if (process.platform.startsWith("win")) {
    child_process.exec(
      `start https://libsqlstudio.com/client?c=${port}:${token}`
    );
  } else {
    child_process.exec(
      `open https://libsqlstudio.com/client?c=${port}:${token}`
    );
  }
}

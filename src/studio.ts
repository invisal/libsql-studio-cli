import express from "express";
import { ResultSet, createClient } from "@libsql/client";
import expressBasicAuth from "express-basic-auth";

const htmlCode = `<!doctype>
<html>
<head>
  <style>
    html, body {
      padding: 0;
      margin: 0;
      width: 100vw;
      height: 100vh;
    }

    iframe {
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      border: 0;
    }
  </style>
</head>
<body>
  <script>
    function handler(e) {
      if (e.data.type !== "query" && e.data.type !== "transaction") return;
      fetch("/query", {
        method: "post",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(e.data)
      }).then(r => r.json()).then(r => {
        document.getElementById('editor').contentWindow.postMessage(r, "*");
      })
    }

    window.addEventListener("message", handler);
  </script>

  <iframe
    id="editor"
    src="https://libsqlstudio.com/embed/sqlite"
  />
</body>
</html>`;

export function serve(
  file: string,
  {
    port,
    username,
    password,
  }: { port: number; username?: string; password?: string }
) {
  const app = express();

  const db = createClient({
    url: "file:" + file,
    intMode: "number",
  });

  app.use(express.json());

  if (username) {
    app.use(
      expressBasicAuth({
        users: { [username]: password ?? "" },
        challenge: true,
      })
    );
  }

  app.get("/", (_, res) => {
    return res.send(htmlCode);
  });

  app.post("/query", async (req, res) => {
    const body:
      | { id: number; type: "query"; statement: string }
      | {
          id: number;
          type: "transaction";
          statements: string[];
        } = req.body;

    try {
      if (body.type === "query") {
        const r = await db.execute(body.statement);
        return res.json({
          type: body.type,
          id: body.id,
          data: transformRawResult(r),
        });
      } else {
        const r = await db.batch(body.statements);
        return res.json({
          type: body.type,
          id: body.id,
          data: r.map(transformRawResult),
        });
      }
    } catch (e) {
      return res.json({
        type: e.data.type,
        id: e.data.id,
        error: (e as Error).message,
      });
    }
  });

  app.listen(port);
  printServingMessage(port);
}

interface ResultHeader {
  name: string;
  displayName: string;
  originalType: string | null;
  type: ColumnType;
}

interface Result {
  rows: Record<string, unknown>[];
  headers: ResultHeader[];
  stat: {
    rowsAffected: number;
    rowsRead: number | null;
    rowsWritten: number | null;
    queryDurationMs: number | null;
  };
  lastInsertRowid?: number;
}

enum ColumnType {
  TEXT = 1,
  INTEGER = 2,
  REAL = 3,
  BLOB = 4,
}

function convertSqliteType(type: string | undefined): ColumnType {
  // https://www.sqlite.org/datatype3.html
  if (type === undefined) return ColumnType.BLOB;

  type = type.toUpperCase();

  if (type.includes("CHAR")) return ColumnType.TEXT;
  if (type.includes("TEXT")) return ColumnType.TEXT;
  if (type.includes("CLOB")) return ColumnType.TEXT;
  if (type.includes("STRING")) return ColumnType.TEXT;

  if (type.includes("INT")) return ColumnType.INTEGER;

  if (type.includes("BLOB")) return ColumnType.BLOB;

  if (
    type.includes("REAL") ||
    type.includes("DOUBLE") ||
    type.includes("FLOAT")
  )
    return ColumnType.REAL;

  return ColumnType.TEXT;
}

function transformRawResult(raw: ResultSet): Result {
  const headerSet = new Set();

  const headers: ResultHeader[] = raw.columns.map((colName, colIdx) => {
    const colType = raw.columnTypes[colIdx];
    let renameColName = colName;

    for (let i = 0; i < 20; i++) {
      if (!headerSet.has(renameColName)) break;
      renameColName = `__${colName}_${i}`;
    }

    headerSet.add(renameColName);

    return {
      name: renameColName,
      displayName: colName,
      originalType: colType,
      type: convertSqliteType(colType),
    };
  });

  const rows = raw.rows.map((r) =>
    headers.reduce((a, b, idx) => {
      a[b.name] = r[idx];
      return a;
    }, {} as Record<string, unknown>)
  );

  return {
    rows,
    stat: {
      rowsAffected: raw.rowsAffected,
      rowsRead: null,
      rowsWritten: null,
      queryDurationMs: 0,
    },
    headers,
    lastInsertRowid:
      raw.lastInsertRowid === undefined
        ? undefined
        : Number(raw.lastInsertRowid),
  };
}

function getIPAddress() {
  var interfaces = require("os").networkInterfaces();
  for (var devName in interfaces) {
    var iface = interfaces[devName];

    for (var i = 0; i < iface.length; i++) {
      var alias = iface[i];
      if (
        alias.family === "IPv4" &&
        alias.address !== "127.0.0.1" &&
        !alias.internal
      )
        return alias.address;
    }
  }
  return "0.0.0.0";
}

function printServingMessage(port: number) {
  const text = [
    "Serving!",
    `- Local:    http://localhost:${port}`,
    `- Network:  http://${getIPAddress()}:${port}`,
  ];

  const paddingY = 2;
  const paddingX = 4;

  const maxText = Math.max(...text.map((t) => t.length));
  const topLine = new Array(maxText + paddingX * 2 + 2).fill("═").join("");
  const space = new Array(maxText + paddingX * 2 + 2).fill(" ").join("");
  const paddingSpace = space.substring(0, paddingX);

  console.log("╔" + topLine.substring(2) + "╗");

  for (let i = 0; i < paddingY; i++) {
    console.log("║" + space.substring(2) + "║");
  }

  for (const line of text) {
    console.log(
      "║" +
        paddingSpace +
        line +
        space.substring(0, maxText - line.length) +
        paddingSpace +
        "║"
    );
  }

  for (let i = 0; i < paddingY; i++) {
    console.log("║" + space.substring(2) + "║");
  }

  console.log("╚" + topLine.substring(2) + "╝");
}

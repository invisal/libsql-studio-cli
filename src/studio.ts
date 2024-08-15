import express from "express";
import expressBasicAuth from "express-basic-auth";
import BaseDriver from "./drivers/base";

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
  driver: BaseDriver,
  {
    port,
    username,
    password,
    log,
  }: { port: number; username?: string; password?: string; log?: boolean }
) {
  const app = express();
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
        if (log) {
          console.log("Query | " + body.statement);
        }

        const r = await driver.query(body.statement);
        return res.json({
          type: body.type,
          id: body.id,
          data: r,
        });
      } else {
        const r = await driver.batch(body.statements);

        if (log) {
          body.statements.forEach((s) => console.log("Query | " + s));
        }

        return res.json({
          type: body.type,
          id: body.id,
          data: r,
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

  const server = app.listen(port);
  printServingMessage(port);

  console.log("Press q | shutdown the server");

  process.stdin.setRawMode(true);
  process.stdin.resume();

  process.stdin.on("data", (buffer) => {
    const c = new TextDecoder().decode(buffer);

    if (c.toUpperCase() === "Q" || buffer[0] === 3) {
      console.log("Shutting down the server");
      server.closeAllConnections();
      process.exit();
    }
  });

  process.on("SIGINT", function () {
    console.log("Caught interrupt signal");
    console.log("Shutting down the server");
    server.closeAllConnections();
    process.exit();
  });
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

  const paddingY = 1;
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

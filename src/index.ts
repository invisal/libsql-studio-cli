#!/usr/bin/env node
import { program } from "commander";
import { serve } from "./studio";

program.name("sqlstudio");

program
  .version("2.0.3")
  .option("--port <port>", "Set port to serve", "4000")
  .option("--user <username>", "Set basic authentication username")
  .option("--pass <password>", "Set basic authentication password")
  .option("-l --log", "Enable log that show all the SQL executed")
  .argument("<file>", "sqlite database file")
  .action((file, options) => {
    serve(file, {
      port: Number(options.port ?? 4000),
      username: options.user,
      password: options.pass,
      log: !!options.log,
    });
  });

program.parse();

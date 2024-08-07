#!/usr/bin/env node
import { program } from "commander";
import { serve } from "./studio";

program.name("sqlstudio");

program
  .version("1.0.1")
  .command("open")
  .argument("<file>", "sqlite database file")
  .option(
    "-p",
    "Port you want to serve your sqlite file. The default port is 4000",
    "4000"
  )
  .action((str, options) => {
    serve(str, Number(options.p));
  });

program.parse();

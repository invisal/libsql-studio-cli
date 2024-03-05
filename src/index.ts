#!/usr/bin/env node
import { program } from "commander";
import handleConnection from "./connection";

program.name("sqlstudio");

program
  .version("0.1.0")
  .command("open")
  .argument("<file>", "sqlite database file")
  .action((str) => {
    handleConnection(str);
  });

program.parse();

import { runDemoCommand } from "./lib/demo-cli";

runDemoCommand("seed", process.argv.slice(2), {
  env: process.env,
  io: { out: (l) => console.log(l), err: (l) => console.error(l) },
}).then((code) => {
  process.exitCode = code;
});

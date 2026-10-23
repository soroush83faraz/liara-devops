import { runSpikeCommand } from "./lib/spike-cli";

runSpikeCommand(process.argv.slice(2), {
  env: process.env,
  io: { out: (l) => console.log(l), err: (l) => console.error(l) },
}).then((code) => {
  process.exitCode = code;
});

// Deploys THIS product to Liara through its own executors and deploy code. DRY RUN unless --yes.
// Usage: npx tsx --env-file=.env scripts/deploy-self.ts [--yes] | --destroy --confirm-name <app> [--yes] | --help
// The [VAL] (unverified live) steps are listed at the top of scripts/lib/deploy-self.ts.
import { runDeploySelf } from "./lib/deploy-self";

runDeploySelf(process.argv.slice(2), {
  env: process.env,
  io: { out: (l) => console.log(l), err: (l) => console.error(l) },
}).then((code) => {
  process.exitCode = code;
});

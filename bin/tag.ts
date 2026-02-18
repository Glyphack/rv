import { $ } from "bun";
import { exit } from "process";
import { parseArgs } from "util";

const { values, positionals } = parseArgs({
  args: Bun.argv,
  options: {
    version: {
      type: "string",
    },
  },
  strict: true,
  allowPositionals: true,
});

const v = values.version;

if (v === undefined) {
  console.log("version must be specified");
  exit(1);
}

await $`git tag -a ${v} -m 0.1.1`;
await $`git push --tags`;

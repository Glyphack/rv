import { $ } from "bun";
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

await $`git tag -d ${v}`;
await $`git push origin --delete ${v}`;
await $`git tag -a ${v} -m ${v}`;
await $`git push --tags`;

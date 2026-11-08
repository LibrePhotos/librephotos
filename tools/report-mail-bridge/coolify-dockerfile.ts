// Prints the Dockerfile with this directory's files written into it, for
// Coolify's Dockerfile-only applications (no Git checkout to copy from):
//   bun run coolify-dockerfile.ts > Dockerfile.coolify

const FILES = ["package.json", "bun.lock", "tsconfig.json", "src/*.ts", "test/*.ts", "test/fixtures/*.json"];
const END = "REPORT_BRIDGE_END_OF_FILE";

async function embedded(pattern: string): Promise<string[]> {
  const found = await Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: import.meta.dir }));
  const copies: string[] = [];
  for (const path of found.map((name) => name.replaceAll("\\", "/")).sort()) {
    const text = await Bun.file(`${import.meta.dir}/${path}`).text();
    if (text.includes(END)) throw new Error(`${path} contains the heredoc delimiter`);
    if (/^FROM /m.test(text)) throw new Error(`${path} has a line Coolify would read as FROM`);
    copies.push(`COPY <<'${END}' /app/${path}\n${text.replace(/\n?$/, "\n")}${END}`);
  }
  return copies;
}

const dockerfile = await Bun.file(`${import.meta.dir}/Dockerfile`).text();
if (!dockerfile.includes("\nCOPY . .\n")) throw new Error("Dockerfile has no 'COPY . .' line");
const copies = (await Promise.all(FILES.map(embedded))).flat();
// A function, so "$" patterns in the files are not read as replacement patterns.
process.stdout.write(dockerfile.replace("\nCOPY . .\n", () => `\n${copies.join("\n")}\n`));

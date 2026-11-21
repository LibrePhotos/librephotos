import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

const PRODUCT = "LibrePhotos Viewer";
const EXE_NAME = "librephotos-viewer.exe";
const IMAGE_PROG_ID = "LibrePhotosViewer.Image";
const STARTUP_TIMEOUT_MS = 90_000;
const UNINSTALL_TIMEOUT_MS = 90_000;

const SCOPES = {
  user: {
    hive: "HKCU",
    flag: "/CurrentUser",
    folder: () => process.env.LOCALAPPDATA,
    env: { __COMPAT_LAYER: "RunAsInvoker" },
  },
  machine: {
    hive: "HKLM",
    flag: "/AllUsers",
    folder: () => process.env.ProgramW6432 ?? process.env.ProgramFiles,
    env: {},
  },
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { scope: { type: "string", default: "user" } },
});
const [installerArg, pictureArg] = positionals;
const scope = SCOPES[values.scope];
if (!installerArg || !pictureArg || !scope) {
  console.error("usage: node smoke-installer.mjs [--scope user|machine] <setup.exe> <picture>");
  process.exit(2);
}
const installer = resolve(installerArg);
const picture = resolve(pictureArg);
const programFolder = scope.folder();
if (!programFolder) fail(`no program folder for the ${values.scope} scope`);
const installDir = join(programFolder, PRODUCT);
const exe = join(installDir, EXE_NAME);
const uninstaller = join(installDir, "uninstall.exe");
const classes = `${scope.hive}\\Software\\Classes`;

const diagnostics = [];

function fail(message) {
  console.error(`smoke test failed: ${message}`);
  for (const report of diagnostics) console.error(report());
  process.exit(1);
}

function processList(image) {
  const listed = spawnSync("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/FO", "CSV", "/NH"], { encoding: "utf8" });
  return listed.stdout.trim() || `no ${image} process`;
}

function windowTitle(pid) {
  const asked = spawnSync("powershell", ["-NoProfile", "-Command", `(Get-Process -Id ${pid}).MainWindowTitle`], {
    encoding: "utf8",
  });
  return asked.stdout.trim();
}

function step(message) {
  console.log(`- ${message}`);
}

function registryHas(key, value) {
  const args = value === undefined ? ["query", key] : ["query", key, "/v", value];
  return spawnSync("reg", args, { stdio: "ignore" }).status === 0;
}

function defaultClass(extension) {
  const asked = spawnSync("reg", ["query", `${classes}\\${extension}`, "/ve"], { encoding: "utf8" });
  if (asked.status !== 0) return "(none)";
  const line = asked.stdout.split(/\r?\n/).find((text) => text.includes("REG_SZ"));
  return line ? line.split("REG_SZ")[1].trim() || "(empty)" : "(none)";
}

function expectRegistry(key, value, why) {
  if (!registryHas(key, value)) fail(`${key}${value === undefined ? "" : ` ${value}`} is missing: ${why}`);
}

async function waitFor(what, timeoutMs, probe) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe().catch(() => undefined);
    if (value) return value;
    await sleep(1000);
  }
  return fail(`timed out waiting for ${what}`);
}

const jpgClassBefore = defaultClass(".jpg");
step(`installing ${basename(installer)} (${values.scope}, ${installDir}); .jpg class is ${jpgClassBefore}`);
function runSetup(program) {
  const run = spawnSync(program, ["/S", scope.flag], { stdio: "inherit", env: { ...process.env, ...scope.env } });
  if (run.status !== 0) fail(`${basename(program)} exited with ${run.status}${run.error ? ` (${run.error.message})` : ""}`);
}

runSetup(installer);
if (!existsSync(exe)) fail(`${exe} is missing after the install`);
expectRegistry(`${scope.hive}\\Software\\RegisteredApplications`, PRODUCT, "Default apps has no page for the app");
expectRegistry(`${scope.hive}\\Software\\${PRODUCT}\\Capabilities\\FileAssociations`, ".jpg", "no capability for .jpg");
expectRegistry(`${classes}\\${IMAGE_PROG_ID}\\shell\\open\\command`, undefined, "the ProgID cannot open pictures");
expectRegistry(`${classes}\\.jpg\\OpenWithProgids`, IMAGE_PROG_ID, "Open with does not offer the app for .jpg");
expectRegistry(`${classes}\\Applications\\${EXE_NAME}`, "FriendlyAppName", "Open with has no name for the app");
expectRegistry(`${classes}\\Applications\\${EXE_NAME}\\SupportedTypes`, ".jpg", "the app does not list .jpg");
expectRegistry(`${scope.hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${EXE_NAME}`, undefined, "no App Paths entry");
const jpgClassInstalled = defaultClass(".jpg");
if (jpgClassInstalled !== jpgClassBefore) {
  fail(`the installer changed the .jpg class from ${jpgClassBefore} to ${jpgClassInstalled}; the user picks the default`);
}
step("installed and offered for pictures without taking over a default");

let appOutput = "";
let appExit = "still running";
const app = spawn(exe, [picture], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    LPVIEW_DATA_DIR: mkdtempSync(join(tmpdir(), "lpview-smoke-data-")),
    LPVIEW_KEYRING_SERVICE: "lpview-smoke",
    LPVIEW_MULTI_INSTANCE: "1",
    WEBVIEW2_USER_DATA_FOLDER: mkdtempSync(join(tmpdir(), "lpview-smoke-profile-")),
  },
});
app.stdout.on("data", (chunk) => (appOutput += chunk));
app.stderr.on("data", (chunk) => (appOutput += chunk));
app.on("exit", (code, signal) => (appExit = `exited with ${code ?? signal}`));
diagnostics.push(
  () => `app: ${appExit}`,
  () => `window title: ${JSON.stringify(windowTitle(app.pid))}`,
  () => `app output:\n${appOutput.slice(-4000) || "(none)"}`,
  () => `processes:\n${processList(EXE_NAME)}\n${processList("msedgewebview2.exe")}`
);
step(`started the installed app on ${basename(picture)} (pid ${app.pid})`);
const expectedTitle = `${basename(picture)} - ${PRODUCT}`;
try {
  await waitFor(`the window title "${expectedTitle}"`, STARTUP_TIMEOUT_MS, async () => windowTitle(app.pid) === expectedTitle);
  step(`the viewer opened the picture: "${expectedTitle}"`);
} finally {
  spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
}

await sleep(2000);
step("uninstalling");
runSetup(uninstaller);
await waitFor("the uninstaller to remove the app", UNINSTALL_TIMEOUT_MS, async () => !existsSync(exe));
await waitFor(
  "the uninstaller to remove the app from RegisteredApplications",
  UNINSTALL_TIMEOUT_MS,
  async () => !registryHas(`${scope.hive}\\Software\\RegisteredApplications`, PRODUCT)
);
if (registryHas(`${classes}\\.jpg\\OpenWithProgids`, IMAGE_PROG_ID)) fail("Open with still offers the removed app");
if (registryHas(`${classes}\\Applications\\${EXE_NAME}`)) fail("the Applications entry survived the uninstall");
const jpgClassAfter = defaultClass(".jpg");
if (jpgClassAfter !== jpgClassBefore) fail(`the uninstaller left the .jpg class at ${jpgClassAfter}, not ${jpgClassBefore}`);
step("uninstalled cleanly");

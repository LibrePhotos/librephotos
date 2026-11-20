import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PRODUCT = "LibrePhotos Viewer";
const IMAGE_PROG_ID = "LibrePhotosViewer.Image";
const STARTUP_TIMEOUT_MS = 90_000;
const UNINSTALL_TIMEOUT_MS = 90_000;

const [installerArg, pictureArg] = process.argv.slice(2);
if (!installerArg || !pictureArg) {
  console.error("usage: node smoke-installer.mjs <setup.exe> <picture>");
  process.exit(2);
}
const installer = resolve(installerArg);
const picture = resolve(pictureArg);
const localAppData = process.env.LOCALAPPDATA;
if (!localAppData) fail("LOCALAPPDATA is not set");
const installDir = join(localAppData, PRODUCT);
const exe = join(installDir, "librephotos-viewer.exe");
const uninstaller = join(installDir, "uninstall.exe");

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

async function waitFor(what, timeoutMs, probe) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe().catch(() => undefined);
    if (value) return value;
    await sleep(1000);
  }
  return fail(`timed out waiting for ${what}`);
}

step(`installing ${basename(installer)}`);
const install = spawnSync(installer, ["/S"], { stdio: "inherit" });
if (install.status !== 0) fail(`the installer exited with ${install.status}`);
if (!existsSync(exe)) fail(`${exe} is missing after the install`);
if (!registryHas("HKCU\\Software\\RegisteredApplications", PRODUCT)) {
  fail("the app is not registered under RegisteredApplications, so Default apps has no page for it");
}
if (!registryHas(`HKCU\\Software\\${PRODUCT}\\Capabilities\\FileAssociations`, ".jpg")) {
  fail("Capabilities\\FileAssociations has no .jpg");
}
if (!registryHas(`HKCU\\Software\\Classes\\${IMAGE_PROG_ID}\\shell\\open\\command`)) {
  fail(`the ${IMAGE_PROG_ID} ProgID has no open command`);
}
step("installed and registered for pictures");

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
  () => `processes:\n${processList("librephotos-viewer.exe")}\n${processList("msedgewebview2.exe")}`
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
const uninstall = spawnSync(uninstaller, ["/S"], { stdio: "inherit" });
if (uninstall.status !== 0) fail(`the uninstaller exited with ${uninstall.status}`);
await waitFor("the uninstaller to remove the app", UNINSTALL_TIMEOUT_MS, async () => !existsSync(exe));
await waitFor(
  "the uninstaller to remove the app from RegisteredApplications",
  UNINSTALL_TIMEOUT_MS,
  async () => !registryHas("HKCU\\Software\\RegisteredApplications", PRODUCT)
);
step("uninstalled cleanly");

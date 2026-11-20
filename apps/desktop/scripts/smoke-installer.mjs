import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PRODUCT = "LibrePhotos Viewer";
const IMAGE_PROG_ID = "LibrePhotosViewer.Image";
const DEBUG_PORT = 9333;
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

function fail(message) {
  console.error(`smoke test failed: ${message}`);
  process.exit(1);
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

async function evaluate(webSocketUrl, expression) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((done, failed) => {
    socket.onopen = done;
    socket.onerror = failed;
  });
  const answer = await new Promise((done) => {
    socket.onmessage = (event) => done(JSON.parse(String(event.data)));
    socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
  });
  socket.close();
  return answer?.result?.result?.value;
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

const dataDir = mkdtempSync(join(tmpdir(), "lpview-smoke-data-"));
const profileDir = mkdtempSync(join(tmpdir(), "lpview-smoke-profile-"));
const app = spawn(exe, [picture], {
  stdio: "ignore",
  env: {
    ...process.env,
    LPVIEW_DATA_DIR: dataDir,
    LPVIEW_KEYRING_SERVICE: "lpview-smoke",
    LPVIEW_MULTI_INSTANCE: "1",
    WEBVIEW2_USER_DATA_FOLDER: profileDir,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${DEBUG_PORT}`,
  },
});
step(`started the installed app on ${basename(picture)} (pid ${app.pid})`);
try {
  const page = await waitFor("the app's page", STARTUP_TIMEOUT_MS, async () => {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    return targets.find((target) => target.type === "page");
  });
  await waitFor(`the viewer to show ${basename(picture)}`, STARTUP_TIMEOUT_MS, () =>
    evaluate(page.webSocketDebuggerUrl, `document.body.innerText.includes(${JSON.stringify(basename(picture))})`)
  );
  const decoded = await waitFor("the picture to decode", STARTUP_TIMEOUT_MS, () =>
    evaluate(
      page.webSocketDebuggerUrl,
      "[...document.querySelectorAll('img')].some((img) => img.complete && img.naturalWidth > 0)"
    )
  );
  if (!decoded) fail("no picture decoded");
  step("the viewer opened and decoded the picture");
} finally {
  spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { stdio: "ignore" });
}

await sleep(2000);
step("uninstalling");
const uninstall = spawnSync(uninstaller, ["/S"], { stdio: "inherit" });
if (uninstall.status !== 0) fail(`the uninstaller exited with ${uninstall.status}`);
await waitFor("the uninstaller to remove the app", UNINSTALL_TIMEOUT_MS, async () => !existsSync(exe));
if (registryHas("HKCU\\Software\\RegisteredApplications", PRODUCT)) {
  fail("RegisteredApplications still lists the app after the uninstall");
}
step("uninstalled cleanly");

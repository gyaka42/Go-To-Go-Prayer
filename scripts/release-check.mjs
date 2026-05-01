import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const warnings = [];

function readJson(relativePath) {
  const filePath = path.join(root, relativePath);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ok(condition, message) {
  if (condition) {
    console.log(`ok - ${message}`);
    return;
  }
  failures.push(message);
  console.error(`fail - ${message}`);
}

function warn(condition, message) {
  if (condition) {
    return;
  }
  warnings.push(message);
  console.warn(`warn - ${message}`);
}

function containsNonEnglishPermissionText(value) {
  const normalized = String(value || "").toLowerCase();
  return /\b(locatie|konum|bildirim|gebed|gebedstijden|namaz|kible|camiler|hatirlatma|herinner)\b/.test(normalized);
}

const appJson = readJson("app.json");
const packageJson = readJson("package.json");
const expo = appJson.expo || {};
const ios = expo.ios || {};
const infoPlist = ios.infoPlist || {};

const appVersion = String(expo.version || "");
const packageVersion = String(packageJson.version || "");
const buildNumber = String(ios.buildNumber || "");

ok(/^\d+\.\d+\.\d+$/.test(appVersion), `app.json expo.version is semantic (${appVersion || "missing"})`);
ok(packageVersion === appVersion, `package.json version matches app.json (${packageVersion} === ${appVersion})`);
ok(/^\d+$/.test(buildNumber) && Number(buildNumber) > 0, `iOS buildNumber is numeric (${buildNumber || "missing"})`);
ok(Boolean(ios.bundleIdentifier), "iOS bundleIdentifier is configured");
ok(infoPlist.ITSAppUsesNonExemptEncryption === false, "ITSAppUsesNonExemptEncryption is false");

const locationText = infoPlist.NSLocationWhenInUseUsageDescription;
const notificationText = infoPlist.NSUserNotificationsUsageDescription;

ok(typeof locationText === "string" && locationText.length >= 30, "location permission text is present");
ok(typeof notificationText === "string" && notificationText.length >= 20, "notification permission text is present");
ok(!containsNonEnglishPermissionText(locationText), "location permission text is English-only");
ok(!containsNonEnglishPermissionText(notificationText), "notification permission text is English-only");

const projectPath = path.join(root, "ios/GoToGoPrayer.xcodeproj/project.pbxproj");
if (fs.existsSync(projectPath)) {
  const project = fs.readFileSync(projectPath, "utf8");
  ok(project.includes(`MARKETING_VERSION = ${appVersion};`), "Xcode MARKETING_VERSION matches app.json version");
  ok(project.includes(`CURRENT_PROJECT_VERSION = ${buildNumber};`), "Xcode CURRENT_PROJECT_VERSION matches app.json buildNumber");
} else {
  warn(false, "iOS project file not found; run expo prebuild/run:ios before final archive checks");
}

if (warnings.length > 0) {
  console.warn(`\n${warnings.length} warning(s).`);
}

if (failures.length > 0) {
  console.error(`\nRelease check failed with ${failures.length} issue(s).`);
  process.exit(1);
}

console.log("\nRelease check passed.");

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

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

function translationEntriesByLanguage(relativePath) {
  const sourceText = fs.readFileSync(path.join(root, relativePath), "utf8");
  const sourceFile = ts.createSourceFile(relativePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let translationsObject = null;

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === "translations" &&
        declaration.initializer &&
        ts.isObjectLiteralExpression(declaration.initializer)
      ) {
        translationsObject = declaration.initializer;
      }
    }
  }

  if (!translationsObject) return new Map();
  const result = new Map();
  for (const languageProperty of translationsObject.properties) {
    if (!ts.isPropertyAssignment(languageProperty) || !ts.isObjectLiteralExpression(languageProperty.initializer)) {
      continue;
    }
    const language = propertyName(languageProperty.name);
    if (!language) continue;
    const entries = new Map();
    for (const entry of languageProperty.initializer.properties) {
      if (!ts.isPropertyAssignment(entry)) continue;
      const key = propertyName(entry.name);
      const value = stringValue(entry.initializer);
      if (key && value !== null) entries.set(key, value);
    }
    result.set(language, entries);
  }
  return result;
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return null;
}

function stringValue(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
}

function placeholders(value) {
  return [...String(value).matchAll(/{{\s*([A-Za-z0-9_]+)\s*}}/g)].map((match) => match[1]).sort();
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

const translationsByLanguage = translationEntriesByLanguage("src/i18n/translations.ts");
const faithKeys = [...(translationsByLanguage.get("en")?.keys() || [])]
  .filter((key) => key.startsWith("faith.") || key.startsWith("menu.faith."))
  .sort();
ok(faithKeys.length >= 40, `Faith Assistant has a complete English key set (${faithKeys.length} keys)`);

for (const language of ["nl", "tr"]) {
  const entries = translationsByLanguage.get(language) || new Map();
  const missing = faithKeys.filter((key) => !entries.has(key));
  const blank = faithKeys.filter((key) => String(entries.get(key) || "").trim().length === 0);
  const placeholderMismatch = faithKeys.filter((key) => {
    const englishParams = placeholders(translationsByLanguage.get("en")?.get(key));
    const localizedParams = placeholders(entries.get(key));
    return englishParams.join(",") !== localizedParams.join(",");
  });
  ok(missing.length === 0, `Faith Assistant ${language} translations contain every English key`);
  ok(blank.length === 0, `Faith Assistant ${language} translations are non-empty`);
  ok(placeholderMismatch.length === 0, `Faith Assistant ${language} placeholders match English`);
}

if (warnings.length > 0) {
  console.warn(`\n${warnings.length} warning(s).`);
}

if (failures.length > 0) {
  console.error(`\nRelease check failed with ${failures.length} issue(s).`);
  process.exit(1);
}

console.log("\nRelease check passed.");

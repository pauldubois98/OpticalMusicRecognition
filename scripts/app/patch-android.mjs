// Our changes to the Android project Capacitor generates (`npx cap add
// android`), applied once after it (running it again changes nothing):
// - the camera permission (for "Use camera", getUserMedia in the WebView),
//   the camera optional (devices without one can still install the app);
// - the version, from package.json (versionCode major·10000 + minor·100 +
//   patch: it must grow with every upload to Google Play);
// - release signing from android/keystore.properties (not committed; see
//   docs/ANDROID.md), when that file exists.
// Usage: node scripts/app/patch-android.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const path = (p) => new URL(p, root);

/** Apply `edit` to a file (text in, text out), writing it only if changed. */
function patch(file, edit) {
	if (!existsSync(path(file))) {
		throw new Error(`${file} not found: run \`npx cap add android\` first`);
	}
	const before = readFileSync(path(file), "utf8");
	const after = edit(before);
	if (after !== before) {
		writeFileSync(path(file), after);
		console.log(`patched ${file}`);
	}
}

patch("android/app/src/main/AndroidManifest.xml", (xml) =>
	xml.includes("android.permission.CAMERA")
		? xml
		: xml.replace(
				/(<uses-permission android:name="android.permission.INTERNET" \/>)/,
				`$1
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />`,
			),
);

const { version } = JSON.parse(readFileSync(path("package.json"), "utf8"));
const [major, minor, patchLevel] = version.split(".").map(Number);
const versionCode = major * 10000 + minor * 100 + patchLevel;

const SIGNING_PROPS = `// release signing: android/keystore.properties (not committed)
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {`;

const SIGNING_CONFIG = `    signingConfigs {
        release {
            if (keystorePropertiesFile.exists()) {
                storeFile file(keystoreProperties["storeFile"])
                storePassword keystoreProperties["storePassword"]
                keyAlias keystoreProperties["keyAlias"]
                keyPassword keystoreProperties["keyPassword"]
            }
        }
    }
    buildTypes {
        release {
            if (keystorePropertiesFile.exists()) {
                signingConfig signingConfigs.release
            }`;

patch("android/app/build.gradle", (gradle) => {
	let g = gradle
		.replace(/versionCode \d+/, `versionCode ${versionCode}`)
		.replace(/versionName "[^"]*"/, `versionName "${version}"`);
	if (!g.includes("keystore.properties")) {
		g = g
			.replace(/^android \{/m, SIGNING_PROPS)
			.replace(/ {4}buildTypes \{\n {8}release \{/, SIGNING_CONFIG);
	}
	return g;
});

patch("android/.gitignore", (text) =>
	text.includes("keystore.properties")
		? text
		: `${text.trimEnd()}\n\n# release signing (passwords): never committed\nkeystore.properties\n*.jks\n*.keystore\n`,
);

import fs from "node:fs";
import path from "node:path";
import fetch from "node-fetch";

// ---------------------------------------------------------------------------
// Apple default / built-in apps
// ---------------------------------------------------------------------------

const APPLE_APPS: { bundleId: string; name: string }[] = [
	{ bundleId: "com.apple.AppStore", name: "App Store" },
	{ bundleId: "com.apple.store.Jolly", name: "Apple Store" },
	{ bundleId: "com.apple.calculator", name: "Calculator" },
	{ bundleId: "com.apple.mobilecal", name: "Calendar" },
	{ bundleId: "com.apple.camera", name: "Camera" },
	{ bundleId: "com.apple.mobiletimer", name: "Clock" },
	{ bundleId: "com.apple.clips", name: "Clips" },
	{ bundleId: "com.apple.compass", name: "Compass" },
	{ bundleId: "com.apple.MobileAddressBook", name: "Contacts" },
	{ bundleId: "com.apple.facetime", name: "FaceTime" },
	{ bundleId: "com.apple.DocumentsApp", name: "Files" },
	{ bundleId: "com.apple.mobileme.fmf1", name: "Find Friends" },
	{ bundleId: "com.apple.mobileme.fmip1", name: "Find iPhone" },
	{ bundleId: "com.apple.games", name: "Games" },
	{ bundleId: "com.apple.gamecenter", name: "Game Center" },
	{ bundleId: "com.apple.mobilegarageband", name: "GarageBand" },
	{ bundleId: "com.apple.Health", name: "Health" },
	{ bundleId: "com.apple.Home", name: "Home" },
	{ bundleId: "com.apple.iBooks", name: "Books" },
	{ bundleId: "com.apple.iMovie", name: "iMovie" },
	{ bundleId: "com.apple.itunesconnect.mobile", name: "iTunes Connect" },
	{ bundleId: "com.apple.MobileStore", name: "iTunes Store" },
	{ bundleId: "com.apple.itunesu", name: "iTunes U" },
	{ bundleId: "com.apple.Keynote", name: "Keynote" },
	{ bundleId: "com.apple.mobilemail", name: "Mail" },
	{ bundleId: "com.apple.Maps", name: "Maps" },
	{ bundleId: "com.apple.measure", name: "Measure" },
	{ bundleId: "com.apple.MobileSMS", name: "Messages" },
	{ bundleId: "com.apple.Music", name: "Music" },
	{ bundleId: "com.apple.news", name: "News" },
	{ bundleId: "com.apple.mobilenotes", name: "Notes" },
	{ bundleId: "com.apple.Numbers", name: "Numbers" },
	{ bundleId: "com.apple.Pages", name: "Pages" },
	{ bundleId: "com.apple.Passwords", name: "Passwords" },
	{ bundleId: "com.apple.mobilephone", name: "Phone" },
	{ bundleId: "com.apple.Photo-Booth", name: "Photo Booth" },
	{ bundleId: "com.apple.mobileslideshow", name: "Photos" },
	{ bundleId: "com.apple.podcasts", name: "Podcasts" },
	{ bundleId: "com.apple.preview", name: "Preview" },
	{ bundleId: "com.apple.reminders", name: "Reminders" },
	{ bundleId: "com.apple.mobilesafari", name: "Safari" },
	{ bundleId: "com.apple.Preferences", name: "Settings" },
	{ bundleId: "com.apple.shortcuts", name: "Shortcuts" },
	{ bundleId: "com.apple.SiriViewService", name: "Siri" },
	{ bundleId: "com.apple.stocks", name: "Stocks" },
	{ bundleId: "com.apple.tips", name: "Tips" },
	{ bundleId: "com.apple.tv", name: "TV" },
	{ bundleId: "com.apple.videos", name: "Videos" },
	{ bundleId: "com.apple.VoiceMemos", name: "Voice Memos" },
	{ bundleId: "com.apple.Passbook", name: "Wallet" },
	{ bundleId: "com.apple.Bridge", name: "Watch" },
	{ bundleId: "com.apple.weather", name: "Weather" },
	{ bundleId: "com.apple.barcodesupport.qrcode", name: "QR Code Reader" },
	// extras
	{ bundleId: "com.apple.screentime", name: "Screen Time" },
	{ bundleId: "com.apple.findmy", name: "Find My" },
	{ bundleId: "com.apple.translate", name: "Translate" },
	{ bundleId: "com.apple.freeform", name: "Freeform" },
	{ bundleId: "com.apple.journal", name: "Journal" },
	{ bundleId: "com.apple.magnifier", name: "Magnifier" },
];

// ---------------------------------------------------------------------------
// Types (mirrors EnrichedApp in index.ts)
// ---------------------------------------------------------------------------

interface AppEntry {
	id: string;
	name: string;
	bundleId: string;
	artworkUrl: string;
	type?: string;
	category?: string;
}

interface ItunesLookupResult {
	trackId: number;
	bundleId: string;
	artworkUrl100: string;
	trackName: string;
}

interface ItunesLookupResponse {
	resultCount: number;
	results: ItunesLookupResult[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function wait(sec: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, sec * 1000));
}

/**
 * Looks up an app by bundle ID via the iTunes Search API.
 * Returns null for pure system apps that are not on the App Store.
 */
async function lookupByBundleId(bundleId: string): Promise<{
	id: string;
	artworkUrl: string;
} | null> {
	const url = `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}`;

	try {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);

		const data = (await res.json()) as ItunesLookupResponse;

		if (data.resultCount === 0 || !data.results[0]) return null;

		const result = data.results[0];
		return {
			id: String(result.trackId),
			artworkUrl: result.artworkUrl100 ?? "",
		};
	} catch (err) {
		console.log(`  ⚠️  Lookup failed for ${bundleId}: ${(err as Error).message}`);
		return null;
	}
}

async function downloadIcon(bundleId: string, artworkUrl: string): Promise<void> {
	const dir = "./icons";
	if (!fs.existsSync(dir)) fs.mkdirSync(dir);

	const ext = artworkUrl.includes(".png") ? "png" : "jpg";
	const filePath = path.join(dir, `${bundleId}.${ext}`);

	if (fs.existsSync(filePath)) {
		console.log(`  ⏭️  Already have icon for ${bundleId}`);
		return;
	}

	const res = await fetch(artworkUrl);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);

	const buffer = await res.arrayBuffer();
	fs.writeFileSync(filePath, Buffer.from(buffer));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const jsonPath = "top-apps.json";

	if (!fs.existsSync(jsonPath)) {
		console.error(`❌ ${jsonPath} not found. Run "pnpm start" first.`);
		process.exit(1);
	}

	const existing: AppEntry[] = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
	const existingBundleIds = new Set(existing.map((a) => a.bundleId));

	const toAdd = APPLE_APPS.filter((a) => !existingBundleIds.has(a.bundleId));

	console.log(`\n📱 ${APPLE_APPS.length} Apple apps defined`);
	console.log(`   ${APPLE_APPS.length - toAdd.length} already in top-apps.json`);
	console.log(`   ${toAdd.length} to add\n`);

	const newEntries: AppEntry[] = [];

	for (const [i, app] of toAdd.entries()) {
		console.log(`[${i + 1}/${toAdd.length}] ${app.name} (${app.bundleId})`);

		const lookup = await lookupByBundleId(app.bundleId);

		const entry: AppEntry = {
			id: lookup?.id ?? app.bundleId, // fall back to bundleId for system apps
			name: app.name,
			bundleId: app.bundleId,
			artworkUrl: lookup?.artworkUrl ?? "",
		};

		if (lookup) {
			console.log(`  ✅ Found on App Store  id=${entry.id}`);
		} else {
			console.log(`  ℹ️  System app — no App Store listing`);
		}

		newEntries.push(entry);
		await wait(0.5); // be polite to iTunes API
	}

	// Append and save
	const updated = [...existing, ...newEntries];
	fs.writeFileSync(jsonPath, JSON.stringify(updated, null, 2), "utf-8");
	console.log(`\n💾 Saved ${updated.length} total entries to ${jsonPath}`);

	// Download icons for entries that have artwork
	const withArtwork = newEntries.filter((a) => a.artworkUrl);
	console.log(`\n⬇️  Downloading icons for ${withArtwork.length} apps…\n`);

	for (const [i, app] of withArtwork.entries()) {
		try {
			console.log(`⬇️  [${i + 1}/${withArtwork.length}] ${app.bundleId}`);
			await downloadIcon(app.bundleId, app.artworkUrl);
			await wait(0.3);
		} catch (err) {
			console.log(`  ❌ Icon failed: ${(err as Error).message}`);
		}
	}

	const skipped = newEntries.length - withArtwork.length;
	if (skipped > 0) {
		console.log(
			`\nℹ️  ${skipped} system app(s) have no App Store artwork and were skipped.`,
		);
	}

	console.log("\n✅ Done.");
}

main().catch(console.error);

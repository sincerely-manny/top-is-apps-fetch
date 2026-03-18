import fs from "node:fs";
import path from "node:path";
import fetch from "node-fetch";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COUNTRIES = [
	"us",
	"gb",
	"ca",
	"au",
	"de",
	"fr",
	"es",
	"it",
	"jp",
	"kr",
	"ru",
] as const;

type Country = (typeof COUNTRIES)[number];

const TYPES = ["free", "paid"] as const;

type AppType = (typeof TYPES)[number];

const APPFIGURES_CATS = {
	apps: "99999915",
	games: "6014",
} as const;

type AppfiguresCategory = keyof typeof APPFIGURES_CATS;

const LIMIT = 100;

// ---------------------------------------------------------------------------
// Shared app model
// ---------------------------------------------------------------------------

interface App {
	id: string;
	name: string;
	/** Set for App Store RSS apps (free / paid). Not available from Appfigures. */
	type?: AppType;
	/** Set for Appfigures apps (apps / games). */
	category?: AppfiguresCategory;
}

interface EnrichedApp extends App {
	bundleId: string;
	/** artworkUrl100 resolved via iTunes lookup */
	artworkUrl: string;
}

// ---------------------------------------------------------------------------
// Apple RSS Feed types
// ---------------------------------------------------------------------------

interface AppleFeedResult {
	id: string;
	name: string;
}

interface AppleFeedResponse {
	feed: {
		results: AppleFeedResult[];
	};
}

// ---------------------------------------------------------------------------
// iTunes Lookup types
// ---------------------------------------------------------------------------

interface ItunesLookupResult {
	trackId: number;
	bundleId: string;
	artworkUrl100: string;
}

interface ItunesLookupResponse {
	results?: ItunesLookupResult[];
}

// ---------------------------------------------------------------------------
// Appfigures types  (shape based on /ranks/snapshots response)
// ---------------------------------------------------------------------------

interface AppfiguresEntry {
	id: number;
	name: string;
	vendor_identifier: string;
}

interface AppfiguresBlock {
	entries: AppfiguresEntry[];
}

interface AppfiguresResponse {
	results?: AppfiguresBlock[];
}

interface FetchAppfiguresRanksParams {
	country?: string;
	category?: string;
	count?: number;
	start?: number;
}

interface FetchAppfiguresPagedParams {
	country?: string;
	category?: string;
	catName?: AppfiguresCategory;
	total?: number;
	step?: number;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

async function wait(sec: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, sec * 1000));
}

function dedupe(apps: App[]): App[] {
	const map = new Map<string, App>();

	for (const app of apps) {
		if (map.has(app.id)) continue;
		map.set(app.id, app);
	}

	return Array.from(map.values());
}

function chunk<T>(array: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < array.length; i += size) {
		chunks.push(array.slice(i, i + size));
	}
	return chunks;
}

// ---------------------------------------------------------------------------
// Apple App Store RSS feed
// ---------------------------------------------------------------------------

async function fetchFeed(type: AppType, country: Country): Promise<App[]> {
	const url = `https://rss.marketingtools.apple.com/api/v2/${country}/apps/top-${type}/${LIMIT}/apps.json`;

	const res = await fetch(url);
	if (!res.ok) {
		console.log(`Failed to fetch ${type}: ${res.status}, ${res.statusText}
      link: ${url}
      `);
		throw new Error(
			`Failed to fetch ${type}: ${res.status}, ${res.statusText}`,
		);
	}

	const data = (await res.json()) as AppleFeedResponse;

	return data.feed.results.map((app) => ({
		id: app.id,
		name: app.name,
		type,
	}));
}

// ---------------------------------------------------------------------------
// Appfigures ranks
// ---------------------------------------------------------------------------

async function fetchAppfiguresRanks({
	country = "US",
	category = "99999915",
	count = 50,
	start = 0,
}: FetchAppfiguresRanksParams = {}): Promise<App[]> {
	const url =
		`https://app.appfigures.com/_u/api/ranks/snapshots` +
		`?category=${category}&country=${country}&count=${count}&start=${start}` +
		`&fields=results,id,entries,name,vendor_identifier`;

	const res = await fetch(url, {
		headers: {
			"user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
			accept: "application/json",
		},
	});

	if (!res.ok) {
		throw new Error(`Appfigures failed: ${res.status} ${res.statusText}`);
	}

	const data = (await res.json()) as AppfiguresResponse;

	const apps: App[] = [];

	for (const block of data.results ?? []) {
		for (const entry of block.entries ?? []) {
			if (!entry.vendor_identifier) continue;

			apps.push({
				id: String(entry.vendor_identifier),
				name: entry.name,
			});
		}
	}

	return apps;
}

async function fetchAppfiguresPaged({
	country = "US",
	category = "99999915",
	catName = "apps" as AppfiguresCategory,
	total = 500,
	step = 50,
}: FetchAppfiguresPagedParams = {}): Promise<App[]> {
	const all: App[] = [];

	for (let start = 0; start < total; start += step) {
		console.log(
			`📊 Appfigures [${catName}] ${country} ${start} → ${start + step}`,
		);

		try {
			const page = await fetchAppfiguresRanks({
				country,
				category,
				count: step,
				start,
			});

			// Tag every entry with the Appfigures category
			for (const app of page) {
				all.push({ ...app, category: catName });
			}

			await wait(1);
		} catch (err) {
			console.log(
				`❌ Failed chunk (${country} ${catName} @${start}), skipping…`,
			);
		}
	}

	return all;
}

// ---------------------------------------------------------------------------
// iTunes lookup  –  bundle ID + artwork in one shot
// ---------------------------------------------------------------------------

async function lookupBundleIds(apps: App[]): Promise<EnrichedApp[]> {
	const results: EnrichedApp[] = [];
	const chunksArr = chunk(apps, 50);

	for (const [i, chunkApps] of chunksArr.entries()) {
		console.log(`🔍 iTunes lookup chunk ${i + 1}/${chunksArr.length}`);

		const ids = chunkApps.map((a) => a.id).join(",");
		const url = `https://itunes.apple.com/lookup?id=${ids}`;

		let data: ItunesLookupResponse;

		try {
			const res = await fetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			data = (await res.json()) as ItunesLookupResponse;
		} catch {
			console.log("Retrying lookup…");
			await wait(1.5);
			const res = await fetch(url);
			data = (await res.json()) as ItunesLookupResponse;
		}

		const infoMap = new Map<string, { bundleId: string; artworkUrl: string }>(
			(data.results ?? []).map((r) => [
				String(r.trackId),
				{ bundleId: r.bundleId, artworkUrl: r.artworkUrl100 },
			]),
		);

		for (const app of chunkApps) {
			const info = infoMap.get(app.id);

			if (!info?.bundleId) continue;

			results.push({
				...app,
				bundleId: info.bundleId,
				artworkUrl: info.artworkUrl,
			});
		}

		await wait(1);
	}

	return results;
}

// ---------------------------------------------------------------------------
// Icon downloader
// ---------------------------------------------------------------------------

async function downloadIcons(apps: EnrichedApp[]): Promise<void> {
	const dir = "./icons";

	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir);
	}

	for (const [i, app] of apps.entries()) {
		const { bundleId, artworkUrl } = app;

		if (!artworkUrl) continue;

		try {
			console.log(`⬇️  [${i + 1}/${apps.length}] ${bundleId}`);

			const res = await fetch(artworkUrl);
			if (!res.ok) throw new Error("Failed to download");

			const buffer = await res.arrayBuffer();
			const ext = artworkUrl.includes(".png") ? "png" : "jpg";
			const filePath = path.join(dir, `${bundleId}.${ext}`);

			fs.writeFileSync(filePath, Buffer.from(buffer));

			await wait(0.3);
		} catch {
			console.log(`❌ Icon failed for ${bundleId}`);
		}
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const combined: App[] = [];

	// 1. Apple App Store RSS (free + paid, all countries)
	for (const type of TYPES) {
		for (const country of COUNTRIES) {
			console.log(`⬇️  Fetching App Store [${type}] for ${country}…`);
			try {
				const apps = await fetchFeed(type, country);
				console.log(`✅ ${apps.length} apps`);
				combined.push(...apps);
			} catch (err) {
				console.log(`❌ Skipping ${type}/${country}`);
			}
			await wait(1);
		}
	}

	// 2. Appfigures (apps + games, all countries)
	for (const catName of Object.keys(APPFIGURES_CATS) as AppfiguresCategory[]) {
		for (const country of COUNTRIES) {
			const apps = await fetchAppfiguresPaged({
				country: country.toUpperCase(),
				category: APPFIGURES_CATS[catName],
				catName,
			});
			combined.push(...apps);
		}
	}

	// 3. Dedupe by App Store ID
	const deduped = dedupe(combined);
	console.log(`\nTotal after dedupe: ${deduped.length}`);

	// 4. Enrich: bundle ID + artwork via iTunes lookup
	const enriched = await lookupBundleIds(deduped);
	console.log(`Enriched: ${enriched.length}`);

	// 5. Persist
	fs.writeFileSync("top-apps.json", JSON.stringify(enriched, null, 2));
	console.log("💾 Saved to top-apps.json");

	// 6. Download icons
	await downloadIcons(enriched);
}

main().catch(console.error);

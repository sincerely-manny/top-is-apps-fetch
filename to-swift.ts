import fs from "node:fs";

interface AppEntry {
	bundleId: string;
	name: string;
}

function escapeSwiftString(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function toSwiftDict(apps: AppEntry[]): string {
	const lines = apps.map(({ bundleId, name }) => {
		const key = escapeSwiftString(bundleId);
		const val = escapeSwiftString(name);
		return `  "${key}": "${val}",`;
	});

	// trim trailing comma on the last entry
	if (lines.length > 0) {
		lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1);
	}

	return `let AppNames: [String: String] = [\n${lines.join("\n")}\n]\n`;
}

function main(): void {
	const inputPath = "top-apps.json";
	const outputPath = "AppNames.swift";

	if (!fs.existsSync(inputPath)) {
		console.error(`❌ ${inputPath} not found. Run "pnpm start" first.`);
		process.exit(1);
	}

	const raw = fs.readFileSync(inputPath, "utf-8");
	const apps = JSON.parse(raw) as AppEntry[];

	// Sort alphabetically by bundle ID for stable, readable output
	const sorted = [...apps].sort((a, b) => a.bundleId.localeCompare(b.bundleId));

	const swift = toSwiftDict(sorted);
	fs.writeFileSync(outputPath, swift, "utf-8");

	console.log(`✅ Wrote ${sorted.length} entries to ${outputPath}`);
}

main();

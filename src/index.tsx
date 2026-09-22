#!/usr/bin/env node

if (process.argv.includes("--mcp")) {
	const { runMcpServer } = await import("./mcp.js");
	await runMcpServer();
} else if (process.argv.includes("--help") || process.argv.includes("-h") || process.argv.slice(2).includes("help")) {
	const { HELP_TEXT } = await import("./command-parser.js");
	console.log(HELP_TEXT);
	process.exit(0);
} else {
	const [{ render }, React, { App }] = await Promise.all([
		import("ink"),
		import("react"),
		import("./tui.js"),
	]);
	render(React.createElement(App), { alternateScreen: true });
}

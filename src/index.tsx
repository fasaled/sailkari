#!/usr/bin/env node

if (process.argv.includes("--mcp")) {
	const { runMcpServer } = await import("./mcp.js");
	await runMcpServer();
} else {
	const [{ render }, React, { App }] = await Promise.all([
		import("ink"),
		import("react"),
		import("./tui.js"),
	]);
	render(React.createElement(App), { alternateScreen: true });
}

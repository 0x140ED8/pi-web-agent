import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const TARGET = process.env.PI_AGENT_SERVER_URL ?? "http://127.0.0.1:8787";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	server: {
		host: "127.0.0.1",
		port: 5173,
		proxy: {
			"/api": {
				target: TARGET,
				changeOrigin: true,
				// SSE: disable response buffering so deltas arrive immediately.
				configure: (proxy) => {
					proxy.on("proxyRes", (proxyRes) => {
						proxyRes.headers["cache-control"] = "no-store";
					});
				},
			},
		},
	},
});

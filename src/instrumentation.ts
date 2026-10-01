// Next calls this once per server start; the pipeline runs here instead of on a button
export async function register() {
	if (process.env.NEXT_RUNTIME === "nodejs") (await import("./lib/worker")).startWorker();
}

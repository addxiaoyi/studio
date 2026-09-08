import type { FastifyInstance } from "fastify";

const metricNames = new Set(["LCP", "CLS", "FCP", "TTFB", "INP", "FID"]);
const ratings = new Set(["good", "needs-improvement", "poor"]);

export async function registerMetricsRoutes(app: FastifyInstance) {
  app.post<{ Body: Record<string, unknown> }>("/api/metrics", async (request, reply) => {
    const metric = request.body;
    const isValid =
      typeof metric?.name === "string" &&
      metricNames.has(metric.name) &&
      typeof metric.value === "number" &&
      Number.isFinite(metric.value) &&
      typeof metric.rating === "string" &&
      ratings.has(metric.rating) &&
      typeof metric.url === "string";

    if (!isValid) {
      return reply.code(400).send({ error: { code: "invalid_metric", message: "Invalid performance metric" } });
    }

    request.log.info({
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      url: metric.url,
    }, "web vital");
    return reply.code(204).send();
  });
}

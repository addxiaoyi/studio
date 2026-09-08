// @lighthouse — auto-score public pages on every PR.
// Thresholds: enforce >= 90 on every category except SEO (95+).
module.exports = {
  ci: {
    collect: {
      // Serve the static export + assert correct base path.
      staticDistDir: "./out",
      url: [
        "http://localhost/index.html",
        "http://localhost/pricing.html",
        "http://localhost/security.html",
      ],
      numberOfRuns: 3,
      settings: {
        skipAudits: ["uses-http2", "is-on-https"], // local file:// testing
        preset: "desktop",
      },
    },
    assert: {
      assertions: {
        "categories:performance": ["error", { minScore: 0.9 }],
        "categories:accessibility": ["error", { minScore: 0.95 }],
        "categories:best-practices": ["error", { minScore: 0.9 }],
        "categories:seo": ["error", { minScore: 0.9 }],

        // Specific audits we care about
        "first-contentful-paint": ["warn", { maxNumericValue: 1800 }],
        "largest-contentful-paint": ["error", { maxNumericValue: 2500 }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }],
        "total-blocking-time": ["warn", { maxNumericValue: 300 }],
      },
    },
    upload: {
      // Local only — comment out `target` for production to send to LHCI server
      target: "temporary-public-storage",
    },
  },
};

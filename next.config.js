/** @type {import('next').NextConfig} */
const nextConfig = {
    // Enable instrumentation hook
    experimental: {
        instrumentationHook: true,
    },

    // Disable static optimization for pages that use SSE
    // This ensures they're always server-rendered
    // (SSE requires a running server)

    // Logging for debugging
    logging: {
        fetches: {
            fullUrl: true,
        },
    },
};

module.exports = nextConfig;

/**
 * Independent customer portal build configuration.
 * @package @vxture/customer-portal
 * @layer Presentation
 * @category config
 * @author AI-Generated
 * @date 2026-11-15
 */
const config = {
  reactStrictMode: true,
  devIndicators: false,
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
};
export default config;

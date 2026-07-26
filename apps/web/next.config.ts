import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @socius/prompts ships raw TypeScript rather than a build output — the
  // prompts are product copy that the whole team edits, so a build step
  // between writing a line and seeing it in the 壁打ち would be in the way.
  transpilePackages: ["@socius/prompts"],
};

export default nextConfig;

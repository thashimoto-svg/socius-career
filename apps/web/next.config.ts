import type { NextConfig } from "next";

// The 壁打ち prompts used to be a workspace package, and needed
// `transpilePackages` because they ship raw TypeScript rather than a build
// output. They now live in ./prompts as ordinary source files of this app,
// compiled like everything else, so there is nothing left to configure.
const nextConfig: NextConfig = {};

export default nextConfig;

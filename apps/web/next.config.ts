import type { NextConfig } from "next";

const extraAllowedDevOrigins =
  process.env.NEXT_ALLOWED_DEV_ORIGINS?.split(",")
    .map((h) => h.trim())
    .filter(Boolean) ?? [];

const allowedDevOrigins = [
  "*.ngrok-free.app",
  "*.ngrok-free.dev",
  ...extraAllowedDevOrigins,
];

const nextConfig: NextConfig = {
  transpilePackages: ["@agents/agent", "@agents/db", "@agents/types"],
  serverExternalPackages: ["@langchain/core", "@langchain/langgraph", "@langchain/openai"],
  allowedDevOrigins,
};

export default nextConfig;

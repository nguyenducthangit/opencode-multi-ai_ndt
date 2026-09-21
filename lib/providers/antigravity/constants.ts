import os from "node:os";
import type { ProviderId } from "../../core/adapter.js";

export const PROVIDER_ID: ProviderId = "antigravity-multi";

export const ANTIGRAVITY_BASE_URL = "https://daily-cloudcode-pa.googleapis.com";
export const ANTIGRAVITY_SANDBOX_URL = "https://daily-cloudcode-pa.sandbox.googleapis.com";
export const ANTIGRAVITY_PROD_URL = "https://cloudcode-pa.googleapis.com";

export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

export const DUMMY_API_KEY = "dummy-antigravity-key";

// Standard Antigravity OAuth client credentials
export const GOOGLE_CLIENT_ID =
  "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
export const GOOGLE_CLIENT_SECRET =
  "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";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

export const DEFAULT_THINKING_AG_SIGNATURE =
  "EuwGCukGAXLI2nxwZIq54WWSoL/YN0P3TsDZ7zRnLi8g0S4aVr2HUGxvaHKySuY6HAVzcE0GPGjXrytLIldxthSvfxgUlJh6Qa9Z+Oj5QZBlYdg6HaJ6yuY5R7waE6rdwBsRf7Ft2j3DJ9rMi9qhWFqApewYtPhls3VHtuvND3l8Rm09+lbAXQs6KKWEWrxNLKTBkfpMgXhRERc/TQRMZu1twAablm6/Zk1tsYRvfWKLsNbeKF+CCojJdXJKvnR/8Ouuoa+Y2Ti20hcW7aZIIjZDFYPU//k6Ybmhg69J/imbFai2ckhfLaisqdDkdoIiBJScTOUvYqP6AE9d4MsydSC+UlhIMk4hoP76R8vUSCZRMkjOaDXstf/QoVZKbt94wyRZgAJ1G0BqI8L5ow86kLpA4wJEtxsRGymOE4bKUvApveBakYDNM9APkf+LbtbzWSseGjoZcSlycF9iN8Q2XNYKRrHbv3Lr5Y8JjdH/5y/6SHkNehTEZugaeGnSPSyCTWto1kQgHpxdWmhkLfJGNUGLmue7Mesj4TSms4J33mRpYVhNB/J333FCqIP0hr/E7BkkjEn7yZ4X7SQlh+xKPurapsnHRwiKmtsilmEFrnTE9iQr+pMr6M29qqFNv1tr5yumbaJw8JW9sB15tNsRv+dW6BjNanbsKz7HCgKUBc8tGy+7YuhXzAfViyRefcjK7eZW0Fbyt7AbybJTKz78W8NH7ye6LAwzOebXpeZ4D43fNIt8bKh26qgduSQv/7o+pAflkuqHZ99YWgHQ8h8OkZFi3eOiSYjsjhdZ/czWOdoPI/OnqIldzMPF5YlrKBLFX8VhRKVmqgsmWf5PHGulHhMkVlS+XG2UIseGy69ARa93D78Gsa+1n1kJr7EEB7Rh+27vUMxVYLdz1yMSvE5nalTAlg/ZeG8+XQ0cHuAI3KbQpHW2Q++RdXfm5JzD5WdJZUU+Zn8t8UUn85BH4RxZLeE0qJikgSsKoYVBc6YhiMjhPgkR95ReimY4Z0xCJdRo1gjexOFeODZMpQF6Yxnoic7IrdgsFA3iePTbFnPp3IAM1fAThWhXJUn3QInUOTd5o1qmTmn6REbL15g/JQNl+dqUoPkhleeb2V3kjqp1okmO3wMZbPknR3S1LZNmlS72/iBQUm+n2b/RCn4PjmM2";

export function getAntigravityUserAgent(): string {
  return `antigravity/1.107.0 ${os.platform()}/${os.arch()}`;
}

export const ANTIGRAVITY_DEFAULT_MODELS: Record<string, {
  name: string;
  thinkingBudget?: number;
  description: string;
}> = {
  "gemini-3-flash": {
    name: "Gemini 3 Flash (Instant, Zero Thinking)",
    thinkingBudget: 0,
    description: "Ultra-fast instant generation without thinking delay - ideal for code generation & agent edits",
  },
  "gemini-3.6-flash-high": {
    name: "Gemini 3.6 Flash High (Deep Reasoning)",
    thinkingBudget: 16384,
    description: "Full thinking model for complex logic, algorithms, and deep reasoning",
  },
  "gemini-3.6-flash-low": {
    name: "Gemini 3.6 Flash Low (Balanced)",
    thinkingBudget: 2048,
    description: "Light reasoning with fast response times for everyday programming tasks",
  },
  "gemini-pro-agent": {
    name: "Gemini Pro Agent (Flagship Architecture)",
    thinkingBudget: 16384,
    description: "Most powerful model for large codebase comprehension and system design",
  },
  "gemini-3.1-pro-low": {
    name: "Gemini 3.1 Pro Low",
    thinkingBudget: 4096,
    description: "Pro model with low thinking budget for faster responses",
  },
  "gemini-3.8-flash-high": {
    name: "Gemini 3.8 Flash High (Alias)",
    thinkingBudget: 16384,
    description: "Alias routed to Gemini 3.6 Flash High internal engine",
  },
  "gemini-3.8-flash-low": {
    name: "Gemini 3.8 Flash Low (Alias)",
    thinkingBudget: 2048,
    description: "Alias routed to Gemini 3.6 Flash Low internal engine",
  },
  "gemini-3.8-flash": {
    name: "Gemini 3.8 Flash (Balanced)",
    thinkingBudget: 2048,
    description: "Extremely fast, balanced thinking for general coding",
  },
  "gemini-2.5-pro": {
    name: "Gemini 2.5 Pro (Flagship)",
    description: "High capability, deep architectural coding",
  },
  "claude-sonnet-4-6": {
    name: "Claude Sonnet 4.6 (Antigravity Thinking)",
    description: "Claude Sonnet routed via Antigravity Cloud Code backend",
  },
};


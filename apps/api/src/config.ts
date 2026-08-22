import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_PUBLIC_URL: z.string().url().default("http://127.0.0.1:4000"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  TG_BOT_URL: z.string().url().default("https://t.me/example_bot"),
  TG_BOT_TOKEN: z.string().min(1).default("telegram-bot-token-change-me"),
  TG_CHANNEL_URL: z.string().url().default("https://t.me/fox_point_net"),
  SUPPORT_CONTACT: z.string().url().default("https://t.me/Fox_point_support"),
  DATABASE_URL: z.string().min(1).default("postgresql://foxpoint:foxpoint@localhost:5432/foxpoint?schema=public"),
  ADMIN_USERNAME: z.string().min(1).default("admin"),
  ADMIN_PASSWORD: z.string().min(1).default("admin"),
  ADMIN_SESSION_SECRET: z.string().min(16).default("foxpoint-admin-secret-change-me"),
  CLIENT_SESSION_SECRET: z.string().min(16).default("foxpoint-client-secret-change-me")
});

export const config = configSchema.parse(process.env);

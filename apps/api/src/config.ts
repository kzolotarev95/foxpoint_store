import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  TG_BOT_URL: z.string().url().default("https://t.me/example_bot"),
  TG_CHANNEL_URL: z.string().url().default("https://t.me/example_channel"),
  SUPPORT_CONTACT: z.string().default("@foxpoint_support"),
  DATABASE_URL: z.string().min(1).default("postgresql://foxpoint:foxpoint@localhost:5432/foxpoint?schema=public")
});

export const config = configSchema.parse(process.env);


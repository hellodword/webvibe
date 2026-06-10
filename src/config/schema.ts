import { z } from "zod";

import { modeSchema } from "../policy/schema.js";

const serverConfigSchema = z
  .object({
    listen: z.string().default("127.0.0.1:3000"),
    publicBaseUrl: z.string().optional(),
    stateDir: z.string().default("~/.webvibe"),
    mode: modeSchema.optional(),
    policy: z.string().optional(),
  })
  .strict()
  .superRefine((server, context) => {
    if (server.mode && server.policy) {
      context.addIssue({
        code: "custom",
        message: "server.mode and server.policy are mutually exclusive",
        path: ["policy"],
      });
    }
  });

export const appConfigSchema = z
  .object({
    version: z.literal(1).default(1),
    server: serverConfigSchema.default({ listen: "127.0.0.1:3000", stateDir: "~/.webvibe" }),
    workspace: z
      .object({
        root: z.string().default("."),
      })
      .default({ root: "." }),
    auth: z
      .object({
        pairingCode: z.string().min(1),
        accessTokenTtlDays: z.number().int().positive().default(30),
        pairingFailures: z
          .object({
            maxAttempts: z.number().int().positive().default(5),
            windowSeconds: z.number().int().positive().default(600),
          })
          .default({ maxAttempts: 5, windowSeconds: 600 }),
      }),
  })
  .strict();

export type AppConfigInput = z.input<typeof appConfigSchema>;
export type AppConfig = z.output<typeof appConfigSchema>;

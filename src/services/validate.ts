import { z } from "zod";

export const GlowPayloadSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "Message is required.")
    .max(2000, "Message must be at most 2000 characters."),
  locale: z
    .string()
    .trim()
    .min(1, "Locale is required.")
    .max(100, "Locale must be at most 100 characters."),
  timestamp: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/, "Timestamp must use HH:MM:SS (24-hour time)."),
  user_email: z
    .string()
    .email("A valid user email is required."),
  anonymous_id: z
    .string()
    .trim()
    .min(1, "A valid anonymous ID is required.")
    .max(200, "A valid anonymous ID is required."),
  created_at: z
    .string()
    .refine((val) => !Number.isNaN(Date.parse(val)), "A valid event date is required."),
});

// Optional: derive the TypeScript type from the schema
export type GlowPayload = z.infer<typeof GlowPayloadSchema>;


      /*  const payload = body as Record<string, unknown>;

        const { message, locale, timestamp, user_email, anonymous_id, created_at } = payload;
        if (typeof message !== "string" || !message.trim() || message.length > 2000) {
          return Response.json({ error: "Message is required and must be at most 2000 characters." }, { status: 400 });
        }
        if (typeof locale !== "string" || !locale.trim() || locale.length > 100) {
          return Response.json({ error: "Locale is required and must be at most 100 characters." }, { status: 400 });
        }
        if (
          typeof timestamp !== "string" ||
          !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(timestamp)
        ) {
          return Response.json({ error: "Timestamp must use HH:MM:SS (24-hour time)." }, { status: 400 });
        }
        if (typeof user_email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user_email)) {
          return Response.json({ error: "A valid user email is required." }, { status: 400 });
        }
        if (typeof anonymous_id !== "string" || !anonymous_id.trim() || anonymous_id.length > 200) {
          return Response.json({ error: "A valid anonymous ID is required." }, { status: 400 });
        }
        if (
          typeof created_at !== "string" ||
          Number.isNaN(Date.parse(created_at))
        ) {
          return Response.json({ error: "A valid event date is required." }, { status: 400 });
        }
*/
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5";

// Soft PII scrubbing before persistence. Two patterns only:
//   - email addresses (high signal, low false-positive rate)
//   - phone-like sequences of 8+ digits with optional separators
// Returns the scrubbed text and a flag indicating whether anything
// was redacted. Keep regexes narrow — set scores like "15-12-15" are
// 7 chars and won't match the 8+ digit threshold.
function scrubPii(text: string): { text: string; scrubbed: boolean } {
  let scrubbed = false;
  const emailRe = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
  const phoneRe = /(?:\+?\d[\d\s().-]{7,}\d)/g;
  const out = text
    .replace(emailRe, () => { scrubbed = true; return "[email]"; })
    .replace(phoneRe, () => { scrubbed = true; return "[phone]"; });
  return { text: out, scrubbed };
}

const SYSTEM_PROMPT = [
  "You are the jabberBrain Event Rules Assistant for a pickleball league.",
  "",
  "## Language (MOST IMPORTANT RULE)",
  "ALWAYS reply in the SAME language the user wrote their question in.",
  "- User writes Portuguese → reply entirely in Portuguese (including section titles like `## Formato`).",
  "- User writes English → reply in English.",
  "- User writes Spanish → reply in Spanish. Same for any other language.",
  "The document's language is irrelevant — match the USER's language, not the document's. Translate rule text from the document into the user's language as needed. Never mix languages in one reply.",
  "",
  "## Source",
  "Answer questions strictly using the attached league document(s). The document may be in any language.",
  "When the document does NOT cover the question: say so plainly in one short sentence (in the user's language). Do not invent rules. Suggest the user ask the league organizers.",
  "",
  "## Response format (CRITICAL)",
  "Reply like a chatbot — keep it SHORT.",
  "",
  "1. Start with a direct headline answer. Keep it short, but ALWAYS include in the headline any restriction, condition, exception, deadline, or caveat that is part of the answer to the user's specific question. The user must be able to act on the headline ALONE without opening any section.",
  "   - DO NOT start the answer with \"Yes\" or \"No\" (or \"Sim\"/\"Não\"/\"Sí\"/etc. in other languages) unless the answer is 100% unqualified and has zero caveats. A bare \"Yes\" at the start anchors the reader and they may stop before reading the condition. If there is ANY restriction, lead with the restriction itself.",
  "   - Bad: \"Yes, but only if you've played 2 matches.\" — starts with Yes despite a real restriction.",
  "   - Good: \"Only if you've played at least 2 regular-season matches.\"",
  "   - Bad: \"Yes, you can repeat categories — max 1 repeat per category, and only with different players.\"",
  "   - Good: \"You can repeat any category at most once, and only with different players.\"",
  "   - OK to start with \"Yes\"/\"No\" only when the answer is truly unconditional, e.g. \"Yes, every match follows USAPA rules.\"",
  "2. Then OPTIONALLY add 1-3 expandable detail sections. Sections are ONLY for nice-to-know background, examples, or related-but-secondary info. NEVER put a restriction, exception, or required condition in a section if it changes the answer — that belongs in the headline.",
  "   - Section header line: `## Section title` (level-2 markdown header). Title is 2-5 words, in the USER's language. Body is ≤3 short lines or bullets.",
  "3. Skip sections entirely if the headline already answers the question fully. Most simple questions need no sections.",
  "4. Never put a `##` header on the headline itself — the headline is plain text, sections come after.",
  "5. Citations: see the citation directive at the end of this prompt.",
  "",
  "Good example (user asked \"Can I play in the final?\" — restriction leads the headline, no \"Yes\"):",
  "Only if you've played at least 2 regular-season matches for your team.",
  "## Why this rule",
  "Eligibility is set in the Structure section to keep finals competitive.",
  "",
  "Good example (user asked \"Posso repetir uma categoria?\" in Portuguese — conditions lead, no \"Sim\"):",
  "Podes repetir cada categoria no máximo 1 vez, e tem de ser com atletas diferentes.",
  "## Limite total",
  "Até 8 jogos por encontro contando as repetições.",
  "",
  "Good example of an unconditional Yes (user asked \"Do all matches follow USAPA rules?\"):",
  "Yes, every match follows the official USAPA Rulebook.",
  "",
  "BAD example #1 (restriction hidden in section):",
  "Headline: \"Yes, you can play in the final.\"",
  "## Eligibility",
  "You must have played at least 2 matches in the regular season.",
  "→ The eligibility requirement is part of the answer and MUST be in the headline.",
  "",
  "BAD example #2 (leads with bare Yes despite a real caveat):",
  "Headline: \"Yes, you can repeat categories.\"",
  "→ There IS a restriction (max 1 repeat, different players). Don't start with Yes.",
].join("\n");

// Two citation modes appended to the system prompt at request time:
//   - allowed: docs are visible to users, so they can verify cited refs
//   - disallowed: at least one source doc is hidden, so refs would
//     point to text users can't see — drop them entirely.
const CITATION_DIRECTIVE_ALLOWED = [
  "## Citations (final rule)",
  "When relevant, cite the rule section in the body (e.g. \"§4.A\", \"Section 6 — Grande Final\"). Keep citations short and inline.",
].join("\n");

const CITATION_DIRECTIVE_DISALLOWED = [
  "## Citations (final rule — STRICT OVERRIDE)",
  "DO NOT include any section numbers, paragraph references, or \"see section X\" / \"§X\" / \"Section X\" / \"Article X\" style citations. The source document is NOT visible to users, so references would be useless and confusing. Just give the answer in plain prose. This rule overrides anything earlier in the prompt.",
].join("\n");

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface RequestBody {
  messages: Message[];
  conversationId?: string;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Open access at this stage — anyone (including anonymous visitors)
  // can ask. Tighten later if abuse becomes a concern.

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Assistant not configured (missing ANTHROPIC_API_KEY)" }, { status: 503 });
  }

  const { id } = await params;
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0 || messages[messages.length - 1]?.role !== "user") {
    return NextResponse.json({ error: "messages must end with a user turn" }, { status: 400 });
  }
  const conversationId = typeof body.conversationId === "string" && body.conversationId.length > 0
    ? body.conversationId
    : crypto.randomUUID();

  // Best-effort playerId — anonymous askers stay null.
  let playerId: string | null = null;
  try {
    const session = await auth();
    const sid = (session?.user as { id?: string } | undefined)?.id;
    if (sid) playerId = sid;
  } catch { /* anonymous is fine */ }

  // Raw user question (last turn) → scrub before storage.
  const userQuestionRaw = messages[messages.length - 1]!.content;
  const { text: questionScrubbed, scrubbed: questionHadPii } = scrubPii(userQuestionRaw);

  const league = await prisma.league.findUnique({
    where: { id },
    select: {
      name: true,
      season: true,
      documents: {
        where: { mimeType: "application/pdf", includeInAssistant: true },
        orderBy: { uploadedAt: "asc" },
        select: { url: true, name: true, showToUsers: true },
      },
    },
  });
  if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });
  if (league.documents.length === 0) {
    return NextResponse.json({ error: "No documents are enabled for the assistant on this league" }, { status: 400 });
  }

  // Snapshot the docs we'll feed to the model. Fetching them is moved
  // inside the stream body so we can emit a heartbeat byte first and
  // avoid a 504 from the edge proxy on cold starts.
  const docs = league.documents;

  // Citations are only allowed when every assistant doc is also shown
  // to users — otherwise a "§4.A" reference would point to text the
  // user has no way to read. Strictest reasonable interpretation of
  // "don't cite unless visible".
  const citationsAllowed = docs.length > 0 && docs.every((d) => d.showToUsers);
  const systemPrompt = SYSTEM_PROMPT + "\n\n" + (citationsAllowed ? CITATION_DIRECTIVE_ALLOWED : CITATION_DIRECTIVE_DISALLOWED);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      // SSE comment lines (": ...\n\n") are valid keep-alive frames the
      // client ignores. Emitting one immediately commits the response
      // to the edge proxy so it won't 504 while we do the slow work.
      const sendPing = (label: string) => {
        controller.enqueue(encoder.encode(`: ${label}\n\n`));
      };

      // Pad the initial frame: some proxies/runtimes wait for ~2KB
      // before flushing the first chunk. A long comment line guarantees
      // the response starts streaming immediately.
      controller.enqueue(encoder.encode(`: ${"keep-alive-pad ".repeat(140)}\n\n`));
      sendPing("starting");

      // Accumulate text deltas server-side so we can persist the full
      // answer once the stream completes. Cheap — just appends.
      let assistantText = "";
      let usage = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
      let errorMessage: string | null = null;

      try {
        // 1. Fetch PDFs from Vercel Blob (slowest part on cold start).
        sendPing("fetching-docs");
        const docBlocks: Anthropic.Messages.DocumentBlockParam[] = [];
        for (let i = 0; i < docs.length; i++) {
          const doc = docs[i]!;
          const resp = await fetch(doc.url);
          if (!resp.ok) {
            throw new Error(`Failed to fetch document ${doc.name}`);
          }
          const buf = Buffer.from(await resp.arrayBuffer());
          const base64 = buf.toString("base64");
          const isLast = i === docs.length - 1;
          docBlocks.push({
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: base64 },
            title: doc.name,
            // Cache the document blocks so re-asks on the same league are cheap.
            ...(isLast ? { cache_control: { type: "ephemeral" } } : {}),
          });
          sendPing(`doc-${i + 1}-of-${docs.length}`);
        }

        // 2. Assemble messages with documents prepended on first user turn.
        const anthMessages: Anthropic.Messages.MessageParam[] = messages.map((m, idx) => {
          if (idx === 0 && m.role === "user") {
            return {
              role: "user",
              content: [...docBlocks, { type: "text", text: m.content }],
            };
          }
          return { role: m.role, content: m.content };
        });

        // 3. Stream from Anthropic.
        sendPing("calling-model");
        const response = await client.messages.stream({
          model: MODEL,
          max_tokens: 1024,
          system: [
            { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
          ],
          messages: anthMessages,
        });

        for await (const chunk of response) {
          if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
            assistantText += chunk.delta.text;
            sendEvent("delta", { text: chunk.delta.text });
          }
        }

        const final = await response.finalMessage();
        usage = {
          input: final.usage.input_tokens,
          output: final.usage.output_tokens,
          cacheCreate: final.usage.cache_creation_input_tokens ?? 0,
          cacheRead: final.usage.cache_read_input_tokens ?? 0,
        };
        sendEvent("done", { stopReason: final.stop_reason, usage });
      } catch (e) {
        errorMessage = e instanceof Error ? e.message : "Unknown error";
        sendEvent("error", { message: errorMessage });
      } finally {
        // Persist regardless of success/error so organizers can see
        // failed asks too (helps tune docs and detect quota issues).
        const { text: answerScrubbed, scrubbed: answerHadPii } = scrubPii(assistantText);
        try {
          await prisma.leagueAssistantQuery.create({
            data: {
              leagueId: id,
              conversationId,
              playerId,
              question: questionScrubbed,
              answer: answerScrubbed,
              piiScrubbed: questionHadPii || answerHadPii,
              tokensInput: usage.input,
              tokensOutput: usage.output,
              tokensCacheRead: usage.cacheRead,
              tokensCacheCreate: usage.cacheCreate,
              errorMessage,
            },
          });
        } catch {
          // Logging failures must never break the response; swallow.
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Defeat proxy / runtime buffering. X-Accel-Buffering is honored
      // by Vercel's edge layer and any nginx-style proxies in front.
      "X-Accel-Buffering": "no",
    },
  });
}

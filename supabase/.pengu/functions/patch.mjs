const realFetch = globalThis.fetch;
const notice = "This is a Pengu preview reply: the live AI is not connected in previews.";
const aiHosts = new Set(["api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com", "api.groq.com", "openrouter.ai", "ai.gateway.lovable.dev", "api.mistral.ai", "api.perplexity.ai"]);

function env(name) {
  return (globalThis.Deno ? Deno.env.get(name) : globalThis.process?.env?.[name]) ?? "";
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function stream(chunks) {
  return new Response(chunks.join(""), { headers: { "Content-Type": "text/event-stream" } });
}

function data(value) {
  return "data: " + (typeof value === "string" ? value : JSON.stringify(value)) + "\n\n";
}

function event(name, value) {
  return "event: " + name + "\n" + data(value);
}

async function bodyOf(input, init) {
  try {
    if (init && typeof init.body === "string") return JSON.parse(init.body);
    if (input instanceof Request) return await input.clone().json();
  } catch {
    return {};
  }
  return {};
}

function openAI(url, body) {
  const model = body.model ?? "";
  if (url.pathname.endsWith("/embeddings")) {
    return json({ object: "list", data: [{ object: "embedding", index: 0, embedding: new Array(1536).fill(0) }], model, usage: { prompt_tokens: 0, total_tokens: 0 } });
  }
  if (url.pathname.endsWith("/responses")) {
    return json({ id: "resp_pengu", object: "response", status: "completed", model, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: notice }] }], output_text: notice });
  }
  const message = { role: "assistant", content: notice };
  if (body.stream) {
    const chunk = (delta, finish) => ({ id: "chatcmpl-pengu", object: "chat.completion.chunk", created: 0, model, choices: [{ index: 0, delta, finish_reason: finish }] });
    return stream([data(chunk(message, null)), data(chunk({}, "stop")), data("[DONE]")]);
  }
  return json({ id: "chatcmpl-pengu", object: "chat.completion", created: 0, model, choices: [{ index: 0, message, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
}

function anthropic(body) {
  const model = body.model ?? "";
  if (body.stream) {
    return stream([
      event("message_start", { type: "message_start", message: { id: "msg_pengu", type: "message", role: "assistant", model, content: [], stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } } }),
      event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: notice } }),
      event("content_block_stop", { type: "content_block_stop", index: 0 }),
      event("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 0 } }),
      event("message_stop", { type: "message_stop" }),
    ]);
  }
  return json({ id: "msg_pengu", type: "message", role: "assistant", model, content: [{ type: "text", text: notice }], stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 } });
}

function gemini(url) {
  const candidate = { candidates: [{ content: { role: "model", parts: [{ text: notice }] }, finishReason: "STOP", index: 0 }] };
  if (url.pathname.includes("streamGenerateContent")) {
    return url.searchParams.get("alt") === "sse" ? stream([data(candidate)]) : json([candidate]);
  }
  return json(candidate);
}

function address(value) {
  const text = typeof value === "string" ? value : value?.email ?? value?.Email ?? "";
  const angle = text.match(/<([^>]+)>/);
  return { Email: (angle ? angle[1] : text).trim() };
}

function addresses(value) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : value ? [value] : [];
  return list.map(address).filter((a) => a.Email);
}

async function deliver(mail) {
  const api = env("PENGU_INBOX_API");
  if (!api) return;
  await realFetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mail) });
}

async function resend(url, body) {
  const mails = url.pathname.endsWith("/batch") && Array.isArray(body) ? body : [body];
  for (const m of mails) {
    await deliver({ From: address(m.from), To: addresses(m.to), Subject: m.subject ?? "", HTML: m.html ?? "", Text: m.text ?? "" });
  }
  return url.pathname.endsWith("/batch") ? json({ data: mails.map(() => ({ id: "pengu-preview" })) }) : json({ id: "pengu-preview" });
}

async function postmark(body) {
  await deliver({ From: address(body.From), To: addresses(body.To), Subject: body.Subject ?? "", HTML: body.HtmlBody ?? "", Text: body.TextBody ?? "" });
  return json({ To: body.To ?? "", SubmittedAt: new Date().toISOString(), MessageID: "pengu-preview", ErrorCode: 0, Message: "OK" });
}

async function sendgrid(body) {
  const to = (body.personalizations ?? []).flatMap((p) => p.to ?? []);
  const part = (type) => (body.content ?? []).find((c) => c.type === type)?.value ?? "";
  await deliver({ From: address(body.from), To: addresses(to), Subject: body.subject ?? "", HTML: part("text/html"), Text: part("text/plain") });
  return new Response(null, { status: 202 });
}

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const host = url.hostname;
  if (host === "api.anthropic.com") return anthropic(await bodyOf(input, init));
  if (host === "generativelanguage.googleapis.com") return gemini(url);
  if (aiHosts.has(host)) return openAI(url, await bodyOf(input, init));
  if (host === "api.resend.com") return resend(url, await bodyOf(input, init));
  if (host === "api.postmarkapp.com") return postmark(await bodyOf(input, init));
  if (host === "api.sendgrid.com") return sendgrid(await bodyOf(input, init));
  return realFetch(input, init);
};

import { NextRequest } from "next/server";

const ODOO_BASE_URL =
  process.env.ODOO_BASE_URL || process.env.NEXT_PUBLIC_ODOO_BASE_URL || "http://localhost:8069";

export async function POST(req: NextRequest, context: any) {
  // In Next.js 16, `context.params` is a Promise.
  const params = await context.params;
  const segments: string[] = params?.path ?? [];
  const joinedPath = segments.join("/");
  const targetUrl = `${ODOO_BASE_URL}/${joinedPath}`;

  const body = await req.text();

  // Basic proxy logging to help debug persistence and payload shaping.
  // NOTE: keep this lightweight and avoid logging full bodies for very large payloads.
  console.log("[odoo-proxy] ->", {
    path: joinedPath,
    url: targetUrl,
    bodySample: body.slice(0, 300),
  });

  const res = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Forward the browser cookies so Odoo can use the existing session.
      cookie: req.headers.get("cookie") ?? "",
    },
    body,
  });

  const text = await res.text();

  console.log("[odoo-proxy] <-", {
    path: joinedPath,
    status: res.status,
    statusText: res.statusText,
    bodySample: text.slice(0, 300),
  });

  const responseHeaders = new Headers({
    "Content-Type": res.headers.get("Content-Type") ?? "application/json",
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    responseHeaders.set("set-cookie", setCookie);
  }
  return new Response(text, {
    status: res.status,
    headers: responseHeaders,
  });
}


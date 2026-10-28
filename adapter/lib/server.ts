import type { Transform } from "./transforms.ts";
import { appendFileSync, mkdirSync } from "fs";

/**
 * 协议适配层：挂在 NewAPI 后面，作为一个"OpenAI 兼容"渠道。
 *
 * - 上游 Key 不在这里配置：NewAPI 把渠道 Key 放在 Authorization 头里转发过来，这里原样带给上游。
 * - 只有 `/responses` 请求做 Responses ↔ Chat 转换，其他请求（如 chat/completions）原样透传。
 * - 只监听 127.0.0.1，由同机的 NewAPI 访问，不对外暴露。
 */

export interface ProxyRoute {
  /** 匹配路径前缀，如 "/ark" */
  prefix: string;
  targetBaseUrl: string;
  /** 固定转发到指定路径，不设则剥掉前缀后原样转发 */
  targetPath?: string;
  transform?: Transform;
  /** 非流式 response body 转换（Chat → Responses） */
  responseTransform?: Transform;
  /** 流式 SSE stream 转换器工厂，返回 TransformStream */
  streamTransformer?: () => TransformStream<Uint8Array, Uint8Array>;
}

export interface ServerConfig {
  port: number;
  routes: ProxyRoute[];
}

// 请求体可能含用户内容，默认不落盘（Conduit 隐私约定 §7），只在本地调试时打开
const DEBUG_LOG = process.env.ADAPTER_DEBUG_LOG === "1";

const NEWAPI_URL = process.env.NEWAPI_URL ?? "http://127.0.0.1:3010";
const HOME_PAGE =new URL("../home/index.html", import.meta.url).pathname;

function debugLog(text: string) {
  if (!DEBUG_LOG) return;
  try {
    mkdirSync("logs", { recursive: true });
    appendFileSync("logs/adapter-debug.log", text);
  } catch {}
}

export function startProxy(config: ServerConfig) {
  const { port, routes } = config;

  const server = Bun.serve({
    port,
    hostname: process.env.HOST ?? "127.0.0.1",

    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/health") {
        return Response.json({ status: "ok", timestamp: new Date().toISOString() });
      }

      // NewAPI「首页内容」以 iframe 嵌入的静态首页，由 Caddy 把 /_home 转过来
      if (url.pathname === "/_home" || url.pathname === "/_home/") {
        return new Response(Bun.file(HOME_PAGE), {
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
        });
      }

      // NewAPI 嵌入首页的 iframe 带 sandbox 且没有 allow-same-origin，页面是跨域来源，
      // 不能直接读 /api/status，所以在这里转一份最小信息并放开 CORS
      if (url.pathname === "/_home/status") {
        const cors = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
        try {
          const r = await fetch(`${NEWAPI_URL}/api/status`, { signal: AbortSignal.timeout(3000) });
          const j = (await r.json()) as { success?: boolean; data?: { version?: string } };
          return Response.json({ ok: j.success === true, version: j.data?.version ?? "" }, { headers: cors });
        } catch {
          return Response.json({ ok: false, version: "" }, { headers: cors });
        }
      }

      const route = routes
        .filter((r) => url.pathname.startsWith(r.prefix))
        .sort((a, b) => b.prefix.length - a.prefix.length)[0];

      if (!route) {
        return Response.json({ error: "no route matched" }, { status: 404 });
      }

      if (req.method === "GET") {
        return Response.json({ object: "list", data: [] });
      }

      const auth = req.headers.get("Authorization");
      if (!auth) {
        return Response.json({ error: "missing Authorization header" }, { status: 401 });
      }

      let body: Record<string, unknown> = {};
      try {
        body = await req.json();
      } catch {}
      debugLog(`\n${"=".repeat(80)}\n[${new Date().toISOString()}] ${req.method} ${url.pathname}\n\n--- INCOMING ---\n${JSON.stringify(body, null, 2)}\n`);

      const subPath = url.pathname.slice(route.prefix.length) || "/";
      // 只有 Responses 请求需要转换；其他请求直接透传到上游
      const isResponses = subPath.endsWith("/responses");
      if (isResponses && route.transform) body = route.transform(body);

      const targetPath = route.targetPath ?? subPath.replace(/^\/v1(?=\/)/, "");
      const target = route.targetBaseUrl.replace(/\/$/, "") + targetPath + url.search;
      console.log(`[adapter] → ${req.method} ${target} model=${body.model ?? ""} stream=${body.stream === true}`);
      debugLog(`\n--- AFTER TRANSFORM ---\n${JSON.stringify(body, null, 2)}\n`);

      try {
        const resp = await fetch(target, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: auth,
          },
          body: JSON.stringify(body),
        });

        const contentType = resp.headers.get("Content-Type") ?? "";

        // 流式响应：需要转换就转换，否则原样透传
        if (contentType.includes("text/event-stream") && resp.body) {
          const stream = isResponses && route.streamTransformer
            ? resp.body.pipeThrough(route.streamTransformer())
            : resp.body;
          console.log(`[adapter] ← SSE stream status=${resp.status}`);
          return new Response(stream, {
            status: resp.status,
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          });
        }

        const respText = await resp.text();
        console.log(`[adapter] ← status=${resp.status}`);
        debugLog(`\n--- RESPONSE status=${resp.status} ---\n${respText}\n`);

        // 上游报错或非 JSON → 直接透传，不做格式转换
        let respBody: Record<string, unknown>;
        try {
          respBody = JSON.parse(respText);
        } catch {
          return new Response(respText, {
            status: resp.status,
            headers: { "Content-Type": contentType || "text/plain" },
          });
        }
        if (resp.status >= 400 || !isResponses) {
          return Response.json(respBody, { status: resp.status });
        }

        const transformed = route.responseTransform ? route.responseTransform(respBody) : respBody;
        debugLog(`\n--- TRANSFORMED RESPONSE ---\n${JSON.stringify(transformed, null, 2)}\n`);

        return Response.json(transformed, { status: resp.status });
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 502 });
      }
    },
  });

  console.log(`✅ adapter 启动在 http://${process.env.HOST ?? "127.0.0.1"}:${server.port}`);
  for (const r of routes) {
    console.log(`   ${r.prefix}  →  ${r.targetBaseUrl}${r.targetPath ?? ""}`);
  }
}

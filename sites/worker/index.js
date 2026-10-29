import { handleApi } from "./api.js";
import { HTML } from "./ui.js";

const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Robots-Tag": "noindex, nofollow",
};

function responseJson(value, status = 200) {
  return Response.json(value, { status, headers: BASE_HEADERS });
}

function visitor(request) {
  const id = request.headers.get("oai-authenticated-user-id");
  if (!id) return null;
  const email = request.headers.get("oai-authenticated-user-email") || "";
  const encoded = request.headers.get("oai-authenticated-user-full-name") || "";
  let name = encoded || email.split("@")[0] || "Владелец";
  if (request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8") {
    try { name = decodeURIComponent(name); }
    catch (error) { console.warn("Invalid identity name encoding", error.name); }
  }
  return { id, email, name };
}

function htmlResponse(request) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const body = HTML.replace(/<(script|style)(?=[\s>])/g, '<$1 nonce="' + nonce + '"');
  const policy = "default-src 'self'; script-src 'nonce-" + nonce +
    "'; style-src 'nonce-" + nonce +
    "'; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com";
  return new Response(request.method === "HEAD" ? null : body, {
    headers: { ...BASE_HEADERS, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": policy },
  });
}

async function route(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) {
    if (!["GET", "HEAD"].includes(request.method)) return responseJson({ error: "Метод не поддерживается" }, 405);
    return htmlResponse(request);
  }
  const user = visitor(request);
  if (!user) return responseJson({ error: "Войдите через ChatGPT, чтобы открыть CRM." }, 401);
  const origin = request.headers.get("Origin");
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && origin && origin !== url.origin) {
    return responseJson({ error: "Запрос с другого сайта отклонён." }, 403);
  }
  if (!env.DB) return responseJson({ error: "База CRM ещё не подключена. Повторите после публикации." }, 503);
  return await handleApi(request, env, user) || responseJson({ error: "Адрес API не найден." }, 404);
}

export default {
  async fetch(request, env) {
    try { return await route(request, env); }
    catch (error) {
      console.error("CRM request failed", new URL(request.url).pathname, error.name);
      return responseJson({ error: "Не удалось выполнить операцию. Обновите страницу и повторите." }, 500);
    }
  },
};

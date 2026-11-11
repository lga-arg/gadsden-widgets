/**
 * Lo mínimo que pide Tiendanube a una app, al lado de los archivos estáticos (dist/):
 * - /callback: adonde vuelve el comerciante al instalar. La instalación se completa recién cuando la app canjea el
 *   `code` por un token. El token se guarda en KV (TOKENS, clave: el id de la tienda) para leer otros productos y sus
 *   metacampos con la API; nunca se loguea ni sale del Worker.
 * - /productos/<tienda>?handles=a,b&metacampos=<id de la ficha>: los otros productos que piden los widgets y los
 *   metacampos, leídos con ese token (src/api.ts). Quedan en KV seis horas y los vacían los webhooks de productos
 *   (/webhooks/productos) o guardar en el panel: la homologación (29-oct) frenó por pedidos repetidos a la API.
 * - /config/<tienda>.json: la configuración de los widgets de la tienda, la que lee el script de NubeSDK. La guarda el
 *   panel en KV (clave `config:<tienda>`); si no hay, 404 (sin widgets).
 * - /api/*: el panel (dist/panel/, dentro del admin de Tiendanube con Nexo). Cada pedido lleva el token de sesión de
 *   Nexo (src/sesion.ts) y la tienda sale de ahí: config (leer y guardar), productos (buscar) e imagen (subir; se sirve
 *   en /img/<tienda>/<id>).
 * - /tienda/<tienda>/<ruta>: la vista previa del editor del panel (una página de la tienda con los widgets y la capa de
 *   edición; tiendaEnEditor).
 * - /webhooks/store-redact, /customers-redact, /customers-data-request: obligatorios, con la firma de Tiendanube
 *   (x-linkedstore-hmac-sha256). Al desinstalar, store-redact borra el token; de compradores no se guarda nada.
 *   Antes de borrar deja `baja:<tienda>:<fecha>` (un año): fechas de alta y baja y qué widgets tenía y dónde, sin
 *   textos ni imágenes, para saber qué llegó a usar (`npx wrangler kv key list --binding TOKENS --remote --prefix baja:`).
 */
type KV = {
  get(k: string): Promise<string | null>;
  getWithMetadata<M>(k: string, tipo: "arrayBuffer"): Promise<{ value: ArrayBuffer | null; metadata: M | null }>;
  put(k: string, v: string | ArrayBuffer, op?: { metadata?: unknown; expirationTtl?: number }): Promise<void>;
  delete(k: string): Promise<void>;
  list(op: { prefix: string; cursor?: string }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
};
import { leerProductos, type Api } from "./src/api.ts";
import { tiendaDeSesion } from "./src/sesion.ts";
import { seccionesDelHtml } from "./src/lugares.ts";

/** SESION_DESARROLLO = "1": acepta también los tokens del modo desarrollador del portal (firmados con "THE_SECRET"). */
/** ONBOARDING_URL y ONBOARDING_SECRET (secretos de Cloudflare): el webhook de n8n del onboarding (docs/onboarding-whatsapp.md). */
/** SUBIDAS: el límite de subidas de compradores (wrangler.toml, ratelimits). */
interface Env { ASSETS: { fetch: (r: Request) => Promise<Response> }; CLIENT_ID: string; CLIENT_SECRET?: string; SESION_DESARROLLO?: string; TOKENS: KV; ONBOARDING_URL?: string; ONBOARDING_SECRET?: string; SUBIDAS?: { limit(o: { key: string }): Promise<{ success: boolean }> } }

/** Le avisa a n8n una instalación (con los datos de contacto de la tienda) o una desinstalación. Sin ONBOARDING_URL, nada. */
const avisarOnboarding = (env: Env, datos: Record<string, unknown>) => env.ONBOARDING_URL
  ? fetch(env.ONBOARDING_URL, { method: "POST", body: JSON.stringify(datos), headers: { "Content-Type": "application/json", "x-gadsden-secret": env.ONBOARDING_SECRET ?? "" } }).then(() => {}, () => {})
  : Promise.resolve();

type Ctx = { waitUntil(p: Promise<unknown>): void };

/** Lo que usaba una tienda que se va: tipo y lugar de cada widget, sin su contenido. `alta` es null si se instaló antes del 8-nov. */
async function guardarBaja(env: Env, tienda: number) {
  const [config, alta] = await Promise.all([env.TOKENS.get(`config:${tienda}`), env.TOKENS.get(`alta:${tienda}`)]);
  const widgets = config === null ? null : ((JSON.parse(config) as { widgets?: { bloque?: { type?: string }; seccion?: { type?: string }; lugar?: string }[] }).widgets ?? [])
    .map((w) => ({ tipo: (w.bloque ?? w.seccion)?.type ?? "?", lugar: w.lugar ?? "?" }));
  const baja = new Date().toISOString();
  await env.TOKENS.put(`baja:${tienda}:${baja}`, JSON.stringify({ tienda, alta, baja, widgets }), { expirationTtl: 365 * 86_400 });
}

const WEBHOOKS = new Set(["/webhooks/store-redact", "/webhooks/customers-redact", "/webhooks/customers-data-request", "/webhooks/productos"]);

// Una ruta que empieza con "unstable:" va a esa versión de la API (los campos personalizados de imagen y la biblioteca de
// medios sólo están ahí, 25-oct). Con `cuerpo`, un POST con JSON.
const pedir = (token: string, tienda: number | string, ruta: string, cuerpo?: unknown) => fetch(`https://api.tiendanube.com/${ruta.startsWith("unstable:") ? `unstable/${tienda}${ruta.slice(9)}` : `2025-03/${tienda}${ruta}`}`, {
  ...(cuerpo !== undefined && { method: "POST", body: JSON.stringify(cuerpo) }),
  headers: { Authorization: `Bearer ${token}`, "User-Agent": "Gadsden Widgets (admin@lga-arg.com)", ...(cuerpo !== undefined && { "Content-Type": "application/json" }) },
});

type Medio = { id: string; original_filename?: string; thumbnail_url?: string; original_file_url?: string };
/**
 * Sube una imagen a la biblioteca de medios de la tienda (la de "O elegí de la biblioteca" del admin): pide la dirección
 * de subida, sube el archivo ahí (sin el token) y la confirma (409 = ya estaba). Devuelve la dirección pública.
 * Pide el permiso de la biblioteca de medios (escritura); sin él, falla y el panel sube al KV como antes.
 */
async function subirABiblioteca(acceso: string, tienda: string, datos: ArrayBuffer, tipo: string, nombre: string) {
  const meta = { original_filename: nombre, mime_type: tipo, file_size_bytes: datos.byteLength };
  const p = await pedir(acceso, tienda, "unstable:/store-media/presign", meta);
  if (!p.ok) throw new Error(`presign ${p.status}`);
  const { id, upload_url } = (await p.json()) as { id: string; upload_url: string };
  const s = await fetch(upload_url, { method: "PUT", body: datos, headers: { "Content-Type": tipo } });
  if (!s.ok) throw new Error(`subida ${s.status}`);
  const c = await pedir(acceso, tienda, `unstable:/store-media/${id}/confirm`, meta);
  if (!c.ok && c.status !== 409) throw new Error(`confirmar ${c.status}`);
  const m = (await c.json()) as Medio;
  // La confirmación no siempre trae la dirección del original (la doc no la lista): se pide la imagen.
  const url = m.original_file_url ?? ((await (await pedir(acceso, tienda, `unstable:/store-media/${m.id ?? id}`)).json()) as Medio).original_file_url;
  if (!url) throw new Error("sin dirección");
  return url;
}
/** La firma de los webhooks: HMAC-SHA256 del cuerpo con el client secret, en hexadecimal. */
async function firmaValida(cuerpo: string, firma: string | null, secreto?: string) {
  if (!firma || !secreto) return false;
  const t = new TextEncoder();
  const clave = await crypto.subtle.importKey("raw", t.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const hex = [...new Uint8Array(await crypto.subtle.sign("HMAC", clave, t.encode(cuerpo)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const f = firma.trim().toLowerCase();
  let dif = hex.length ^ f.length;
  for (let i = 0; i < hex.length; i++) dif |= hex.charCodeAt(i) ^ (f.charCodeAt(i) || 0);
  return dif === 0;
}

/**
 * Los webhooks de productos de la tienda, apuntando a /webhooks/productos: se registran al instalar y, en las tiendas que
 * ya la tenían, en el primer /productos (marca `hooks:<tienda>`). No hay webhook de metacampos ni de campos
 * personalizados del producto (doc, 29-oct): por eso la caché además vence a las seis horas.
 */
const EVENTOS = ["product/created", "product/updated", "product/deleted"];
async function registrarWebhooks(env: Env, tienda: string, token: string, origen: string) {
  const url = `${origen}/webhooks/productos`;
  const r = await pedir(token, tienda, "/webhooks");
  if (!r.ok) return;
  const hay = new Set(((await r.json()) as { event: string; url: string }[]).filter((w) => w.url === url).map((w) => w.event));
  const nuevos = await Promise.all(EVENTOS.filter((e) => !hay.has(e)).map((event) => pedir(token, tienda, "/webhooks", { event, url })));
  if (nuevos.every((x) => x.ok)) await env.TOKENS.put(`hooks:${tienda}`, "1");
}
/** Un cambio de productos (webhook o guardar en el panel): una versión nueva deja atrás lo guardado de la tienda. */
const vaciarProductos = (env: Env, tienda: string | number) => env.TOKENS.put(`ver:${tienda}`, Date.now().toString(36));

const enCurso = new Map<string, Promise<{ texto: string; fallo: boolean } | null>>();
/**
 * Los productos para un widget. Cada ficha se lee de la API una vez y queda en KV (por tienda, versión y pedido) seis
 * horas; adelante, la caché de Cloudflare cinco minutos. Los iframes de una misma página que piden lo mismo a la vez
 * esperan un solo pedido. Si la API falló (429, 5xx o red), no se guarda.
 */
async function productos(req: Request, env: Env, ctx: Ctx, tienda: string, q: URLSearchParams) {
  const ver = (await env.TOKENS.get(`ver:${tienda}`)) ?? "0";
  const u = new URL(req.url);
  u.searchParams.set("v", ver);
  const llave = new Request(u.toString());
  const cache = (globalThis as unknown as { caches?: { default: { match(r: Request): Promise<Response | undefined>; put(r: Request, x: Response): Promise<void> } } }).caches?.default;
  const guardada = await cache?.match(llave);
  if (guardada) return guardada;
  const clave = `cache:${tienda}:${ver}:${q.get("handles") ?? ""}:${q.get("metacampos") ?? ""}`;
  // X-Gadsden: de dónde salió (kv, api, api-compartido o api-fallo), para medir que no se repitan pedidos.
  let texto = await env.TOKENS.get(clave), fuente = "kv";
  if (!texto) {
    fuente = "api";
    const token = await env.TOKENS.get(tienda);
    if (!token) return Response.json({ productos: [], metacampos: {} }, { status: 404 });
    if (!(await env.TOKENS.get(`hooks:${tienda}`))) ctx.waitUntil(registrarWebhooks(env, tienda, token, u.origin).catch(() => {}));
    let pedido = enCurso.get(clave);
    if (pedido) fuente = "api-compartido";
    else {
      let fallo = false;
      const api: Api = (ruta) => pedir(token, tienda, ruta)
        .then((x) => { if (x.status === 429 || x.status >= 500) fallo = true; return x.ok ? x.json() : null; })
        .catch(() => { fallo = true; return null; });
      const handles = (q.get("handles") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
      const ficha = Number(q.get("metacampos")) || undefined;
      pedido = leerProductos(api, handles, ficha).then((x) => ({ texto: JSON.stringify(x), fallo })).finally(() => enCurso.delete(clave));
      enCurso.set(clave, pedido);
      pedido.then((x) => { if (x && !x.fallo) ctx.waitUntil(env.TOKENS.put(clave, x.texto, { expirationTtl: 6 * 3600 })); }, () => {});
    }
    const x = await pedido;
    texto = x!.texto;
    // Con la API fallando no se guarda en ningún lado: el próximo pedido vuelve a probar.
    if (x!.fallo) return new Response(texto, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "X-Gadsden": "api-fallo" } });
  }
  const r = new Response(texto, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*", "X-Gadsden": fuente } });
  ctx.waitUntil(cache?.put(llave, r.clone()) ?? Promise.resolve());
  return r;
}

/** La configuración que lee el script: sin caché, para que un cambio del panel se vea al recargar la tienda. */
async function config(req: Request, env: Env, tienda: string) {
  const cabeceras = { "Content-Type": "application/json", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*" };
  const guardada = await env.TOKENS.get(`config:${tienda}`);
  // Sin configuración guardada no hay widgets (antes salía la de fábrica de las tiendas de prueba: al reinstalar
  // volvían los widgets de ejemplo en vez de arrancar vacía).
  return guardada ? new Response(guardada, { headers: cabeceras }) : Response.json(null, { status: 404, headers: cabeceras });
}

/** La config guardada, o la de fábrica, o una vacía (para el panel). */
async function configDe(req: Request, env: Env, tienda: string): Promise<string> {
  const r = await config(req, env, tienda);
  return r.ok ? r.text() : JSON.stringify({ widgets: [] });
}

const IMAGENES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml", "video/mp4", "video/webm"]);

/** El panel: todo pide el token de sesión de Nexo; la tienda es la del token. */
async function api(req: Request, env: Env, ruta: string, q: URLSearchParams): Promise<Response> {
  const token = /^Bearer (.+)$/.exec(req.headers.get("Authorization") ?? "")?.[1] ?? "";
  const tienda = await tiendaDeSesion(token, [env.CLIENT_SECRET ?? "", env.SESION_DESARROLLO === "1" ? "THE_SECRET" : ""]);
  if (!tienda) return Response.json({ error: "sesion" }, { status: 401 });
  if (ruta === "config" && req.method === "GET") return new Response(await configDe(req, env, tienda), { headers: { "Content-Type": "application/json" } });
  if (ruta === "config" && req.method === "PUT") {
    const texto = await req.text();
    if (texto.length > 500_000) return Response.json({ error: "grande" }, { status: 413 });
    const c = JSON.parse(texto || "null") as { widgets?: unknown } | null;
    if (!c || typeof c !== "object" || !Array.isArray(c.widgets)) return Response.json({ error: "formato" }, { status: 400 });
    // Guardar también trae de nuevo los productos: un metacampo cambiado se ve sin esperar las seis horas.
    await Promise.all([env.TOKENS.put(`config:${tienda}`, texto), vaciarProductos(env, tienda)]);
    return Response.json({ ok: true, tienda });
  }
  if (ruta === "productos") {
    const acceso = await env.TOKENS.get(tienda);
    if (!acceso) return Response.json({ error: "token", productos: [] }, { status: 409 });
    const r = await pedir(acceso, tienda, `/products?${q.get("q") ? `q=${encodeURIComponent(q.get("q")!)}&` : ""}published=true&per_page=20&fields=id,name,handle,images`).catch(() => null);
    const xs = (r?.ok ? await r.json() : []) as { id: number; name: Record<string, string>; handle: Record<string, string>; images?: { src: string }[] }[];
    const t = (x: Record<string, string> | string) => (typeof x === "string" ? x : x.es ?? Object.values(x)[0] ?? "");
    return Response.json({ productos: xs.map((p) => ({ id: p.id, nombre: t(p.name), handle: t(p.handle), imagen: p.images?.[0]?.src ?? null })) });
  }
  // Las secciones de la ficha de producto de la tienda (para "antes o después de la sección X"): las que trae el HTML
  // público de la ficha del primer producto publicado (Ipanema las marca con data-nubesdk-section-*).
  if (ruta === "secciones") {
    const acceso = await env.TOKENS.get(tienda);
    if (!acceso) return Response.json({ error: "token", producto: [] }, { status: 409 });
    const r = await pedir(acceso, tienda, "/products?published=true&per_page=1&fields=canonical_url").catch(() => null);
    const url = ((r?.ok ? await r.json() : []) as { canonical_url?: string }[])[0]?.canonical_url;
    if (!url || !/^https:\/\//.test(url)) return Response.json({ producto: [] });
    const html = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Gadsden Widgets)" } }).then((x) => (x.ok ? x.text() : "")).catch(() => "");
    return Response.json({ producto: seccionesDelHtml(html), url });
  }
  // La biblioteca de medios de la tienda, para "O elegí de la biblioteca" del selector de imagen.
  // ponytail: las primeras 100 (el tope de la API por página); filtrar por nombre o paginar si una tienda tiene más.
  if (ruta === "biblioteca") {
    const acceso = await env.TOKENS.get(tienda);
    if (!acceso) return Response.json({ error: "token", imagenes: [] }, { status: 409 });
    const r = await pedir(acceso, tienda, "unstable:/store-media?media_type=image&limit=100").catch(() => null);
    if (!r?.ok) return Response.json({ error: `biblioteca ${r?.status ?? "red"}`, imagenes: [] }, { status: 502 });
    const { data = [] } = (await r.json()) as { data?: Medio[] };
    return Response.json({ imagenes: data.filter((m) => m.original_file_url).map((m) => ({ id: m.id, url: m.original_file_url, miniatura: m.thumbnail_url ?? m.original_file_url, nombre: m.original_filename ?? "" })) });
  }
  if (ruta === "imagen" && req.method === "POST") {
    const tipo = (req.headers.get("Content-Type") ?? "").split(";")[0]!;
    if (!IMAGENES.has(tipo)) return Response.json({ error: "tipo" }, { status: 415 });
    const datos = await req.arrayBuffer();
    // Primero a la biblioteca de medios de la tienda (hasta 20 MB); si no se puede, al KV como antes (hasta 5 MB).
    const acceso = await env.TOKENS.get(tienda);
    const nombre = decodeURIComponent(req.headers.get("X-Nombre") ?? "") || `imagen.${tipo.split("/")[1]}`;
    if (acceso && datos.byteLength <= 20_000_000) {
      const url = await subirABiblioteca(acceso, tienda, datos, tipo, nombre).catch((e) => { console.log("[biblioteca]", String(e)); return null; });
      if (url) return Response.json({ url });
    }
    if (datos.byteLength > 5_000_000) return Response.json({ error: "grande" }, { status: 413 });
    const id = crypto.randomUUID();
    await env.TOKENS.put(`img:${tienda}:${id}`, datos, { metadata: { tipo } });
    return Response.json({ url: `${new URL(req.url).origin}/img/${tienda}/${id}` });
  }
  return Response.json({ error: "ruta" }, { status: 404 });
}

/** Una imagen subida desde el panel (KV `img:<tienda>:<id>`), para siempre en caché. */
async function imagen(env: Env, tienda: string, id: string) {
  const { value, metadata } = await env.TOKENS.getWithMetadata<{ tipo: string }>(`img:${tienda}:${id}`, "arrayBuffer");
  if (!value) return new Response(null, { status: 404 });
  return new Response(value, { headers: { "Content-Type": metadata?.tipo ?? "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable", "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff" } });
}

/** Los primeros bytes de un PNG, un JPEG y un WebP ("RIFF....WEBP"): el tipo que dice el pedido tiene que coincidir. */
function esImagen(datos: ArrayBuffer, tipo: string) {
  const b = new Uint8Array(datos.slice(0, 12));
  if (tipo === "image/png") return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (tipo === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (tipo === "image/webp") return String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP";
  return false;
}
/**
 * La imagen que sube un comprador en el bloque "Personalizar con tu imagen" (src/w/snippets/gad-block-design_upload.liquid).
 * Sin sesión (la sube cualquiera desde la tienda): sólo PNG, JPEG o WebP de verdad, hasta 20 MB (el bloque la vuelve a
 * codificar y avisa desde 10 MB), en una tienda con la app instalada, y diez por minuto por IP y tienda (SUBIDAS).
 * Queda 90 días: la app no lee pedidos y no sabe cuáles se compraron. Se sirve en /img/<tienda>/<id> como las del panel,
 * y store-redact la borra con ellas.
 */
async function subidaDeComprador(req: Request, env: Env, tienda: string) {
  const error = (texto: string, status: number) => Response.json({ error: texto }, { status });
  if (req.method !== "POST") return error("método", 405);
  if (env.SUBIDAS && !(await env.SUBIDAS.limit({ key: `${req.headers.get("cf-connecting-ip") ?? ""}:${tienda}` })).success) return error("Subiste muchas imágenes seguidas. Esperá un minuto y probá de nuevo.", 429);
  if (!(await env.TOKENS.get(tienda))) return error("Tienda desconocida.", 404);
  const tipo = (req.headers.get("Content-Type") ?? "").split(";")[0]!;
  if (Number(req.headers.get("Content-Length") ?? 0) > 20 * 1024 * 1024) return error("La imagen pesa demasiado.", 413);
  const datos = await req.arrayBuffer();
  if (datos.byteLength > 20 * 1024 * 1024) return error("La imagen pesa demasiado.", 413);
  if (!esImagen(datos, tipo)) return error("Usá una imagen JPG, PNG o WebP.", 415);
  const id = crypto.randomUUID();
  await env.TOKENS.put(`img:${tienda}:${id}`, datos, { metadata: { tipo, comprador: true }, expirationTtl: 90 * 86400 });
  return Response.json({ url: `${new URL(req.url).origin}/img/${tienda}/${id}` });
}

const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/**
 * La vista previa de un diseño, la que llega al pedido como "Vista previa": la foto del producto con la imagen del
 * comprador en su lugar (zona de impresión `z` y ubicación `p` del bloque, en proporciones), armada con CSS.
 */
function vistaDeDiseno(q: URLSearchParams, origen: string) {
  const d = q.get("d") ?? "", f = q.get("f") ?? "";
  const z = (q.get("z") ?? "").split(",").map(Number), p = (q.get("p") ?? "").split(",").map(Number);
  if (!d.startsWith(`${origen}/img/`) || !/^https:\/\//.test(f) || z.length !== 4 || p.length !== 4 || [...z, ...p].some((n) => !Number.isFinite(n))) return pagina("Gadsden Widgets", "Esta vista previa está incompleta.", 400);
  const [zx, zy, zw, zh] = z as [number, number, number, number], [x, y, w, r] = p as [number, number, number, number];
  const pt = q.get("l") === "pt", X = Math.round(x * 100), Y = Math.round(y * 100), W = Math.round(w * 100);
  return new Response(
    `<!doctype html><html lang="${pt ? "pt" : "es"}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${pt ? "Prévia do design" : "Vista previa del diseño"}</title>` +
    `<style>body{margin:0;font:15px system-ui;background:#f4f4f4;color:#222}main{max-width:640px;margin:24px auto;padding:0 16px}` +
    `.l{position:relative}.l>img{display:block;width:100%}.z{position:absolute;left:${zx}%;top:${zy}%;width:${zw}%;height:${zh}%;outline:1px dashed rgba(0,0,0,.35)}` +
    `.d{position:absolute;left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;transform:translate(-50%,-50%) rotate(${r}deg)}.d img{display:block;width:100%}a{color:inherit}</style>` +
    `<main><div class="l"><img src="${escapar(f)}" alt="${pt ? "Produto" : "Producto"}"><div class="z"><div class="d"><img src="${escapar(d)}" alt="Design"></div></div></div>` +
    (pt
      ? `<p>Área de impressão: a linha tracejada. Centro da imagem a ${X} % da largura e a ${Y} % da altura da área; largura ${W} % da área; rotação ${r}°.</p><p><a href="${escapar(d)}" download>Baixar o arquivo original</a></p></main>`
      : `<p>Zona de impresión: la línea punteada. Centro de la imagen al ${X} % del ancho y al ${Y} % del alto de la zona; ancho ${W} % de la zona; giro ${r}°.</p><p><a href="${escapar(d)}" download>Descargar el archivo original</a></p></main>`),
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600", "Content-Security-Policy": "default-src 'none'; img-src https: 'self'; style-src 'unsafe-inline'" } },
  );
}

/**
 * La vista previa del editor del panel: una página pública de la tienda, traída por el Worker. La tienda sólo deja que la
 * enmarque su propio dominio (frame-ancestors), así que el panel no la puede mostrar directo. Va con <base> (sus links y
 * archivos siguen apuntando a la tienda) y con dist/editor.js (src/vista.ts, EDITOR), que dibuja los widgets y la capa de
 * edición. Sólo páginas de la tienda de ese id (el dominio sale de la API, con su token). El panel la abre en un iframe
 * con sandbox sin allow-same-origin: los scripts de la tienda corren en un origen aparte y no tocan el panel.
 */
async function tiendaEnEditor(req: Request, env: Env, tienda: string, ruta: string, busqueda: string) {
  let dominio = await env.TOKENS.get(`dominio:${tienda}`);
  if (!dominio) {
    const acceso = await env.TOKENS.get(tienda);
    if (!acceso) return pagina("Gadsden Widgets", "Falta instalar la app en esta tienda.", 409);
    const r = await pedir(acceso, tienda, "/store?fields=original_domain").catch(() => null);
    dominio = ((r?.ok ? await r.json() : {}) as { original_domain?: string }).original_domain ?? null;
    if (!dominio || !/^[a-z0-9.-]+$/i.test(dominio)) return pagina("Gadsden Widgets", "No encontramos la tienda.", 404);
    await env.TOKENS.put(`dominio:${tienda}`, dominio);
  }
  const r = await fetch(`https://${dominio}${ruta}${busqueda}`, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", "Accept-Language": "es-AR,es;q=0.9" } });
  const origen = new URL(req.url).origin;
  const html = (await r.text())
    .replace(/<meta[^>]+http-equiv=["']?content-security-policy[^>]*>/gi, "")
    .replace(/<head([^>]*)>/i, `<head$1><base href="https://${dominio}/">`)
    .replace(/<\/body>/i, `<script src="${origen}/editor.js"></script></body>`);
  return new Response(html, { status: r.status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

const pagina = (titulo: string, texto: string, status = 200) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${titulo}</title>` +
  `<p style="font:16px system-ui;margin:40px;max-width:560px">${texto}</p>`,
  { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
);

export default {
  async fetch(req: Request, env: Env, ctx: Ctx): Promise<Response> {
    const { pathname, searchParams } = new URL(req.url);
    if (WEBHOOKS.has(pathname)) {
      if (req.method !== "POST") return new Response(null, { status: 405 });
      const cuerpo = await req.text();
      if (!(await firmaValida(cuerpo, req.headers.get("x-linkedstore-hmac-sha256"), env.CLIENT_SECRET))) return new Response(null, { status: 401 });
      const tienda = (JSON.parse(cuerpo || "{}") as { store_id?: number }).store_id;
      // Una tienda con stock que se mueve manda product/updated sin parar (6-nov: ~6 por minuto, 1.485 escrituras de KV
      // en el día: se comió el cupo gratis de 1.000 de TODA la cuenta y tiró TicketUp). La versión se renueva como mucho
      // cada 5 minutos: leer sale gratis, escribir no. Y si KV falla, 200 igual: un 500 hace que Tiendanube reintente.
      if (pathname === "/webhooks/productos" && tienda) {
        const ver = parseInt((await env.TOKENS.get(`ver:${tienda}`)) ?? "0", 36);
        if (Date.now() - ver > 5 * 60_000) await vaciarProductos(env, tienda).catch(() => {});
      }
      if (pathname === "/webhooks/store-redact" && tienda) {
        ctx.waitUntil(avisarOnboarding(env, { tienda, evento: "desinstalada" }));
        await guardarBaja(env, tienda).catch(() => {});
        await Promise.all([String(tienda), `alta:${tienda}`, `config:${tienda}`, `dominio:${tienda}`, `hooks:${tienda}`, `ver:${tienda}`].map((k) => env.TOKENS.delete(k)));
        // Las imágenes que subió desde el panel y los productos guardados.
        for (const prefix of [`img:${tienda}:`, `cache:${tienda}:`]) {
          for (let cursor: string | undefined, fin = false; !fin;) {
            const l = await env.TOKENS.list({ prefix, cursor });
            await Promise.all(l.keys.map((k) => env.TOKENS.delete(k.name)));
            [cursor, fin] = [l.cursor, l.list_complete];
          }
        }
      }
      return new Response(null, { status: 200 });
    }
    const deApi = /^\/api\/([a-z]+)$/.exec(pathname);
    if (deApi) return api(req, env, deApi[1]!, searchParams).catch(() => Response.json({ error: "interno" }, { status: 500 }));
    const deImagen = /^\/img\/(\d+)\/([0-9a-f-]{36})$/.exec(pathname);
    if (deImagen) return imagen(env, deImagen[1]!, deImagen[2]!);
    const deSubida = /^\/subir\/(\d+)$/.exec(pathname);
    if (deSubida) return subidaDeComprador(req, env, deSubida[1]!).catch(() => Response.json({ error: "No se pudo subir la imagen." }, { status: 500 }));
    if (pathname === "/vista") return vistaDeDiseno(searchParams, new URL(req.url).origin);
    const deConfig = /^\/config\/(\d+)\.json$/.exec(pathname);
    if (deConfig) return config(req, env, deConfig[1]!);
    const deTienda = /^\/tienda\/(\d+)(\/[^]*)?$/.exec(pathname);
    if (deTienda && !deTienda[2]?.startsWith("//")) return tiendaEnEditor(req, env, deTienda[1]!, deTienda[2] ?? "/", new URL(req.url).search);
    const deProductos = /^\/productos\/(\d+)$/.exec(pathname);
    if (deProductos) return productos(req, env, ctx, deProductos[1]!, searchParams);
    if (pathname !== "/callback") return env.ASSETS.fetch(req);

    const code = searchParams.get("code");
    if (!code) return pagina("Gadsden Widgets", "Falta el código de instalación. Instalá la app desde Tiendanube.", 400);
    if (!env.CLIENT_SECRET) return pagina("Gadsden Widgets", "La app no está configurada (falta CLIENT_SECRET).", 500);
    const r = await fetch("https://www.tiendanube.com/apps/authorize/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET, grant_type: "authorization_code", code }),
    });
    const datos = (await r.json().catch(() => ({}))) as { access_token?: string; user_id?: number; scope?: string; error?: string; error_description?: string };
    if (!datos.access_token) {
      console.log("canje fallido", r.status, datos.error ?? "", datos.error_description ?? "");
      return pagina("Gadsden Widgets", "No se pudo completar la instalación. Volvé a instalar la app desde Tiendanube.", 502);
    }
    await Promise.all([env.TOKENS.put(String(datos.user_id), datos.access_token), env.TOKENS.put(`alta:${datos.user_id}`, new Date().toISOString())]);
    // Siempre al instalar: al desinstalar Tiendanube borra los webhooks, pero la marca `hooks:` puede seguir.
    ctx.waitUntil(registrarWebhooks(env, String(datos.user_id), datos.access_token, new URL(req.url).origin).catch(() => {}));
    // Instalada: al panel dentro del admin de la tienda, como TicketUp (la homologación pide que la app abra en el admin).
    // Con los mismos datos de la tienda, el aviso de instalación al onboarding (no frena la redirección).
    const r2 = await pedir(datos.access_token, datos.user_id!, "/store?fields=name,email,phone,whatsapp_phone_number,country,main_language,original_domain").catch(() => null);
    const deLaTienda = (r2?.ok ? await r2.json() : {}) as { original_domain?: string };
    ctx.waitUntil(avisarOnboarding(env, { tienda: datos.user_id, evento: "instalada", ...deLaTienda }));
    const dominio = deLaTienda.original_domain;
    if (dominio && /^[a-z0-9.-]+$/i.test(dominio)) {
      await env.TOKENS.put(`dominio:${datos.user_id}`, dominio);
      return Response.redirect(`https://${dominio}/admin/apps/${env.CLIENT_ID}`, 302);
    }
    return pagina("Gadsden Widgets", "Gadsden Widgets quedó instalada. Abrila desde Mis aplicaciones en el admin de tu tienda.");
  },
};

/**
 * La página del iframe: dibuja UN widget de Gadsden con su Liquid, su CSS y su JS originales, y habla con el script de
 * NubeSDK por postMessage.
 *
 * - La configuración llega en el hash: `#<JSON>` con { seccion | bloque, estilo, producto, moneda }.
 * - Avisa el alto con { type: "resize", height } (el Iframe de NubeSDK con `autoresize` lo aplica).
 * - "Agregar al carrito" (fetch a /cart/add o un form de producto) sale como { gadsden: "agregar", items }.
 * - Los links de la tienda salen como { gadsden: "ir", url } (en el iframe navegarían el iframe); `href="#"`, como
 *   { gadsden: "arriba" }.
 * - Escucha { gadsden: "variante", id } para dibujar de nuevo con la variante elegida en la ficha.
 * - Los popups (`showModal`) salen como { gadsden: "modal", dialogo, camino }: el script abre otro iframe en el lugar
 *   `modal_content` (con `modal` en la configuración), que muestra sólo ese popup y avisa { gadsden: "cerrar-modal" }.
 */
import { crearMotor, imagen } from "./motor.ts";
import { altoDePantalla, conAnchoDePantalla, instalarVentana, medir, sinVh as soloVh } from "./ventana.ts";
import { armarBloque, armarSeccion, esquemaDe, type ConfigSeccion, type Esquema } from "./seccion.ts";
import { ajustesLiquid, ajustesTienda, atributosHtml, cssTema, urlCaras, urlLetras, type Tema } from "./tema.ts";
import { TEXTOS } from "./textos.ts";
import { metafieldsLiquid, productoLiquid, type ProductoTN } from "./producto.ts";

type Config = {
  seccion?: ConfigSeccion;
  /** Las secciones de estilo de página que comparten todos los widgets de la página. */
  pagina?: ConfigSeccion[];
  bloque?: { type: string; settings?: Record<string, unknown> };
  /** "tienda" (por defecto: los colores y la letra de `tema`), "clasico" o "oscuro". */
  estilo?: "tienda" | "clasico" | "oscuro";
  /** Los colores y la letra de la tienda, que carga el comerciante (estilo "tienda"). */
  tema?: Tema;
  producto?: ProductoTN;
  variante?: number;
  moneda?: { simbolo: string; codigo: string };
  /** Dónde están las imágenes y videos que el Liquid pide con asset_url (son de la tienda: Gadsden no trae ninguno). */
  assets?: string;
  depurar?: boolean;
  /** El lugar fijo de NubeSDK donde va el widget (corner_*, edge_*), si es uno de esos. */
  fijo?: string;
  /** El ancho de la pantalla según NubeSDK (de la página de la tienda; en un iframe de otro dominio outerWidth puede no serlo). */
  anchoPantalla?: number;
  /** El id de la tienda: con él, el Worker trae otros productos y metacampos (src/api.ts). */
  tienda?: number;
  /** Desde cuándo corre la página de la tienda (ms desde 1970): las animaciones sin fin van en esa fase. */
  inicio?: number;
  /** Secciones que se dibujan en el mismo iframe, después de la del widget: las dos que junta gad-merge. */
  junto?: ConfigSeccion[];
  /** El iframe del popup (lugar `modal_content`): qué `<dialog>` abrir y el toque que lo abrió en el del widget. */
  modal?: { dialogo: number; camino: number[] | null };
  /** La vista previa del panel: la pantalla que simula (computadora o celular), en lugar de la del admin. */
  pantalla?: { ancho: number; alto: number };
};
type Fuentes = {
  secciones: Record<string, string>; snippets: Record<string, string>; textos: Record<string, unknown>;
  ajustes: { defaults: Record<string, unknown>; oscuro: Record<string, unknown>; clasico: Record<string, unknown> };
  /** Lo que el estilo "oscuro" pone en cada sección que tiene colores y letras propios (src/w/oscuro.json). */
  oscuro: Record<string, Record<string, unknown>>;
  bloques: Esquema["blocks"];
};

const avisar = (m: unknown) => window.parent.postMessage(m, "*");
const cfg: Config = JSON.parse(decodeURIComponent(location.hash.slice(1) || "{}"));
// Los @media, los vh y los lugares fijos se resuelven contra la pantalla de la tienda (outerWidth, screen); en la vista
// previa del panel, contra la que se simula.
if (cfg.pantalla) {
  const { ancho, alto } = cfg.pantalla;
  for (const [o, k, v] of [[window, "outerWidth", ancho], [window, "outerHeight", alto], [screen, "width", ancho], [screen, "availWidth", ancho], [screen, "height", alto], [screen, "availHeight", alto]] as const) {
    Object.defineProperty(o, k, { get: () => v, configurable: true });
  }
}
/** Los vh y los @media de ancho, a la pantalla de la tienda (ventana.ts). */
const sinVh = (t: string) => conAnchoDePantalla(soloVh(t));
// En un lugar fijo de NubeSDK (corner_*, edge_*) el iframe ya está quieto en la pantalla: no hace falta la ventana
// virtual, el fondo es transparente y el iframe mide lo que ocupan sus elementos fijos (ver abajo).
// Un bloque de la ficha no tiene fondo propio: se ve sobre la columna de la tienda.
if (cfg.bloque) document.body.classList.remove("gradient");
// El iframe de un popup va en el diálogo de NubeSDK (modal_content, 90 % de la pantalla, con su fondo oscuro y su ×):
// se ve sólo el <dialog>, sin fondo propio, y el iframe mide lo que el popup (abrirPopup).
if (cfg.modal) {
  document.documentElement.classList.add("gad-solo-popup");
  document.head.append(Object.assign(document.createElement("style"), { textContent: "html.gad-solo-popup, html.gad-solo-popup body { background: transparent; overflow: hidden; } html.gad-solo-popup #raiz { visibility: hidden; } html.gad-solo-popup dialog { visibility: visible; } html.gad-solo-popup dialog::backdrop { background: transparent; }" }));
}
if (cfg.fijo || cfg.modal) {
  document.body.classList.remove("gradient");
  document.documentElement.style.setProperty("--gad-vh", `${(outerHeight || screen.availHeight || 800) / 100}px`);
} else instalarVentana();
const base = new URL(".", location.href).href;

/* ---------- Lo que en Shopify pone el theme (Dawn) y gadsden.js da por sentado, escrito de nuevo ---------- */
const w = window as unknown as Record<string, unknown>;
w.PUB_SUB_EVENTS = { cartUpdate: "cart-update", quantityUpdate: "quantity-update", optionValueSelectionChange: "option-value-selection-change", variantChange: "variant-change", cartError: "cart-error" };
const suscriptos = new Map<string, Set<(d: unknown) => void>>();
w.subscribe = (ev: string, f: (d: unknown) => void) => { (suscriptos.get(ev) ?? suscriptos.set(ev, new Set()).get(ev)!).add(f); return () => suscriptos.get(ev)?.delete(f); };
w.publish = (ev: string, d: unknown) => { suscriptos.get(ev)?.forEach((f) => f(d)); return Promise.resolve(); };
w.fetchConfig = (tipo = "json") => ({ method: "POST", headers: { "Content-Type": "application/json", Accept: `application/${tipo}` } });
w.routes = { cart_add_url: "/cart/add", cart_change_url: "/cart/change", cart_update_url: "/cart/update", cart_url: "/cart", predictive_search_url: "/search/suggest" };
w.cartStrings = { error: "Hubo un error al agregar al carrito.", quantityError: "No se puede agregar más." };
w.Shopify = { routes: { root: "/" }, designMode: false, currency: { active: cfg.moneda?.codigo ?? "ARS", rate: "1.0" } };

/** De qué producto es cada variante: la de la ficha y las de los otros productos (cart:add pide los dos). */
const productoDeVariante = new Map<number, number>(cfg.producto?.variantes.map((v) => [v.id, cfg.producto!.id]) ?? []);
/** El carrito: lo que el widget manda a /cart/add sale al script de NubeSDK, que lo agrega con cart:add. */
function itemsDe(cuerpo: unknown): { variant_id: number; product_id?: number; quantity: number; properties?: unknown }[] {
  const con = (variant_id: number, quantity: number, properties?: unknown) => ({ variant_id, product_id: productoDeVariante.get(variant_id), quantity, properties });
  if (cuerpo instanceof FormData) {
    // Como lo manda el formulario de Shopify: `id` y `quantity`, o `items[n][id]` (una oferta con unidades de distintas
    // variantes), y las propiedades del ítem como `properties[Nombre]`.
    const props = Object.fromEntries([...cuerpo].filter(([k, v]) => /^properties\[/.test(k) && v !== "").map(([k, v]) => [k.slice(11, -1), String(v)]));
    const conProps = Object.keys(props).length ? props : undefined;
    const varios = [...cuerpo.keys()].filter((k) => /^items\[\d+\]\[id\]$/.test(k));
    if (varios.length) return varios.map((k) => con(Number(cuerpo.get(k)), Number(cuerpo.get(k.replace("[id]", "[quantity]")) ?? 1) || 1, conProps));
    return [con(Number(cuerpo.get("id")), Number(cuerpo.get("quantity") ?? 1) || 1, conProps)];
  }
  try {
    const j = typeof cuerpo === "string" ? JSON.parse(cuerpo) : cuerpo;
    const xs = (j?.items ?? [j]) as { id: number; quantity?: number; properties?: unknown }[];
    return xs.filter((x) => x && x.id).map((x) => con(Number(x.id), Number(x.quantity ?? 1) || 1, x.properties));
  } catch { return []; }
}
/**
 * El cajón del carrito: gadsden.js, después de agregar, dibuja el cajón si existe y si no manda la página a /cart (en el
 * iframe, lo rompería). Acá hay uno vacío: el cajón de verdad es el carrito de Tiendanube, que abre el script.
 * Con "ir directo al pago" (data-skip-cart) el pedido sale marcado y el script va al checkout.
 */
customElements.define("cart-drawer", class extends HTMLElement {
  getSectionsToRender() { return []; }
  renderContents() {}
  setActiveElement() {}
});
document.addEventListener("DOMContentLoaded", () => document.body.append(Object.assign(document.createElement("cart-drawer"), { hidden: true })));
let alPago = false;
document.addEventListener("click", (e) => { alPago = !!(e.target as Element).closest?.("[data-skip-cart='true']"); }, true);
const fetchOriginal = window.fetch.bind(window);
window.fetch = async (url: RequestInfo | URL, op?: RequestInit) => {
  const ruta = new URL(String(url instanceof Request ? url.url : url), location.href).pathname;
  if (/\/cart\/add(\.js)?$/.test(ruta)) {
    const items = itemsDe(op?.body);
    avisar({ gadsden: "agregar", items, ...(alPago && { pago: true }) });
    return new Response(JSON.stringify({ items, item_count: items.length, sections: {} }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (/\/cart(\.js)?$/.test(ruta) && !op?.method) return new Response(JSON.stringify({ items: [], item_count: 0, total_price: 0 }), { headers: { "Content-Type": "application/json" } });
  return fetchOriginal(url, op);
};
/**
 * La compra del botón del theme (bloques de la ficha): lo que mandaría el formulario de compra de Shopify con lo que
 * eligió el comprador en el bloque (la oferta, sus unidades, un campo). Se avisa al script cada vez que cambia
 * ({ gadsden: "compra" }); cuando el theme agrega el producto, el script completa la diferencia. Se arma como al
 * enviar el formulario (gad-product.js agrega las unidades de la oferta en ese momento), sin enviarlo.
 */
let informando = false, informar = 0;
const formCompra = () => (cfg.bloque ? document.getElementById("product-form-main") as HTMLFormElement | null : null);
function informarCompra() {
  clearTimeout(informar);
  informar = window.setTimeout(() => {
    const f = formCompra();
    if (!f) return;
    informando = true;
    f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }, 50);
}
document.addEventListener("submit", (e) => {
  const f = e.target as HTMLFormElement;
  if (informando && f === formCompra()) {
    informando = false;
    e.preventDefault();
    // Después de los otros que escuchan el envío (gad-product.js pone las unidades y las saca en el tick siguiente).
    setTimeout(() => {
      const items = itemsDe(new FormData(f));
      const propiedades = (items[0]?.properties ?? {}) as Record<string, string>;
      avisar({ gadsden: "compra", items: items.map(({ variant_id, quantity }) => ({ variant_id, quantity })), propiedades, oferta: !!document.querySelector("gad-quantity-offers") });
    }, 0);
    return;
  }
  // El formulario del popup promocional (gad-promo-popup): en Tiendanube el email no tiene a dónde ir (la app no crea
  // clientes ni guarda datos de compradores). En Shopify, al volver de suscribirse, el popup muestra el éxito con el
  // cupón; acá se muestra al enviar, sin mandar nada.
  const oferta = f.closest<HTMLElement>("[data-gad-promo-offer]");
  if (oferta) {
    e.preventDefault();
    const exito = oferta.parentElement?.querySelector<HTMLElement>("[data-gad-promo-success]");
    if (exito) { oferta.hidden = true; exito.hidden = false; }
    return;
  }
  // Los otros formularios de Shopify (suscripción de clientes, contacto) no tienen a dónde ir en Tiendanube: enviados,
  // recargarían el iframe sin su configuración.
  if (!/\/cart\/add/.test(f.getAttribute("action") ?? "")) { if (f.getAttribute("action") === "#") e.preventDefault(); return; }
  e.preventDefault();
  setTimeout(() => avisar({ gadsden: "agregar", items: itemsDe(new FormData(f)) }), 0);
}, true);
document.addEventListener("click", (e) => {
  const a = (e.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a || a.target === "_blank") return;
  // `href="#"` en la tienda sube al principio de la página: lo hace el script (scrollTo). Las otras anclas, en el iframe.
  if (a.getAttribute("href") === "#") { e.preventDefault(); avisar({ gadsden: "arriba" }); return; }
  if (a.getAttribute("href")?.startsWith("#")) return;
  e.preventDefault();
  avisar({ gadsden: "ir", url: a.href });
});

/**
 * Las navegaciones que hace el JS (`location.href = ...`): en el iframe moverían el iframe. Las rutas de la tienda van al
 * script (`ir`; el checkout lo maneja "ir directo al pago"); las de afuera (un rastreador de envíos) navegan la página de
 * arriba, o abren otra pestaña si el navegador no lo deja. Sin la Navigation API (Safari viejo) no se puede atajar.
 */
const navegacion = (window as unknown as { navigation?: EventTarget }).navigation;
navegacion?.addEventListener("navigate", (ev) => {
  const e = ev as Event & { destination: { url: string }; hashChange: boolean; cancelable: boolean; downloadRequest: string | null };
  if (e.hashChange || !e.cancelable || e.downloadRequest !== null) return;
  const u = new URL(e.destination.url);
  e.preventDefault();
  if (u.origin === location.origin) { if (!/^\/checkout/.test(u.pathname)) avisar({ gadsden: "ir", url: u.href }); return; }
  try { window.top!.location.href = u.href; } catch (err) { console.warn("[Gadsden]", String(err)); window.open(u.href, "_blank", "noopener"); }
});

/**
 * Los popups: un iframe de NubeSDK no puede tapar la página. En el del widget, `showModal` no abre: pide al script el
 * iframe del popup (lugar `modal_content`) con qué `<dialog>` es y el toque que lo abrió (el camino desde el <body>),
 * si fue un toque de recién. Ese iframe dibuja el mismo widget y repite el toque: el JS del widget arma el popup igual.
 */
const caminoDe = (el: Element) => {
  const c: number[] = [];
  for (let e: Element | null = el; e && e !== document.body && e.parentElement; e = e.parentElement) c.unshift([...e.parentElement.children].indexOf(e));
  return c;
};
const porCamino = (c: number[]) => c.reduce<Element | undefined>((e, i) => e?.children[i], document.body);
const dialogos = () => [...document.querySelectorAll<HTMLDialogElement>("#raiz dialog")];
if (!cfg.modal) {
  let toque: { camino: number[]; cuando: number } | null = null;
  document.addEventListener("click", (e) => { if (e.target instanceof Element) toque = { camino: caminoDe(e.target), cuando: performance.now() }; }, true);
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    const camino = toque && performance.now() - toque.cuando < 1000 ? toque.camino : null;
    avisar({ gadsden: "modal", dialogo: dialogos().indexOf(this), camino });
  };
  // Cerrado el popup, el widget se entera como si se hubiera cerrado el suyo (para sus temporizadores).
  window.addEventListener("message", (e) => {
    const d = e.data as { gadsden?: string; dialogo?: number } | null;
    if (d?.gadsden === "cerrado") dialogos()[d.dialogo ?? -1]?.dispatchEvent(new Event("close"));
  });
}
/** En el iframe del popup: repite el toque (o, si lo abrió un temporizador, lo abre) y avisa cuando se cierra. */
function abrirPopup() {
  const { dialogo, camino } = cfg.modal!;
  const d = dialogos()[dialogo];
  if (!d) return avisar({ gadsden: "cerrar-modal" });
  d.addEventListener("close", () => avisar({ gadsden: "cerrar-modal" }));
  const t = camino && porCamino(camino);
  if (t instanceof HTMLElement) t.click();
  setTimeout(() => { if (!d.open) d.showModal(); }, t ? 0 : 1500);
  // El alto es el del popup (medido en la tienda el 24-oct: el diálogo es de 90vw × 90vh).
  // Sin ancho, el iframe vuelve a 300 px: el del diálogo, desde la ventana de la tienda (outerWidth la incluye con su borde).
  const ancho = Math.round(Math.min(outerWidth || screen.width, cfg.anchoPantalla || Infinity) * 0.9) - 40;
  new ResizeObserver(() => avisar({ type: "resize", width: ancho, height: Math.ceil(d.getBoundingClientRect().height) })).observe(d);
}

/* ---------- El dibujo ---------- */

/** Las animaciones al aparecer (scroll-trigger), como en el theme: escrito de nuevo sobre las clases de gadsden.css. */
function revelar(raiz: ParentNode) {
  const xs = [...raiz.querySelectorAll<HTMLElement>(".scroll-trigger")];
  if (!xs.length) return;
  const io = new IntersectionObserver((es) => {
    for (const e of es) {
      if (!e.isIntersecting) continue;
      const el = e.target as HTMLElement;
      el.classList.remove("scroll-trigger--offscreen");
      if (document.documentElement.dataset.gadRevealRepeat !== "true") io.unobserve(el);
    }
  }, { rootMargin: "0px 0px -50px 0px" });
  for (const el of xs) { el.classList.add("scroll-trigger--offscreen"); io.observe(el); }
}

/** Ejecuta los <script> que vinieron en el HTML (innerHTML no los corre). */
async function correrScripts(raiz: ParentNode) {
  for (const viejo of [...raiz.querySelectorAll("script")]) {
    const nuevo = document.createElement("script");
    for (const a of viejo.attributes) nuevo.setAttribute(a.name, a.value);
    nuevo.textContent = viejo.textContent;
    const listo = nuevo.src ? new Promise((r) => { nuevo.onload = nuevo.onerror = r; }) : null;
    viejo.replaceWith(nuevo);
    if (listo) await listo;
  }
}
const cargarScript = (src: string) => new Promise((r) => { const s = document.createElement("script"); s.src = src; s.onload = s.onerror = r; document.body.append(s); });

let fuentes: Fuentes;
let variante = cfg.variante;

/**
 * Los otros productos (por handle) y los metacampos: los trae el Worker con la API de la tienda (src/api.ts). Se dibuja
 * una vez anotando lo que pide el Liquid; si pidió algo que falta, se trae y se dibuja de nuevo.
 */
type Metacampos = Record<string, Record<string, string>>;
type ProductoConMetacampos = ProductoTN & { metacampos?: Metacampos };
const otros = new Map<string, ProductoConMetacampos>();
const pedidos = new Set<string>(), traidos = new Set<string>();
let metas: Metacampos | null = null, pideMetas = false;
/** Lo que LiquidJS (o JS) le pregunta a un objeto y no es un handle ni un namespace. */
const NO_SON_CLAVES = new Set(["toLiquid", "liquidMethodMissing", "then", "toJSON", "size", "first", "last"]);

async function traerFaltantes() {
  const handles = [...pedidos].filter((h) => !traidos.has(h));
  const conMetas = pideMetas && metas === null && !!cfg.producto;
  if (!cfg.tienda || (!handles.length && !conMetas)) return false;
  for (const h of handles) traidos.add(h);
  const q = new URLSearchParams();
  if (handles.length) q.set("handles", handles.join(","));
  if (conMetas) q.set("metacampos", String(cfg.producto!.id));
  if (conMetas) metas = {};
  try {
    const r = await fetch(new URL(`../productos/${cfg.tienda}?${q}`, base));
    if (!r.ok) return false;
    const j = (await r.json()) as { productos: ProductoConMetacampos[]; metacampos?: Metacampos };
    for (const p of j.productos) { otros.set(p.handle, p); for (const v of p.variantes) productoDeVariante.set(v.id, p.id); }
    if (conMetas) metas = j.metacampos ?? {};
    return true;
  } catch { return false; }
}

/**
 * Las fuentes del Liquid que usa este iframe (construir.mjs las parte): la común y la de su sección, las que une
 * (`junto`) y las de página, o la de su bloque; cada una trae los snippets que pide.
 */
async function traerFuentes(): Promise<Fuentes> {
  const tipos = new Set([cfg.seccion, ...(cfg.junto ?? []), ...(cfg.pagina ?? [])].filter((c): c is ConfigSeccion => !!c).map((c) => c.type));
  const partes = [...[...tipos].map((t) => `secciones/${encodeURIComponent(t)}`), ...(cfg.bloque ? [`bloques/${encodeURIComponent(cfg.bloque.type)}`] : [])];
  const [comun, ...resto] = await Promise.all(["comun", ...partes].map(async (f) => {
    const r = await fetch(`${base}fuentes/${f}.json`);
    return (r.ok ? r.json() : {}) as Promise<Partial<Fuentes>>;
  }));
  const juntar = <K extends "secciones" | "snippets" | "oscuro">(k: K) => Object.assign({}, ...resto.map((x) => x[k])) as Fuentes[K];
  return { ...(comun as Fuentes), secciones: juntar("secciones"), snippets: juntar("snippets"), oscuro: juntar("oscuro"), bloques: resto.flatMap((x) => x.bloques ?? []) };
}

async function dibujar(primera: boolean) {
  fuentes ??= await traerFuentes();
  const estilo = cfg.estilo === "clasico" ? "clasico" : cfg.estilo === "oscuro" ? "oscuro" : "tienda";
  const settings = ajustesLiquid(fuentes.ajustes.defaults, estilo === "tienda" ? ajustesTienda(fuentes.ajustes.clasico, cfg.tema) : fuentes.ajustes[estilo]);
  const reducir = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (primera) {
    const { clases, datos } = atributosHtml(settings, reducir);
    document.documentElement.classList.add(...clases);
    Object.assign(document.documentElement.dataset, datos);
    const letras = document.createElement("link");
    const url = urlLetras(settings);
    letras.rel = "stylesheet"; letras.href = url;
    // Como el preload de theme.liquid: la letra del cuerpo y la de los títulos se piden ya, no cuando aparece el texto.
    letras.onload = () => {
      for (const l of [settings.type_body_font, settings.type_header_font] as { family: string; style: string; weight: number }[]) void document.fonts.load(`${l.style} ${l.weight} 1em "${l.family}"`);
    };
    // Con la letra del sistema no hay nada que pedir.
    if (url) document.head.append(letras);
    // El orden de theme.liquid: los {% stylesheet %} de las secciones (van en content_for_header), el estilo del
    // tema (variables y esquemas de color), base.css y gadsden.css. Los vh, pasados a la pantalla (ventana.ts).
    const estilos = document.createElement("style");
    estilos.id = "gad-estilos";
    const tema = document.createElement("style");
    tema.textContent = cssTema(settings);
    document.head.append(estilos, tema);
    for (const hoja of ["base.css", "gadsden.css", "gad-product.css"]) {
      const st = document.createElement("style");
      st.textContent = sinVh(await (await fetch(`${base}a/${hoja}`)).text());
      document.head.append(st);
    }
  }
  const { dibujar: render, liquid } = crearMotor({ secciones: fuentes.secciones, snippets: fuentes.snippets, textos: { ...TEXTOS, ...fuentes.textos } }, cfg.moneda ?? { simbolo: "$", codigo: "ARS" }, `${base}a/`, cfg.assets);
  const armar = async () => {
    // Los metacampos de la ficha, si ya llegaron; si no, se anota si el Liquid los pide.
    const anotar = new Proxy({}, { get: (_, k) => { if (typeof k === "string" && !NO_SON_CLAVES.has(k)) pideMetas = true; return undefined; } });
    const ficha = cfg.producto;
    const product = ficha ? productoLiquid(ficha, variante, metas ? metafieldsLiquid(metas) : anotar) : undefined;
    const conocidos = new Map<string, unknown>(ficha ? [[ficha.handle, product]] : []);
    const buscar = (h: string) => {
      if (!conocidos.has(h)) {
        const o = otros.get(h);
        if (!o) { pedidos.add(h); return null; }
        conocidos.set(h, productoLiquid(o, undefined, metafieldsLiquid(o.metacampos ?? {})));
      }
      return conocidos.get(h);
    };
    const contexto: Record<string, unknown> = {
      // all_products[handle]: el de la ficha, uno que trajo el Worker o, si no se pudo traer, el de la ficha.
      settings, product, all_products: new Proxy({}, { get: (_, h) => (typeof h !== "string" || NO_SON_CLAVES.has(h) ? undefined : buscar(h) ?? product) }), request: { design_mode: false, page_type: "product", locale: { iso_code: "es" }, host: location.host },
      routes: w.routes, shop: { money_format: "${{amount_with_comma_separator}}", currency: cfg.moneda?.codigo ?? "ARS" },
      cart: { item_count: 0, items: [], total_price: 0 }, localization: { available_languages: [] },
    };
    // Las fuentes dinámicas de los ajustes ("{{ product.metafields.custom.x.value }} vendidos"): Shopify las evalúa
    // antes de dibujar la sección. Una imagen de un campo personalizado llega como imagen("{{ … }}") (src/w/seccion.ts).
    const fuentesDinamicas = async (ajustes: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(ajustes)) {
        if (typeof v === "string" && v.includes("{{")) ajustes[k] = await liquid.parseAndRender(v, contexto);
        else if (v && typeof v === "object" && "src" in v && String(v.src).includes("{{")) {
          const src = (await liquid.parseAndRender(String(v.src), contexto)).trim();
          ajustes[k] = src ? imagen(src) : "";
        }
      }
    };
    const seccion = async (c: ConfigSeccion, id: string) => {
      const fuente = fuentes.secciones[c.type] ?? "";
      const section = armarSeccion(id, fuente, c, true, buscar, estilo === "oscuro" ? fuentes.oscuro[c.type] : undefined);
      for (const x of [section, ...section.blocks]) await fuentesDinamicas(x.settings);
      const s = await render(c.type, fuente, { ...contexto, section });
      // Como Shopify: la envoltura con el tag y la clase que pide el schema.
      const { tag = "div", class: clase = "" } = esquemaDe(fuente) as { tag?: string; class?: string };
      s.html = `<${tag} id="shopify-section-${section.id}" class="shopify-section ${clase}">${s.html}</${tag}>`;
      return s;
    };
    // Las secciones de página (gad-page-style, gad-landing-skin) cambian el aspecto de todas las demás: van, ocultas,
    // delante del widget en cada iframe de la página, como arriba del template en Shopify.
    const deLaPagina = await Promise.all((cfg.pagina ?? []).map((c, i) => seccion(c, `template--gadsden__${c.clave ?? `pagina-${i + 1}`}`)));
    let salida;
    if (cfg.seccion) {
      salida = await seccion(cfg.seccion, `template--gadsden__${cfg.seccion.clave ?? cfg.seccion.type}`);
      // Las secciones que une gad-merge, en la misma página que la unión (su JS las busca por el ancla y las mueve).
      for (const [i, c] of (cfg.junto ?? []).entries()) {
        const j = await seccion(c, `template--gadsden__${c.clave ?? `junto-${i + 1}`}`);
        salida.html += j.html; salida.css.push(...j.css); salida.js.push(...j.js); salida.letras.push(...j.letras);
      }
    } else if (cfg.bloque) {
      // Un bloque de la ficha (gad-product-block): se dibuja dentro de la columna de info del producto.
      const block = armarBloque(cfg.bloque, fuentes.bloques, buscar);
      await fuentesDinamicas(block.settings);
      const section = { id: "template--gadsden__main", settings: {}, blocks: [block] };
      // Un bloque propio (construir.mjs) trae su snippet gad-block-<tipo>; los de Gadsden van por gad-product-block.
      const plantilla = `gad-block-${block.type}` in fuentes.snippets ? `gad-block-${block.type}` : "gad-product-block";
      salida = await render(plantilla, `{%- render '${plantilla}', block: block, product: product, section: section, product_form_id: 'product-form-main' -%}`, { ...contexto, block, section });
      salida.html = `<div id="shopify-section-${section.id}" class="shopify-section"><div class="product__info-container"><form id="product-form-main" action="/cart/add" method="post" data-type="add-to-cart-form"><input type="hidden" name="id" value="${product?.selected_or_first_available_variant?.id ?? ""}"><input type="hidden" name="quantity" value="1"></form>${salida.html}${cfg.fijo ? `<div id="ProductSubmitButton-${section.id}" hidden></div>` : ""}</div></div>`;
    } else return null;
    return { deLaPagina, salida };
  };
  let armado = await armar();
  if (armado && (await traerFaltantes())) armado = await armar();
  if (!armado) return;
  const { deLaPagina, salida } = armado;

  // Para herramientas/lado.mjs (PRESET=1): el HTML tal como sale del Liquid, antes de que corra el JS, y sus
  // {% stylesheet %} y {% javascript %}.
  if (cfg.depurar) avisar({ gadsden: "html", html: salida.html, css: salida.css, js: salida.js });
  // Las letras que pidieron las secciones con font_face (gad-page-style): de Google Fonts, como las del theme.
  if (salida.letras.length) {
    const caras = new Map<string, Set<string>>();
    for (const x of salida.letras) { const [f, c] = x.split("|") as [string, string]; (caras.get(f) ?? caras.set(f, new Set()).get(f)!).add(c); }
    const l = (document.getElementById("gad-letras") as HTMLLinkElement | null) ?? Object.assign(document.head.appendChild(document.createElement("link")), { id: "gad-letras", rel: "stylesheet" });
    l.href = urlCaras(caras);
  }
  salida.css.unshift(...deLaPagina.flatMap((s) => s.css));
  salida.js.unshift(...deLaPagina.flatMap((s) => s.js));
  document.getElementById("gad-estilos")!.textContent = sinVh(salida.css.join("\n"));
  if (deLaPagina.length) {
    let p = document.getElementById("pagina");
    if (!p) { p = document.createElement("div"); p.id = "pagina"; p.hidden = true; document.body.prepend(p); }
    p.innerHTML = sinVh(deLaPagina.map((s) => s.html).join(""));
  }
  const raiz = document.getElementById("raiz")!;
  raiz.innerHTML = sinVh(salida.html);
  // La cantidad del formulario de compra: la de un bloque (la oferta, `form=`) si la trae, como en Shopify.
  if (raiz.querySelector('[form="product-form-main"][name="quantity"]')) raiz.querySelector('#product-form-main > input[name="quantity"]')?.remove();
  // Un popup que abrió un temporizador (gad-promo-popup): la espera ya pasó en el iframe del widget.
  if (cfg.modal && !cfg.modal.camino) dialogos()[cfg.modal.dialogo]?.closest("[data-seconds]")?.setAttribute("data-seconds", "0");
  await correrScripts(raiz);
  if (primera) {
    await cargarScript(`${base}a/gadsden.js`);
    await cargarScript(`${base}a/gad-product.js`);
    for (const codigo of salida.js) { const s = document.createElement("script"); s.textContent = codigo; document.body.append(s); }
    document.dispatchEvent(new Event("DOMContentLoaded"));
  }
  revelar(raiz);
  pedirLetras();
  // Ya con el JS del widget corriendo (algunas marquesinas arman su animación después de medir), y cada vez que el
  // iframe entra en pantalla: fuera de pantalla Chrome frena su tiempo y las animaciones se atrasan.
  setTimeout(() => alinearFases(true), 300);
  if (primera) new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) alinearFases(); }).observe(raiz);
  // La barra fija aparece cuando el botón de comprar quedó arriba de la pantalla. En Tiendanube ese botón es del theme y
  // el iframe no lo ve: lo mira el centinela (src/w/centinela.html) y el script lo pasa; hasta que avise, se hace de
  // cuenta que termina al final de la primera pantalla (con el scroll que manda el script).
  const ancla = cfg.fijo ? document.querySelector<HTMLElement>("[id^='ProductSubmitButton-']") : null;
  // Con el centinela (el script manda `botonArriba`), cuando el botón de verdad salió por arriba de la pantalla.
  if (ancla) ancla.getBoundingClientRect = () => pagina.botonArriba === undefined ? new DOMRect(0, (pagina.viewportHeight || outerHeight) - pagina.scrollY - 50, 0, 50) : new DOMRect(0, pagina.botonArriba ? -51 : 0, 0, 50);
}

/**
 * Las animaciones sin fin (marquesinas, flotaciones, pulsos) corren en la tienda desde que cargó la página; en el iframe,
 * desde que cargó el iframe. Se las adelanta al tiempo de la página, como si hubieran arrancado con ella.
 */
const conLaPagina = new Set<Animation>();
function alinearFases(nuevas = false) {
  if (!cfg.inicio) return;
  // Sólo las que existen al dibujar: las que arrancan al verse (gad-closing, al entrar en pantalla) también arrancan
  // al verse en la tienda.
  if (nuevas) for (const a of document.getAnimations()) if (a instanceof CSSAnimation && a.effect?.getTiming().iterations === Infinity) conLaPagina.add(a);
  const t = Date.now() - cfg.inicio;
  for (const a of conLaPagina) if (t > 0 && a.playState !== "idle") a.currentTime = t;
}

/**
 * Chrome no dibuja un iframe de otro origen fuera de pantalla: las letras que usa el widget recién se piden cuando se ve,
 * y mientras cargan el texto ocupa otra cosa (los IntersectionObserver ven posiciones que después cambian). Se piden ya
 * todas las de la página, sólo los juegos latinos, a medida que llegan las hojas (las de las secciones de página, también).
 */
function pedirLetras() {
  const pedir = () => document.fonts.forEach((f) => { if (f.status === "unloaded" && /U\+0(000)?-0*FF\b/i.test(f.unicodeRange)) void f.load(); });
  pedir();
  for (const l of document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) l.addEventListener("load", pedir);
}

/* El alto: cada vez que cambia, al host (autoresize del Iframe de NubeSDK). Como mínimo 1 px: NubeSDK no aplica un alto
   de 0 y un widget vacío (una Imagen sin imagen) quedaba con los 150 px de fábrica de un iframe (lgademo, 25-oct). */
let ultimo = 0, rehacer = 0;
new ResizeObserver(() => {
  if (cfg.fijo) return medirFijo();
  if (cfg.modal) return;
  const h = Math.max(1, Math.ceil(document.getElementById("raiz")!.getBoundingClientRect().height));
  if (h !== ultimo) { ultimo = h; avisar({ type: "resize", height: h }); clearTimeout(rehacer); rehacer = window.setTimeout(medir, 300); }
}).observe(document.getElementById("raiz")!);

/**
 * En un lugar fijo, el tamaño del iframe es lo que ocupan sus elementos `position: fixed` desde el borde donde está el
 * lugar: en uno de abajo, del borde de abajo al tope del elemento; en uno de la izquierda, hasta su borde derecho (un
 * botón a 20 px de la esquina pide su ancho y su alto más 20). Esas medidas no cambian cuando el iframe crece. Lo que va
 * de lado a lado o centrado pide el ancho de la pantalla: el lugar lo corta en su máximo (#484). El lugar se ajusta al
 * contenido.
 */
let fijoAnterior = "";
function medirFijo() {
  const lugar = cfg.fijo!;
  // El tamaño del iframe (innerHeight puede ser el de la página: lo pone el scroll que manda el script).
  const ancho = document.documentElement.clientWidth, alto = document.documentElement.clientHeight;
  // Los vw del lugar son de la ventana de la tienda, no del monitor (outerWidth la da desde el iframe; en un celular es
  // lo mismo, en una computadora con la ventana achicada no): con screen.width la barra fija salía cortada.
  const ventana = Math.min(outerWidth || screen.width, cfg.anchoPantalla || Infinity);
  let w = 0, h = 0;
  for (const e of document.querySelectorAll<HTMLElement>("#raiz *, body > gad-sticky-bar")) {
    const cs = getComputedStyle(e);
    if (cs.position !== "fixed" || cs.display === "none" || cs.visibility === "hidden") continue;
    // Lo que entra y sale deslizándose (la barra fija): oculto, no ocupa (no tapa la tienda); al aparecer, el lugar entero
    // desde el principio del deslizamiento (se mira adónde va la transición, no dónde está).
    const t = e.getAnimations().find((a) => a instanceof CSSTransition && a.transitionProperty === "transform") as CSSTransition | undefined;
    const kf = (t?.effect as KeyframeEffect | null)?.getKeyframes();
    const destino = String(kf?.[kf.length - 1]?.transform ?? cs.transform);
    const r = e.getBoundingClientRect();
    const fuera = r.bottom <= 0 || r.top >= alto || r.right <= 0 || r.left >= ancho;
    if (destino !== "none" && !/^matrix\(1, 0, 0, 1, 0, 0\)$/.test(destino) && fuera) continue;
    // La caja sin la transformación (offset*: en un elemento fijo, contra el iframe).
    const caja = { top: e.offsetTop, left: e.offsetLeft, width: e.offsetWidth, height: e.offsetHeight };
    if (!caja.width || !caja.height) continue;
    const abajo = alto - caja.top, derecha = ancho - caja.left;
    h = Math.max(h, lugar.includes("bottom") ? abajo : lugar.includes("top") ? caja.top + caja.height : caja.height);
    // Lo que va de lado a lado o centrado (un popup) mide según el ancho del iframe: pide el de la pantalla.
    const centrado = ancho > 0 && (caja.width >= ancho - 1 || Math.abs(caja.left - (ancho - caja.left - caja.width)) <= 2);
    w = Math.max(w, centrado ? ventana : lugar.endsWith("left") ? caja.left + caja.width : lugar.endsWith("right") ? derecha : caja.width);
  }
  // Sin pasarse del máximo del lugar (#484): esquinas y bordes de los costados, 45vw; arriba y abajo, 80vw y 45vh.
  const angosto = lugar.startsWith("corner_") || /edge_(left|right)/.test(lugar);
  w = Math.min(w, ventana * (angosto ? 0.45 : 0.8));
  if (!lugar.startsWith("corner_")) h = Math.min(h, (outerHeight || screen.availHeight) * (angosto ? 0.8 : 0.45));
  const t = `${Math.ceil(w)}x${Math.ceil(h)}`;
  if (t !== fijoAnterior) { fijoAnterior = t; avisar({ type: "resize", width: Math.ceil(w), height: Math.ceil(h) }); }
}
if (cfg.fijo) {
  // Con setTimeout y no con cuadros: un iframe de 0 px de alto no recibe requestAnimationFrame (Chrome lo da por oculto).
  const medirYa = () => setTimeout(medirFijo, 0);
  const mo = new MutationObserver(medirYa);
  // La barra fija se muda al final del <body> (gad-product.js): se mira todo el documento.
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "open", "hidden"] });
  for (const ev of ["transitionrun", "transitionend", "animationend"]) document.addEventListener(ev, medirYa);
}

/**
 * El scroll de la página, del script (page:scroll, cada 10 %). En un lugar fijo el iframe no scrollea con la página:
 * su JS (la barra de progreso de lectura) ve ese scroll y ese alto de documento. En los otros, sólo el alto de pantalla.
 */
let pagina: { scrollY: number; scrollHeight: number; viewportHeight: number; botonArriba?: boolean } = { scrollY: 0, scrollHeight: 0, viewportHeight: 0 };
if (cfg.fijo) {
  Object.defineProperty(window, "scrollY", { get: () => pagina.scrollY, configurable: true });
  Object.defineProperty(window, "pageYOffset", { get: () => pagina.scrollY, configurable: true });
  Object.defineProperty(document.documentElement, "scrollHeight", { get: () => pagina.scrollHeight || document.body.scrollHeight, configurable: true });
}
window.addEventListener("message", (e) => {
  const p = e.data as { gadsden?: string } & typeof pagina;
  if (p?.gadsden !== "pagina") return;
  if (!cfg.fijo) return altoDePantalla(p.viewportHeight);
  pagina = { scrollY: p.scrollY, scrollHeight: p.scrollHeight, viewportHeight: p.viewportHeight, botonArriba: p.botonArriba };
  // El aviso del centinela puede llegar antes del primer scroll (sin alto de pantalla).
  if (p.viewportHeight) Object.defineProperty(window, "innerHeight", { get: () => pagina.viewportHeight, configurable: true });
  window.dispatchEvent(new Event("scroll"));
});

let ultimoComprado = { id: 0, t: 0 };
window.addEventListener("message", (e) => {
  const d = e.data as { gadsden?: string; id?: number; n?: number } | null;
  if (d?.gadsden === "variante" && d.id && d.id !== variante) { variante = d.id; void dibujar(false).then(informarCompra); }
  // La cantidad que se compra (la del theme, o la de una oferta de otro bloque): los regalos por cantidad la miran.
  if (d?.gadsden === "cantidad" && d.n && formCompra() && !document.querySelector("gad-quantity-offers")) {
    for (const q of document.querySelectorAll<HTMLInputElement>('input[name="quantity"][form="product-form-main"], #product-form-main input[name="quantity"]')) {
      q.value = String(d.n);
      q.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  // El theme agregó el producto: lo que en Shopify sigue al formulario (los adicionales y regalos de gadsden.js).
  // Una sola vez por compra: un aviso repetido sumaría otra vez los adicionales y regalos (en la tienda, el 24-oct, un
  // regalo entró dos veces en una de tres compras).
  if (d?.gadsden === "comprado" && d.id && !(d.id === ultimoComprado.id && Date.now() - ultimoComprado.t < 3000)) {
    ultimoComprado = { id: d.id, t: Date.now() };
    (w.publish as (ev: string, x: unknown) => void)("cart-update", { source: "product-form", productVariantId: d.id });
  }
});
if (cfg.bloque) for (const ev of ["change", "input"]) document.addEventListener(ev, informarCompra);

void dibujar(true).then(() => { if (cfg.modal) abrirPopup(); informarCompra(); }).catch((e) => { console.error("[Gadsden]", e); avisar({ gadsden: "error", mensaje: String(e) }); });

/**
 * Los widgets de Gadsden TAL CUAL: cada uno es un Iframe de NubeSDK que carga /w/ (src/w/pagina.ts), donde se dibuja
 * con su Liquid, su CSS y su JS originales. Este lado arma la configuración, pasa el producto de la ficha y atiende lo
 * que el iframe pide: el alto (autoresize), agregar al carrito, ir a otra página de la tienda, el cambio de variante y
 * los popups (otro iframe en `modal_content`, que muestra sólo el `<dialog>`).
 *
 * Sin `id` propio en el Iframe: NubeSDK empareja los mensajes por su id interno (TiendaNube/nube-sdk#373).
 */
import type { NubeComponent, NubeSDK, ProductDetails, ProductVariant } from "@tiendanube/nube-sdk-types";
import { iframe } from "@tiendanube/nube-sdk-ui";
import type { Tema } from "./w/tema.ts";

declare const BASE: string;

/** Secciones que cambian el aspecto de toda la página: no se dibujan solas, van dentro de cada widget de la página. */
export const DE_PAGINA = new Set(["gad-page-style", "gad-landing-skin"]);

export type ConfigGadsden = {
  /** Una sección gad-* como en un template de Shopify: { type, settings, blocks }. */
  seccion?: { type: string; settings?: Record<string, unknown>; blocks?: unknown; block_order?: string[] };
  /** Un bloque de la ficha (gad-product-block): { type: "quantity_offers" | "sticky_bar" | ..., settings }. */
  bloque?: { type: string; settings?: Record<string, unknown> };
  /** Las secciones que van en el mismo iframe (las dos de una gad-merge; las pone el script). */
  junto?: ConfigGadsden["seccion"][];
};

/** El ancla de una sección como la arma Gadsden (`anchor | handleize`). */
const ancla = (x: unknown) => String(x ?? "").replace(/#/g, "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * gad-merge junta dos secciones por su ancla. Cada widget vive en su iframe, así que las dos secciones de Gadsden que
 * nombra van dentro del iframe de la unión (y no por separado): ahí su JS las encuentra y las mueve, como en Shopify.
 */
export function juntarUniones<W extends ConfigGadsden>(ws: W[]): { widgets: W[]; junto: Map<W, ConfigGadsden["seccion"][]> } {
  const junto = new Map<W, ConfigGadsden["seccion"][]>();
  const usadas = new Set<W>();
  for (const u of ws) {
    if (u.seccion?.type !== "gad-merge") continue;
    const anclas = [u.seccion.settings?.anchor_1, u.seccion.settings?.anchor_2].map(ancla).filter(Boolean);
    const dentro = anclas.map((a) => ws.find((w) => w !== u && !usadas.has(w) && w.seccion && ancla(w.seccion.settings?.anchor) === a)).filter((w): w is W => !!w);
    for (const w of dentro) usadas.add(w);
    junto.set(u, dentro.map((w) => w.seccion));
  }
  return { widgets: ws.filter((w) => !usadas.has(w)), junto };
}

const texto = (x: unknown) => (x && typeof x === "object" ? (x as Record<string, string>).es ?? Object.values(x as Record<string, string>)[0] ?? "" : String(x ?? ""));

/** El producto de NubeSDK como lo recibe la página del iframe (src/w/producto.ts). */
export function productoParaIframe(p: ProductDetails) {
  const opciones = p.variants[0]?.options?.map((o) => o.name) ?? [];
  return {
    id: p.id, nombre: texto(p.name), handle: texto(p.handle), url: p.canonical_url,
    imagenes: p.images.map((i) => ({ src: i.src, alt: i.alt, width: i.width, height: i.height })),
    opciones,
    variantes: p.variants.map((v: ProductVariant) => ({
      id: v.id, precio: Number(v.price ?? 0), precioAntes: v.compare_at_price ? Number(v.compare_at_price) : null,
      disponible: !v.stock_management || v.stock === null || v.stock > 0,
      valores: v.options?.map((o) => o.value) ?? v.values.map(texto),
      imagen: p.images.find((i) => i.id === v.image_id)?.src ?? null,
    })),
  };
}

/**
 * El scroll de la página que manda `page:scroll` (cada 10 % de profundidad) y, si hay centinela, si el botón de comprar
 * del theme ya salió por arriba de la pantalla (cuando Gadsden muestra la barra fija).
 */
export type PaginaScroll = { scrollY: number; scrollHeight: number; viewportHeight: number; botonArriba?: boolean };

/**
 * El centinela de la barra fija (src/w/centinela.html): un iframe de 2 px, sin nada visible, justo debajo del botón de
 * comprar del theme. Avisa cuando el botón sale de la pantalla por arriba o vuelve a entrar.
 */
export function centinelaBarra(alCambiar: (arriba: boolean) => void): NubeComponent {
  return iframe({
    src: `${BASE}/w/centinela.html` as `https://${string}`,
    width: "100%",
    height: "2px",
    style: { border: "0", display: "block", marginBottom: "-2px" },
    onMessage: ({ value }) => {
      const m = value as { gadsden?: string; arriba?: boolean };
      if (m?.gadsden === "centinela") alCambiar(!!m.arriba);
    },
  });
}
/** Las propiedades de una línea sin las que empiezan con "_": en Shopify son ocultas (el JS de Gadsden marca así regalos y
 *  adicionales, `_gad_extra`), pero Tiendanube las muestra en el pedido (lgademo, 25-oct). */
const visibles = (p?: Record<string, string>) => {
  const v = Object.fromEntries(Object.entries(p ?? {}).filter(([k]) => !k.startsWith("_")));
  return Object.keys(v).length ? { properties: v } : {};
};
export type Iframes = { componente: NubeComponent; avisarVariante: (id: number) => void; avisarPagina: (p: PaginaScroll) => void; avisar: (m: Record<string, number | string>) => void };
/** La compra que arma un bloque de la ficha: los ítems del producto principal, sus propiedades y si es una oferta. */
export type Compra = { items: { variant_id: number; quantity: number }[]; propiedades: Record<string, string>; oferta: boolean };

/** Un widget de Gadsden como Iframe. Se arma una vez: el mismo componente en cada dibujo (identidad estable). */
export function widgetGadsden(nube: NubeSDK, w: ConfigGadsden, ctx: {
  producto?: ProductDetails; variante: number | undefined; tienda: number; estilo: string; tema?: Tema; pagina: ConfigGadsden["seccion"][]; moneda: { simbolo: string; codigo: string }; lugar: string; idioma?: string;
  agregar: (items: { product_id: number; variant_id: number; quantity: number; properties?: Record<string, string> }[], pago?: boolean) => void;
  /** Lo que mandaría el formulario de compra con lo elegido en el bloque (src/w/pagina.ts, informarCompra). */
  compra: (de: object, c: Compra) => void;
}): Iframes {
  const cfg = {
    // inicio: el reloj del script (el Web Worker de NubeSDK), lo más cerca de la carga de la página que se puede saber.
    // [VERIFICAR] en la tienda cuánto después de la carga arranca el Worker.
    seccion: w.seccion, bloque: w.bloque, ...(w.junto?.length && { junto: w.junto }), inicio: Math.round(performance.timeOrigin), pagina: ctx.pagina, estilo: ctx.estilo, ...(ctx.tema && { tema: ctx.tema }), ...(ctx.producto && { producto: productoParaIframe(ctx.producto) }), variante: ctx.variante, moneda: ctx.moneda, tienda: ctx.tienda, ...(ctx.idioma && ctx.idioma !== "es" && { idioma: ctx.idioma }),
    // En un lugar fijo (corner_*, edge_*) el iframe mide lo que ocupan sus elementos fijos (src/w/pagina.ts).
    ...(/^(corner|edge)_/.test(ctx.lugar) && { fijo: ctx.lugar }),
    // El ancho de la pantalla de la tienda (la ventana, en un celular): con él se miden los lugares fijos y los popups.
    ...(nube.getState().device?.screen?.width && { anchoPantalla: nube.getState().device.screen.width }),
  };
  const deVariante = new Map((ctx.producto?.variants ?? []).map((v) => [v.id, v.product_id]));
  const marco = (extra: object) => iframe({
    src: `${BASE}/w/#${encodeURIComponent(JSON.stringify({ ...cfg, ...extra }))}` as `https://${string}`,
    width: "100%",
    autoresize: true,
    // allow-top-navigation-by-user-activation: un rastreador de envíos (gad-track-order) abre en la misma pestaña.
    sandbox: "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation",
    style: { border: "0", display: "block", width: "100%" },
    onMessage: ({ value }) => {
      const m = value as { gadsden?: string; items?: { variant_id: number; product_id?: number; quantity: number; properties?: Record<string, string> }[]; url?: string; pago?: boolean; dialogo?: number; camino?: number[] | null } & Partial<Compra>;
      if (m?.gadsden === "agregar" && m.items?.length) {
        // El producto de cada variante: lo sabe el iframe (los otros productos los trajo el Worker).
        ctx.agregar(m.items.map((x) => ({ product_id: x.product_id ?? deVariante.get(x.variant_id) ?? ctx.producto?.id ?? 0, variant_id: x.variant_id, quantity: x.quantity, ...visibles(x.properties) })), m.pago);
      } else if (m?.gadsden === "compra" && m.items) {
        ctx.compra(componente, { items: m.items, propiedades: m.propiedades ?? {}, oferta: !!m.oferta });
      } else if (m?.gadsden === "ir" && m.url) {
        const u = new URL(m.url);
        nube.getBrowserAPIs().navigate(`${u.pathname}${u.search}` as `/${string}`);
      } else if (m?.gadsden === "arriba") {
        nube.getBrowserAPIs().scrollTo({ top: 0 });
      } else if (m?.gadsden === "modal" && typeof m.dialogo === "number") {
        // Un iframe no puede tapar la página: el popup va en otro, en el lugar modal de NubeSDK.
        abierto = m.dialogo;
        nube.render("modal_content", marco({ modal: { dialogo: m.dialogo, camino: m.camino ?? null } }));
      } else if (m?.gadsden === "cerrar-modal") {
        nube.clearSlot("modal_content");
        nube.getBrowserAPIs().postMessageToIframe(componente, { gadsden: "cerrado", dialogo: abierto });
      }
    },
  });
  let abierto = -1;
  const componente = marco({});
  return {
    componente,
    avisarVariante: (id) => nube.getBrowserAPIs().postMessageToIframe(componente, { gadsden: "variante", id }),
    avisarPagina: (p) => nube.getBrowserAPIs().postMessageToIframe(componente, { gadsden: "pagina", ...p }),
    avisar: (m) => nube.getBrowserAPIs().postMessageToIframe(componente, m),
  };
}

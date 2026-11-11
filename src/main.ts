/**
 * Gadsden Widgets: dibuja los widgets de Gadsden en la tienda con NubeSDK (corre en un Web Worker, sin DOM: todo es
 * `nube.render(lugar, componentes)`). Junta los widgets de la configuración por lugar y los vuelve a dibujar cuando
 * cambia algo (variante elegida, una opción tocada, el scroll).
 */
import type { DynamicSlot, NubeComponent, NubeSDK, NubeSDKState, ProductVariant, StorefrontUISlot } from "@tiendanube/nube-sdk-types";
import { LUGAR, type Config, type Widget } from "./config.ts";
import { fabricas as contenido } from "./contenido.ts";
import { conStock, fabricas as ofertas, type Ctx, type Dibujo, type Fabricas, type ItemCarrito } from "./ofertas.ts";
import { fabricas as social } from "./social.ts";
import { cssDe, estiloDe } from "./estilos.ts";
import { pila } from "./ui.ts";
import { DE_PAGINA, centinelaBarra, juntarUniones, widgetGadsden, type Compra, type PaginaScroll } from "./gadsden.ts";
import { box, styled } from "@tiendanube/nube-sdk-ui";
import { SOLO_CODIGO, esDinamico, lugarClasico, resolverDinamico, type Dinamico } from "./lugares.ts";
import { deLaPlantilla, esComun, plantillaDe } from "./plantillas.ts";

/** Donde vive el script y la configuración de cada tienda; la pone esbuild al construir. */
declare const BASE: string;

const FABRICAS: Fabricas = { ...ofertas, ...social, ...contenido };
const fabricar = (w: Widget) => (FABRICAS[w.tipo] as ((w: Widget) => Dibujo) | undefined)?.(w);

export function App(nube: NubeSDK) {
  let hecha = "";
  let cfg: Promise<Config | null> | null = null;
  const arrancar = (s: Readonly<NubeSDKState>) => {
    if (s.location.url === hecha) return;
    hecha = s.location.url;
    // La configuración de la tienda (la que guarda el panel; BUILD.md, paso 3); sin configuración no se dibuja nada.
    cfg ??= fetch(`${BASE}/config/${s.store.id}.json`).then((r) => (r.ok ? r.json() as Promise<Config> : null)).catch(() => null);
    void cfg.then((c) => {
      if (!c) return;
      const visibles = { ...c, widgets: c.widgets.filter((w) => !w.oculto) };
      return s.location.page.type === "product" ? ficha(nube, s, visibles) : otraPagina(nube, s, visibles);
    }).catch((e) => console.log("[Gadsden]", String(e)));
  };
  arrancar(nube.getState());
  nube.on("page:loaded", arrancar);
}

/**
 * Dónde dibujar cada lugar en esta página: los de las secciones de Ipanema (`after_dynamic_section_main_product`) no
 * tienen el número que piden los tipos (se busca el que devuelve NubeSDK), y los "antes o después de la sección X" que
 * eligió el comerciante (src/lugares.ts) se resuelven por tipo de sección y orden.
 */
async function destinos(nube: NubeSDK) {
  const dinamicos = await nube.api.getAvailableSlots().getDynamic().catch((): DynamicSlot[] => []);
  return (lugar: string) => {
    if (lugar === SOLO_CODIGO) return undefined;
    // Un theme clásico no tiene lugares de sección: van a los fijos que sí tiene (lugarClasico en src/lugares.ts).
    if (!dinamicos.length && lugarClasico(lugar)) return lugarClasico(lugar) as StorefrontUISlot;
    if (esDinamico(lugar)) { const id = resolverDinamico(lugar, dinamicos as Dinamico[]); return id ? dinamicos.find((d) => d.slotId === id) : undefined; }
    return dinamicos.find((d) => `${d.type}_${d.sectionId}` === lugar) ?? (lugar as StorefrontUISlot);
  };
}

/** Los lugares que hay fuera de la ficha: los de las secciones de la página y los de toda la tienda. */
const deOtraPagina = (lugar: string) => esDinamico(lugar) || esComun(lugar);

/**
 * Las otras páginas (inicio, categoría, búsqueda): las secciones de Gadsden que no necesitan un producto (también los
 * popups y lo fijo), en los lugares que tenga la página. Sin los bloques de la ficha ni la compra del theme; lo que un
 * widget agrega al carrito va directo.
 */
async function otraPagina(nube: NubeSDK, s: Readonly<NubeSDKState>, cfg: Config) {
  type WG = Extract<Widget, { tipo: "gadsden" }>;
  const dePagina = (w: WG) => !!w.seccion && DE_PAGINA.has(w.seccion.type);
  const gadsden = cfg.widgets.filter((w): w is WG => w.tipo === "gadsden");
  const pagina = gadsden.filter(dePagina).map((w) => w.seccion);
  const lugarDe = (w: WG) => w.lugar || LUGAR.gadsden;
  const { widgets: sueltos, junto } = juntarUniones(gadsden.filter((w) => !!w.seccion && !dePagina(w) && !w.plantilla && !w.productos?.length && deOtraPagina(lugarDe(w))));
  if (!sueltos.length) return;
  const paginas: ((p: PaginaScroll) => void)[] = [];
  const porLugar = new Map<string, NubeComponent[]>();
  for (const w of sueltos) {
    const g = widgetGadsden(nube, junto.get(w)?.length ? { ...w, junto: junto.get(w) } : w, {
      variante: undefined, tienda: s.store.id, pagina, estilo: estiloDe(cfg.estilo), tema: cfg.tema,
      moneda: { simbolo: "$", codigo: s.store.currency_details?.code || s.store.currency || "ARS" }, lugar: lugarDe(w), idioma: s.store.language,
      agregar: (items) => { nube.send("cart:add", () => ({ cart: { items } })); nube.send("cart:open"); },
      compra: () => {},
    });
    paginas.push(g.avisarPagina);
    porLugar.set(lugarDe(w), [...(porLugar.get(lugarDe(w)) ?? []), g.componente]);
  }
  const destino = await destinos(nube);
  const Raiz = styled(box)`${cssDe(cfg.estilo ?? "tienda")}`;
  for (const [lugar, nodos] of porLugar) {
    const d = destino(lugar);
    if (d) nube.render(d, Raiz({ width: "100%", children: [pila(0, nodos, { width: "100%" })] }));
  }
  // El alto de la pantalla y el scroll, como en la ficha (las animaciones al aparecer y lo fijo los miran).
  nube.on("page:scroll", ({ eventPayload }) => {
    const p = eventPayload as Partial<PaginaScroll> | undefined;
    if (p?.viewportHeight) for (const avisar of paginas) avisar({ scrollY: Number(p.scrollY ?? 0), scrollHeight: Number(p.scrollHeight ?? 0), viewportHeight: Number(p.viewportHeight) });
  });
}

async function ficha(nube: NubeSDK, s: Readonly<NubeSDKState>, cfg: Config) {
  const { page } = s.location;
  if (page.type !== "product") return;
  const producto = page.data.product;

  // Los widgets de Gadsden tal cual son Iframes: se arman una sola vez (cada dibujo devuelve el mismo componente) y
  // se enteran de la variante elegida por mensaje.
  const avisos: ((id: number) => void)[] = [];
  const paginas: ((p: PaginaScroll) => void)[] = [];
  const todos: ((m: Record<string, number | string>) => void)[] = [];
  const dePagina = (w: Widget) => w.tipo === "gadsden" && !!w.seccion && DE_PAGINA.has(w.seccion.type);
  const pagina = cfg.widgets.filter(dePagina).map((w) => (w as Extract<Widget, { tipo: "gadsden" }>).seccion);
  const iframe = (w: Extract<Widget, { tipo: "gadsden" }>): Dibujo => {
    const g = widgetGadsden(nube, w, {
      producto, variante: variante?.id, tienda: s.store.id, pagina, estilo: estiloDe(cfg.estilo), tema: cfg.tema,
      moneda: { simbolo: "$", codigo: s.store.currency_details?.code || s.store.currency || "ARS" }, idioma: s.store.language,
      agregar: (items, pago) => ctx.agregar(items, pago), lugar: w.lugar || LUGAR.gadsden, compra,
    });
    avisos.push(g.avisarVariante);
    paginas.push(g.avisarPagina);
    todos.push(g.avisar);
    return () => g.componente;
  };

  let variante: ProductVariant | undefined = producto.variants.find(conStock) ?? producto.variants[0];
  const porLugar = new Map<string, Dibujo[]>();
  // Los de la plantilla de este producto (o de la base) y los de toda la tienda.
  const plantilla = plantillaDe(cfg, producto.id);
  // Las secciones que une una gad-merge van dentro de su iframe, no por separado.
  const { widgets: sueltos, junto } = juntarUniones(cfg.widgets.filter((w): w is Extract<Widget, { tipo: "gadsden" }> => w.tipo === "gadsden"));
  for (const w of cfg.widgets) {
    if (dePagina(w) || (w.productos?.length && !w.productos.includes(producto.id)) || !deLaPlantilla(w, w.lugar || LUGAR[w.tipo], plantilla)) continue;
    if (w.tipo === "gadsden" && !sueltos.includes(w)) continue;
    const d = w.tipo === "gadsden" ? iframe(junto.get(w)?.length ? { ...w, junto: junto.get(w) } : w) : fabricar(w);
    if (!d) continue;
    const lugar = w.lugar || LUGAR[w.tipo];
    porLugar.set(lugar, [...(porLugar.get(lugar) ?? []), d]);
  }
  // La barra fija aparece cuando el botón de comprar del theme sale de la pantalla por arriba, como en Shopify: lo mira
  // un centinela debajo del botón. Sin centinela (o hasta que avise), la barra aparece pasada la primera pantalla.
  let ultima: PaginaScroll = { scrollY: 0, scrollHeight: 0, viewportHeight: 0 };
  let centinela: NubeComponent | null = null;
  if (cfg.widgets.some((w) => w.tipo === "gadsden" && w.bloque?.type === "sticky_bar")) {
    centinela = centinelaBarra((arriba) => {
      ultima = { ...ultima, botonArriba: arriba };
      for (const avisar of paginas) avisar(ultima);
    });
    const c = centinela;
    porLugar.set("after_product_detail_add_to_cart", [() => c, ...(porLugar.get("after_product_detail_add_to_cart") ?? [])]);
  }
  if (!porLugar.size) return;
  const destino = await destinos(nube);

  nube.on("product:variant_selected", ({ eventPayload }) => {
    variante = producto.variants.find((v) => v.id === Number(eventPayload?.id)) ?? variante;
    if (variante) for (const avisar of avisos) avisar(variante.id);
    pintar();
  });
  let scroll = 0;
  nube.on("page:scroll", ({ eventPayload }) => {
    scroll = Number(eventPayload?.scrollPercentage ?? 0);
    // A los widgets de Gadsden: el alto real de la pantalla y, en los lugares fijos, el scroll de la página.
    const p = eventPayload as Partial<PaginaScroll> | undefined;
    if (p?.viewportHeight) {
      ultima = { ...ultima, scrollY: Number(p.scrollY ?? 0), scrollHeight: Number(p.scrollHeight ?? 0), viewportHeight: Number(p.viewportHeight) };
      for (const avisar of paginas) avisar(ultima);
      // Al centinela, para el sentido del scroll (si el botón sale de la pantalla en un solo cuadro).
      if (centinela) nube.getBrowserAPIs().postMessageToIframe(centinela, { gadsden: "pagina", scrollY: ultima.scrollY });
    }
    pintar();
  });

  // Abrir el carrito sólo después de lo que agregó un widget (el botón del theme ya abre el suyo).
  // Después de agregar: abre el carrito (el cajón de Shopify) o, con "ir directo al pago", va al checkout.
  // Lo que agregó el theme se completa con lo de los bloques de la ficha. Qué se agregó se sabe comparando el carrito
  // antes y después: el aviso de la tienda (`cart:add:success`) trae una línea cualquiera del carrito, no la agregada
  // (medido en lgademo el 24-oct). Lo de la app se reconoce por la variante (diez segundos).
  type Linea = { product_id: number; variant_id: number; quantity: number };
  const lineas = (c?: { items?: { id: number; product_id: number | string; variant_id: number | string; quantity: number }[] }) =>
    new Map<number, Linea>((c?.items ?? []).map((x) => [x.id, { product_id: Number(x.product_id), variant_id: Number(x.variant_id), quantity: Number(x.quantity) }]));
  let antes = lineas(nube.getState().cart);
  // Lo que cambió el carrito por otro lado (el cajón, otra pestaña), un rato después de cada aviso.
  nube.on("cart:update", () => { setTimeout(() => { antes = lineas(nube.getState().cart); }, 2000); });
  let despues: "carrito" | "pago" | null = null;
  let nuestros: { variante: number; hasta: number }[] = [];
  // Lo que mandó la app y todavía no pasó por cart:before_update (abajo): pasa sin frenarse.
  let soltar = 0, soltarHasta = 0;
  const mandar = (items: ItemCarrito[]) => {
    const hasta = Date.now() + 10000;
    nuestros.push(...items.map((x) => ({ variante: x.variant_id, hasta })));
    soltar += items.length; soltarHasta = hasta;
    nube.send("cart:add", () => ({ cart: { items } }));
  };
  nube.on("cart:add:success", (st) => {
    const ahora = lineas(st.cart);
    const agregadas = [...ahora.entries()].flatMap(([id, l]) => { const d = l.quantity - (antes.get(id)?.quantity ?? 0); return d > 0 ? [{ ...l, quantity: d }] : []; });
    antes = ahora;
    nuestros = nuestros.filter((x) => x.hasta > Date.now());
    let propias = false;
    for (const l of agregadas) {
      const i = nuestros.findIndex((x) => x.variante === l.variant_id);
      if (i >= 0) { nuestros.splice(i, 1); propias = true; } else completar(l);
    }
    if (!propias) return;
    if (despues === "pago") nube.getBrowserAPIs().navigate("checkout");
    else if (despues) nube.send("cart:open");
    despues = null;
  });
  // El agregado del theme que frena la app (abajo) puede avisar que falló: no cancela lo que la app manda en su lugar.
  let frenadoHasta = 0;
  nube.on("cart:add:fail", () => { if (Date.now() > frenadoHasta) despues = null; });

  /**
   * La compra del botón del theme, como la mandaba el formulario de Shopify con los bloques de la ficha: la cantidad o
   * las unidades de una oferta, las propiedades de un campo, y después los adicionales y regalos (los agrega gadsden.js
   * en cada iframe al enterarse, como en Shopify). Cada bloque avisa lo suyo cuando cambia (`compra`).
   */
  const compras = new Map<object, Compra>();
  let cantidadTheme = Number(producto.quantity) || 1;
  const oferta = () => [...compras.values()].find((c) => c.oferta);
  // La cantidad que se compra, para los regalos por cantidad: la de la oferta o la del selector del theme.
  const avisarCantidad = () => {
    const o = oferta();
    const n = o ? o.items.reduce((t, x) => t + x.quantity, 0) : cantidadTheme;
    for (const avisar of todos) avisar({ gadsden: "cantidad", n });
  };
  function compra(de: object, c: Compra) {
    compras.set(de, c);
    if (c.oferta) avisarCantidad();
  }
  nube.on("product:quantity_changed", (st) => {
    const p = st.location.page;
    cantidadTheme = (p.type === "product" && Number(p.data.product.quantity)) || Number(st.eventPayload?.quantity) || 1;
    avisarCantidad();
  });
  /** Lo que cargó el comprador en los bloques (un campo, la imagen de "Personalizar"), sin las propiedades ocultas. */
  const propiedades = () => Object.fromEntries(Object.entries(Object.assign({}, ...[...compras.values()].map((c) => c.propiedades)) as Record<string, string>).filter(([k, x]) => !k.startsWith("_") && x !== ""));
  /**
   * La compra del theme completada con lo de los bloques: las unidades de una oferta que faltan y, con `frenada`, todas,
   * porque el agregado del theme se frenó (abajo) y lo manda la app con las propiedades.
   */
  function completar(l: Linea, frenada = false) {
    if (l.product_id !== producto.id) return;
    const v = l.variant_id, q = l.quantity;
    const props = propiedades();
    const deseado = oferta()?.items ?? [{ variant_id: v, quantity: q }];
    const cuenta = new Map<number, number>();
    for (const x of deseado) cuenta.set(x.variant_id, (cuenta.get(x.variant_id) ?? 0) + x.quantity);
    if (!frenada) cuenta.set(v, (cuenta.get(v) ?? 0) - q);
    const conProps = Object.keys(props).length ? { properties: props } : {};
    const faltan = [...cuenta].filter(([, n]) => n > 0).map(([variant_id, quantity]) => ({ product_id: producto.id, variant_id, quantity, ...conProps }));
    // Frenado, el theme no abre su carrito: lo abre la app cuando entra lo suyo.
    if (frenada) { despues = "carrito"; frenadoHasta = Date.now() + 5000; }
    if (faltan.length) mandar(faltan);
    for (const avisar of todos) avisar({ gadsden: "comprado", id: v });
  }
  /**
   * El pedido sólo guarda lo que va en la línea del carrito, y NubeSDK no deja ponerle propiedades a la que agrega el
   * botón del theme: con lo de un bloque cargado, la app frena ese agregado (cart:before_update) y lo manda ella con las
   * propiedades, como recomienda la doc de NubeSDK (eventos de carrito, 3-nov). Antes iba como order:add:extra, que sólo
   * anda en el checkout: en el pedido de prueba #109 de lgademo (1 unidad, sin oferta) no llegó nada. Lo que agrega la
   * app (`nuestros`) pasa siempre.
   */
  nube.send("config:set", () => ({ config: { handle_cart_before_update: true } }));
  nube.on("cart:before_update", (st) => {
    const x = st.eventPayload as { request_id?: string; action?: string; item?: { product_id: number | string } } | null;
    if (!x?.request_id) return;
    // El aviso no dice la variante (variant_id: null, medido en lgademo el 3-nov) ni distingue quién agrega: lo de la app
    // se cuenta al mandarlo (`soltar`) y pasa. Un segundo aviso del mismo clic (no pasó en las pruebas) se frena sin volver
    // a agregar.
    const deLaApp = x.action === "ADD" && soltar > 0 && Date.now() < soltarHasta;
    if (deLaApp) soltar--;
    const frenar = !deLaApp && x.action === "ADD" && Number(x.item?.product_id) === producto.id && Object.keys(propiedades()).length > 0;
    const repetido = frenar && Date.now() < frenadoHasta;
    nube.send("cart:before_update:result", () => ({ eventPayload: { request_id: x.request_id, proceed: !frenar, ...(frenar && { reason: "Gadsden: la línea va con lo que cargó el comprador" }) } }));
    if (frenar && !repetido && variante) completar({ product_id: producto.id, variant_id: variante.id, quantity: cantidadTheme }, true);
  });

  // La raíz de cada lugar lleva las variables del estilo (--g-*) que leen todas las piezas.
  const Raiz = styled(box)`${cssDe(cfg.estilo ?? "tienda")}`;

  const f = new Intl.NumberFormat("es-AR", { style: "currency", currency: s.store.currency_details?.code || s.store.currency || "ARS" });
  const ctx: Ctx = {
    producto,
    variante: () => variante,
    plata: (n) => f.format(n),
    pintar: () => pintar(),
    agregar: (items: ItemCarrito[], pago = false) => {
      despues = pago ? "pago" : "carrito";
      mandar(items);
    },
    scroll: () => scroll,
  };

  function pintar() {
    for (const [lugar, ds] of porLugar) {
      const nodos = ds.map((d) => d(ctx)).filter(Boolean);
      // Sin separación: las secciones de Gadsden van una pegada a la otra (spacing_sections: 0); los widgets de la
      // columna de la ficha traen su margen.
      const d = destino(lugar);
      // Una sección que ya no está en la página: el widget no se dibuja (hasta que vuelva).
      if (!d) continue;
      // A todo el ancho del lugar: sin ancho, la caja de NubeSDK mide lo que su contenido y un iframe mide 300 px (el de
      // fábrica del navegador): las secciones anchas salían de 300 px (medido en lgademo el 24-oct).
      if (nodos.length) nube.render(d, Raiz({ width: "100%", children: [pila(0, nodos, { width: "100%" })] }));
      else nube.clearSlot(d);
    }
  }
  pintar();
}

/**
 * El catálogo del panel: las 54 secciones y los 26 bloques de la ficha de Gadsden, cada uno con su {% schema %} (de ahí
 * sale el formulario) y los lugares de NubeSDK donde tiene sentido. Lo arma construir.mjs en dist/panel/catalogo.json.
 */

export type Opcion = { value: string; label: string };
export type Ajuste = {
  type: string; id?: string; label?: string; info?: string; content?: string; default?: unknown; placeholder?: string;
  options?: Opcion[]; min?: number; max?: number; step?: number; unit?: string;
};
export type EsquemaBloque = { type: string; name?: string; limit?: number; settings?: Ajuste[] };
export type Esquema = {
  name?: string; settings?: Ajuste[]; blocks?: EsquemaBloque[]; max_blocks?: number;
  presets?: { name?: string; settings?: Record<string, unknown>; blocks?: { type: string; settings?: Record<string, unknown> }[] }[];
};
export type ItemCatalogo = { clase: "seccion" | "bloque"; type: string; nombre: string; esquema: Esquema; lugares: string[]; lugar: string; aviso?: string; categoria?: Categoria };
/** Las categorías del menú "Agregar bloque" del editor de Tiendanube. */
export const CATEGORIAS = ["Básico", "Diseño", "Otros"] as const;
export type Categoria = (typeof CATEGORIAS)[number];

/** Los lugares de NubeSDK de la ficha (los que trae Ipanema en el HTML), con su nombre para el comerciante. */
export const LUGARES: Record<string, string> = {
  after_dynamic_section_main_product: "Debajo de la ficha",
  before_dynamic_section_main_product: "Arriba de la ficha",
  before_main_content: "Arriba de todo el contenido",
  after_header: "Debajo del encabezado",
  before_footer: "Arriba del pie de página",
  after_dynamic_section_complementary_products: "Debajo de los productos complementarios",
  after_dynamic_section_alternative_products: "Debajo de los productos alternativos",
  after_product_detail_add_to_cart: "Columna: debajo del botón de comprar",
  before_product_detail_add_to_cart: "Columna: arriba del botón de comprar",
  after_product_detail_price: "Columna: debajo del precio",
  before_product_detail_price: "Columna: arriba del precio",
  after_product_detail_name: "Columna: debajo del nombre",
  before_product_detail_name: "Columna: arriba del nombre",
  after_product_detail_payment_options: "Columna: debajo de los medios de pago",
  after_product_detail_shipping_options: "Columna: debajo del cálculo de envío",
  after_product_detail_image: "Debajo de las fotos",
  edge_bottom_center: "Fija abajo",
  edge_top_center: "Fija arriba",
  corner_bottom_left: "Fija en la esquina de abajo a la izquierda",
  corner_bottom_right: "Fija en la esquina de abajo a la derecha",
  corner_top_left: "Fija en la esquina de arriba a la izquierda",
  corner_top_right: "Fija en la esquina de arriba a la derecha",
};
/** Los mismos en portugués (el editor los muestra así en las tiendas de Brasil). */
export const LUGARES_PT: Record<string, string> = {
  after_dynamic_section_main_product: "Abaixo da página do produto",
  before_dynamic_section_main_product: "Acima da página do produto",
  before_main_content: "Acima de todo o conteúdo",
  after_header: "Abaixo do cabeçalho",
  before_footer: "Acima do rodapé",
  after_dynamic_section_complementary_products: "Abaixo dos produtos complementares",
  after_dynamic_section_alternative_products: "Abaixo dos produtos alternativos",
  after_product_detail_add_to_cart: "Coluna: abaixo do botão de comprar",
  before_product_detail_add_to_cart: "Coluna: acima do botão de comprar",
  after_product_detail_price: "Coluna: abaixo do preço",
  before_product_detail_price: "Coluna: acima do preço",
  after_product_detail_name: "Coluna: abaixo do nome",
  before_product_detail_name: "Coluna: acima do nome",
  after_product_detail_payment_options: "Coluna: abaixo dos meios de pagamento",
  after_product_detail_shipping_options: "Coluna: abaixo do cálculo de frete",
  after_product_detail_image: "Abaixo das fotos",
  edge_bottom_center: "Fixa embaixo",
  edge_top_center: "Fixa em cima",
  corner_bottom_left: "Fixa no canto inferior esquerdo",
  corner_bottom_right: "Fixa no canto inferior direito",
  corner_top_left: "Fixa no canto superior esquerdo",
  corner_top_right: "Fixa no canto superior direito",
};
const ANCHOS = Object.keys(LUGARES).filter((l) => /_section_|main_content|header|footer/.test(l));
const COLUMNA = Object.keys(LUGARES).filter((l) => l.startsWith("after_product_detail") || l.startsWith("before_product_detail"));
const FIJOS = Object.keys(LUGARES).filter((l) => /^(edge|corner)_/.test(l));

/** Los que viven en un lugar fijo de la pantalla (BUILD.md, sus filas). */
const FIJO: Record<string, string> = { "gad-music-global": "corner_bottom_left", "gad-reading-progress": "edge_top_center", sticky_bar: "edge_bottom_center" };
/** La categoría de cada bloque de la ficha en "Agregar bloque" (el resto, Otros): contenido simple y elementos de diseño. */
const CATEGORIA: Record<string, Categoria> = {
  button: "Básico", image: "Básico", video: "Básico", text_icons: "Básico", icons: "Básico", benefits: "Básico", feature: "Básico", urgency: "Básico",
  divider: "Diseño", jump: "Diseño", features: "Diseño", payment: "Diseño", stars: "Diseño", trustpilot: "Diseño", avatars: "Diseño",
};
/**
 * Ajustes que en Tiendanube cambian de valor de fábrica o de ayuda. Popup promocional: el email no se guarda (la app no
 * crea clientes), así que el formulario sale apagado y, si se prende, al enviarlo el comprador ve el cupón
 * (src/w/pagina.ts).
 */
const AJUSTES_TN: Record<string, Record<string, Partial<Ajuste>>> = {
  "gad-promo-popup": {
    email_form: { default: false, info: "En Tiendanube el email no se guarda: al enviarlo, el comprador ve directo el cupón. Para juntar contactos, usá otra herramienta." },
  },
};
/** Lo que no se ve fuera de Shopify (BUILD.md, "Lo que te falta", punto 6). */
const AVISOS: Record<string, string> = {
  "gad-color-switcher": "Cambia los colores de toda la tienda: en Tiendanube sólo se ve el selector, no el cambio.",
  "gad-landing-skin": "Repinta la ficha del theme: en Tiendanube sólo cambia los otros widgets de Gadsden.",
  "gad-page-style": "Cambia el estilo de toda la página: en Tiendanube sólo cambia los otros widgets de Gadsden.",
  custom_snippet: "Muestra un fragmento del theme de Shopify: en Tiendanube no hay.",
  field: "En Tiendanube el carrito no guarda textos por producto: lo que escribe el comprador va como dato adicional del pedido.",
};

/** El schema de una sección de Liquid. */
export const esquemaDe = (liquid: string): Esquema => JSON.parse(/\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/.exec(liquid)?.[1] ?? "{}") as Esquema;

/** Las ayudas de Gadsden que hablan del editor o de los descuentos de Shopify, como van en Tiendanube. */
const EN_TIENDANUBE: [RegExp, string][] = [
  [/creá el descuento en Shopify \(por ejemplo, "compra X y lleva Y"\)/, "creá la promoción en Descuentos de tu tienda"],
  [/creá el descuento en Shopify/, "creá la promoción en Descuentos de tu tienda"],
  [/que se crea en Shopify \(Descuentos\)/, "que se crea en Descuentos de tu tienda"],
  [/Tiene que existir en (Shopify \(Descuentos\)|Descuentos de Shopify)/, "Tiene que existir en Descuentos de tu tienda (cupones)"],
  [/con el marcador gris de Shopify/, "con un dibujo gris"],
];
function enTiendanube(a: Ajuste): Ajuste {
  const x = { ...a };
  for (const k of ["label", "info", "content"] as const) {
    let v = x[k];
    if (typeof v !== "string") continue;
    for (const [re, por] of EN_TIENDANUBE) v = v.replace(re, por);
    // Lo que remite a la configuración del theme de Shopify (o a cómo funciona Shopify) no aplica: fuera.
    if (/Shopify|Configuración del tema/.test(v)) { if (k === "info") delete x.info; else x[k] = v.replace(/\s*\([^)]*Shopify[^)]*\)/g, ""); }
    else x[k] = v;
  }
  return x;
}
const adaptar = (e: Esquema, type = ""): Esquema => ({
  ...e, settings: e.settings?.map(enTiendanube).map((a) => ({ ...a, ...(a.id && AJUSTES_TN[type]?.[a.id]) })),
  blocks: e.blocks?.map((b) => ({ ...b, settings: b.settings?.map(enTiendanube) })),
});

export function armarCatalogo(secciones: Record<string, string>, bloques: EsquemaBloque[]): ItemCatalogo[] {
  const item = (clase: ItemCatalogo["clase"], type: string, esquema: Esquema): ItemCatalogo => {
    const fijo = FIJO[type];
    const lugares = fijo ? FIJOS : clase === "seccion" ? [...ANCHOS, ...COLUMNA] : [...COLUMNA, ...ANCHOS];
    return { clase, type, nombre: esquema.name ?? type, esquema: adaptar(esquema, type), lugares, lugar: fijo ?? lugares[0]!, ...(AVISOS[type] && { aviso: AVISOS[type] }), ...(clase === "bloque" && { categoria: CATEGORIA[type] ?? "Otros" }) };
  };
  return [
    ...Object.entries(secciones).map(([type, liquid]) => item("seccion", type, esquemaDe(liquid))),
    ...bloques.map((b) => item("bloque", b.type, { name: b.name, settings: b.settings })),
  ].sort((a, b) => (a.clase === b.clase ? a.nombre.localeCompare(b.nombre, "es") : a.clase === "seccion" ? -1 : 1));
}

/**
 * El catálogo con cada texto que ve el comerciante pasado por `f`: nombres, etiquetas, ayudas, opciones y avisos. Los
 * valores de fábrica (`default`, los presets) no: son los textos del comprador y los edita el comerciante.
 */
function conTextos(catalogo: ItemCatalogo[], f: (s: string) => string): ItemCatalogo[] {
  const x = (s?: string) => (s === undefined ? s : f(s));
  const ajuste = (a: Ajuste): Ajuste => ({
    ...a, label: x(a.label), info: x(a.info), content: x(a.content), placeholder: x(a.placeholder), unit: x(a.unit),
    options: a.options?.map((o) => ({ ...o, label: f(o.label) })),
  });
  return catalogo.map((c) => ({
    ...c, nombre: f(c.nombre), aviso: x(c.aviso),
    esquema: { ...c.esquema, name: x(c.esquema.name), settings: c.esquema.settings?.map(ajuste), blocks: c.esquema.blocks?.map((b) => ({ ...b, name: x(b.name), settings: b.settings?.map(ajuste) })) },
  }));
}

/** Todos los textos del catálogo que ve el comerciante, sin repetir (herramientas/textos-catalogo.mjs y el test). */
export function textosDe(catalogo: ItemCatalogo[]) {
  const vistos = new Set<string>();
  conTextos(catalogo, (s) => (vistos.add(s), s));
  return [...vistos].filter((s) => /[a-záéíóúñ]/i.test(s));
}

/** El catálogo traducido con un diccionario (src/panel/catalogo.pt.json; lo que no está queda en español), ordenado en ese idioma. */
export const traducirCatalogo = (catalogo: ItemCatalogo[], dic: Record<string, string>, idioma: string) =>
  conTextos(catalogo, (s) => dic[s] ?? s).sort((a, b) => (a.clase === b.clase ? a.nombre.localeCompare(b.nombre, idioma) : a.clase === "seccion" ? -1 : 1));

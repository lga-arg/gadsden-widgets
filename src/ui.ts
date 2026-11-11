/**
 * Las piezas comunes de los widgets, con los valores de Gadsden (assets/gadsden.css, gad-product.css y los .liquid gad-*
 * del theme Gadsden; 1 rem de Dawn = 10 px). Los colores, la letra y los radios no van fijos: son las variables
 * `--g-*` del estilo elegido (src/estilos.ts), que se ponen en la raíz de cada lugar. Donde Gadsden usa
 * `rgba(foreground, x)`, acá va `color-mix` del texto sobre el fondo.
 */
import type { NubeComponent, NubeComponentStyle } from "@tiendanube/nube-sdk-types";
import { box, button, check, img, link, styled, svgPath, svgRoot, txt } from "@tiendanube/nube-sdk-ui";

export type Nodo = NubeComponent | string | null | false | undefined;
export const hijos = (xs: Nodo[]): (NubeComponent | string)[] => xs.filter((x): x is NubeComponent | string => !!x);

const FG = "var(--g-texto)";
const BG = "var(--g-fondo)";
/** `rgba(foreground, pct/100)` de Gadsden sobre el fondo. */
export const mezcla = (pct: number) => `color-mix(in srgb, ${FG} ${pct}%, ${BG})`;
/** `rgba(foreground, pct/100)` transparente (para bordes sobre cualquier fondo). */
export const transparente = (pct: number) => `color-mix(in srgb, ${FG} ${pct}%, transparent)`;

export const C = {
  texto: FG,
  cuerpo: "var(--g-cuerpo)",
  fondo: BG,
  tarjeta: "var(--g-tarjeta)",
  gris: "var(--g-gris)",
  tinte: mezcla(5),
  borde: transparente(15),
  acento: "var(--g-acento)",
  boton: "var(--g-boton)",
  botonTexto: "var(--g-boton-texto)",
  insignia: "var(--g-insignia)",
  insigniaTexto: "var(--g-insignia-texto)",
  destacada: "var(--g-destacada)",
  destacadaTexto: "var(--g-destacada-texto)",
  titulos: "var(--g-titulos)",
  pesoTitulos: "var(--g-peso-titulos)",
};

/** Las medidas de Gadsden en rem de Dawn (1 rem = 10 px). */
export const rem = (n: number) => `${n * 10}px`;

/** Una columna. */
export const pila = (gap: number, xs: Nodo[], style?: NubeComponentStyle) =>
  box({ direction: "col", gap: `${gap}px`, children: hijos(xs), style });

/** Una fila, alineada al centro. */
export const enLinea = (gap: number, xs: Nodo[], style?: NubeComponentStyle) =>
  box({ direction: "row", gap: `${gap}px`, alignItems: "center", children: hijos(xs), style: { flexWrap: "wrap", ...style } });

/** Una caja sin dirección (para grid, position, etc.). */
export const caja = (xs: Nodo[], style?: NubeComponentStyle) => box({ children: hijos(xs), style });

/** Una grilla. */
export const grilla = (columnas: string, xs: Nodo[], gap = 12, alinear = "center", style?: NubeComponentStyle) =>
  box({ children: hijos(xs), style: { display: "grid", gridTemplateColumns: columnas, gap: `${gap}px`, alignItems: alinear, ...style } });

/** Texto con estilo propio (todos los tamaños de Gadsden van explícitos). */
export const t = (s: string, style: NubeComponentStyle = {}) => txt({ children: s, style: { margin: "0", ...style } });

/** Un texto con partes en negrita: "Basado en **1.234** reseñas". */
export const conNegritas = (s: string, style: NubeComponentStyle = {}, negrita: NubeComponentStyle = {}) => box({
  children: s.split(/\*\*(.+?)\*\*/).map((x, i) => (i % 2 ? txt({ children: x, modifiers: ["bold"], style: { margin: "0", display: "inline", ...negrita } }) : x)).filter(Boolean),
  style: { display: "block", ...style },
});

/**
 * El encabezado de las secciones (snippets/gad-heading): h1 de Dawn (3 rem en mobile, 4 rem desde 750 px, por la escala
 * del estilo), centrado, 3 rem abajo. Lo que va entre ** sale en negrita del color del acento (`.gad-hl strong`).
 */
const Titulo = styled(box)`
  margin: 0 0 30px; text-align: center; color: var(--g-texto);
  font-family: var(--g-titulos); font-weight: var(--g-peso-titulos); line-height: 1.3; letter-spacing: var(--g-titulo-ls);
  font-size: var(--g-titulo-m);
  @media (min-width: 750px) { font-size: var(--g-titulo-d); }
`;
export const encabezado = (titulo?: string, alinear: "center" | "left" = "center") =>
  titulo ? Titulo({ children: [conNegritas(titulo, {}, { color: "var(--g-acento)" })], style: { textAlign: alinear } }) : null;

/** El fondo de una sección de Gadsden: la banda de color y el padding (36 px, el 75 % en mobile). */
const Banda = styled(box)`
  padding: 27px 16px;
  @media (min-width: 750px) { padding: 36px 24px; }
`;
export const seccion = (xs: Nodo[], fondo = BG, ancho = "1200px") => Banda({
  children: [box({ children: hijos(xs), style: { maxWidth: ancho, margin: "0 auto" } })],
  style: { background: fondo, borderRadius: "0" },
});

/** El botón de Dawn: 4,5 rem de alto + el borde, 0 3 rem de padding, letra 1,5 rem; radio y espaciado del estilo. */
const ESTILO_BOTON: NubeComponentStyle = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box",
  minHeight: "49px", padding: "0 30px", borderRadius: "var(--g-boton-radio)", font: "inherit", fontSize: "15px", letterSpacing: "var(--g-boton-ls)",
  lineHeight: "1.2", cursor: "pointer", textDecoration: "none", textAlign: "center",
};
export type Variante = "primario" | "secundario" | "claro";
const VARIANTE: Record<Variante, NubeComponentStyle> = {
  primario: { background: "var(--g-boton)", color: "var(--g-boton-texto)", border: "2px solid var(--g-boton)" },
  secundario: { background: "transparent", color: "var(--g-boton-sec)", border: "2px solid var(--g-boton-sec)" },
  claro: { background: "var(--g-destacada-texto)", color: "var(--g-destacada)", border: "2px solid var(--g-destacada-texto)" },
};
export const boton = (s: string, alTocar: () => void, v: Variante = "primario", o: { deshabilitado?: boolean; ancho?: boolean; style?: NubeComponentStyle } = {}) => button({
  children: s, disabled: o.deshabilitado, onClick: () => alTocar(),
  style: { ...ESTILO_BOTON, ...VARIANTE[v], ...(o.ancho ? { width: "100%" } : {}), ...(o.deshabilitado ? { opacity: 0.5, cursor: "not-allowed" } : {}), ...o.style },
});
export const botonLink = (s: string, href: string, v: Variante = "primario", style?: NubeComponentStyle) =>
  link({ children: s, href, style: { ...ESTILO_BOTON, ...VARIANTE[v], ...style } });

/** La estrella llena de Material Symbols (la que usa gad-icon "star" con FILL 1). */
const ESTRELLA = "M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z";
export const estrella = (lado: number, color: string) =>
  svgRoot({ viewBox: "0 0 24 24", width: lado, height: lado, children: [svgPath({ d: ESTRELLA, fill: color })], style: { display: "block", flex: "none" } });

/** Cinco estrellas con relleno parcial (gad-p-stars: la base gris y encima el relleno cortado al %). */
export const estrellas = (nota: number, lado = 18, lleno = "#F5B301", vacio = "#E1E1E1") => box({
  children: [
    box({ children: Array.from({ length: 5 }, () => estrella(lado, vacio)), style: { display: "inline-flex" } }),
    box({ children: Array.from({ length: 5 }, () => estrella(lado, lleno)), style: { position: "absolute", top: "0", left: "0", display: "inline-flex", overflow: "hidden", width: `${Math.max(0, Math.min(5, nota)) * 20}%` } }),
  ],
  style: { position: "relative", display: "inline-flex", flex: "none", lineHeight: "1" },
});

/** Un ícono de trazo (24 px de caja, como los SVG de los .liquid). */
export const trazo = (d: string, lado: number, grosor = 2) =>
  svgRoot({ viewBox: "0 0 24 24", width: lado, height: lado, children: [svgPath({ d, fill: "none", stroke: "currentColor", strokeWidth: grosor, strokeLinecap: "round", strokeLinejoin: "round" })], style: { display: "block", flex: "none" } });

export const foto = (url: string, alt: string, lado: number, radio = 6) =>
  img({ src: url, alt, style: { width: `${lado}px`, height: `${lado}px`, objectFit: "cover", borderRadius: `${radio}px`, display: "block", flex: "none" } });

/** El recuadro gris que Gadsden muestra cuando falta una imagen. */
export const sinFoto = (style?: NubeComponentStyle) => box({ style: { background: mezcla(4), ...style } });

export const casilla = (nombre: string, marcada: boolean, cambiar: (v: boolean) => void) =>
  check({ name: nombre, label: "", checked: marcada, onChange: ({ value }) => cambiar(!!value) });

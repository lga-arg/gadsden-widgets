import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { crearMotor } from "./motor.ts";
import { armarSeccion } from "./seccion.ts";
import { ajustesLiquid } from "./tema.ts";
import { TEXTOS } from "./textos.ts";
import { productoLiquid } from "./producto.ts";

const V = new URL("../../vendor/gadsden/", import.meta.url);
const leerCarpeta = (c: string) => Object.fromEntries(readdirSync(new URL(c, V)).filter((f) => f.endsWith(".liquid"))
  .map((f) => [f.replace(".liquid", ""), readFileSync(new URL(`${c}${f}`, V), "utf8")]));
const propias = Object.fromEntries(readdirSync(new URL("secciones/", import.meta.url)).filter((f) => f.endsWith(".liquid")).map((f) => [f.replace(".liquid", ""), readFileSync(new URL(`secciones/${f}`, import.meta.url), "utf8")]));
const secciones = { ...leerCarpeta("sections/"), ...propias };
const propios = Object.fromEntries(readdirSync(new URL("snippets/", import.meta.url)).map((f) => [f.replace(".liquid", ""), readFileSync(new URL(`snippets/${f}`, import.meta.url), "utf8")]));
const snippets = { ...propios, ...leerCarpeta("snippets/") };
const json = (f: string) => JSON.parse(readFileSync(new URL(`config/${f}`, V), "utf8"));
const settings = ajustesLiquid(json("defaults.json"), json("ajustes-oscuro.json"));
const textos = { ...TEXTOS, ...json("es-gadsden.json") };
const VACIAS = new Set(["gad-music-global", "gad-promo-popup", "gad-reviews-mini", "gad-reviews-wall"]);

// Un producto de ficha con dos variantes (una sin stock), como el que manda el script.
const product = productoLiquid({
  id: 1, nombre: "Prueba", handle: "prueba", url: "/products/prueba", imagenes: [{ src: "https://cdn.test/a.jpg" }], opciones: ["Color"],
  variantes: [{ id: 11, precio: 1000, precioAntes: 1500, disponible: true, valores: ["Rojo"] }, { id: 12, precio: 1000, precioAntes: null, disponible: false, valores: ["Azul"] }],
});

test("todas las secciones gad-* se dibujan sin errores con su preset, en una ficha", async () => {
  const fallas: string[] = [];
  for (const [nombre, fuente] of Object.entries(secciones)) {
    const { dibujar } = crearMotor({ secciones, snippets, textos }, { simbolo: "$", codigo: "ARS" }, "/w/a/");
    try {
      const section = armarSeccion(`prueba-${nombre}`, fuente, { type: nombre });
      const { html } = await dibujar(nombre, fuente, { section, settings, product, all_products: new Proxy({}, { get: () => product }), request: { design_mode: false, page_type: "product", locale: { iso_code: "es" } } });
      // Vacías con sus valores de fábrica también en Shopify: dependen de bloques o de un ajuste prendido.
      if (!html.trim() && !VACIAS.has(nombre)) fallas.push(`${nombre}: vacío`);
    } catch (e) {
      fallas.push(`${nombre}: ${String(e).slice(0, 200)}`);
    }
  }
  assert.deepEqual(fallas, []);
});

test("una variable suelta sin definir es nil, como en Shopify (size en gad-icon)", async () => {
  const { dibujar } = crearMotor({ secciones, snippets, textos }, { simbolo: "$", codigo: "ARS" }, "/w/a/");
  const { html } = await dibujar("x", "{% render 'gad-icon', name: 'arrow_left' %}", {});
  assert.ok(!html.includes("font-size"), html);
});

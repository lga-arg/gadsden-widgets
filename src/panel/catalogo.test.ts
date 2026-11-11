import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { armarCatalogo, LUGARES, textosDe, traducirCatalogo, type ItemCatalogo } from "./catalogo.ts";

const carpeta = (c: string) => Object.fromEntries(readdirSync(c).filter((f) => f.endsWith(".liquid")).map((f) => [f.replace(".liquid", ""), readFileSync(c + f, "utf8")]));

test("el catálogo del panel: las 54 secciones y los 26 bloques, con su schema y sus lugares", () => {
  const secciones = { ...carpeta("vendor/gadsden/sections/"), ...carpeta("src/w/secciones/") };
  const c = armarCatalogo(secciones, JSON.parse(readFileSync("vendor/gadsden/config/bloques.json", "utf8")));
  assert.equal(c.filter((x) => x.clase === "seccion").length, 54);
  assert.equal(c.filter((x) => x.clase === "bloque").length, 26);
  for (const x of c) {
    assert.ok(x.nombre && x.esquema, x.type);
    assert.ok(x.lugares.includes(x.lugar) && x.lugares.every((l) => l in LUGARES), x.type);
  }
  const de = (t: string) => c.find((x) => x.type === t)!;
  assert.equal(de("sticky_bar").lugar, "edge_bottom_center");
  assert.equal(de("gad-music-global").lugar, "corner_bottom_left");
  assert.equal(de("quantity_offers").lugar, "after_product_detail_add_to_cart");
  assert.equal(de("gad-testimonials").lugar, "after_dynamic_section_main_product");
  // Las copias configurables (white label) van en lugar de las de vendor: su schema trae los ajustes de color.
  assert.ok(de("gad-marquee").esquema.settings?.some((a) => a.id === "color_fondo"));
  assert.ok(de("gad-landing-skin").aviso);
  // Ninguna ayuda remite al editor ni a los descuentos de Shopify.
  const textos = c.flatMap((x) => [...(x.esquema.settings ?? []), ...(x.esquema.blocks ?? []).flatMap((b) => b.settings ?? [])]).flatMap((a) => [a.label, a.info, a.content]);
  assert.deepEqual(textos.filter((t) => typeof t === "string" && /Shopify|Configuración del tema/.test(t)), []);
  assert.match(String(de("quantity_offers").esquema.settings?.[0]?.content), /Descuentos de tu tienda/);
  // Popup promocional: en Tiendanube el email no se guarda, así que el formulario sale apagado y con su aviso.
  const formulario = de("gad-promo-popup").esquema.settings?.find((a) => a.id === "email_form");
  assert.equal(formulario?.default, false);
  assert.match(String(formulario?.info), /no se guarda/);
});

test("el catálogo en portugués: cada texto que ve el comerciante tiene traducción y los valores de fábrica no se tocan", () => {
  const c = armarCatalogo({ ...carpeta("vendor/gadsden/sections/"), ...carpeta("src/w/secciones/") }, JSON.parse(readFileSync("vendor/gadsden/config/bloques.json", "utf8")));
  const pt = JSON.parse(readFileSync("src/panel/catalogo.pt.json", "utf8")) as Record<string, string>;
  // Si Gadsden suma un ajuste: node herramientas/textos-catalogo.mjs lista los que faltan.
  assert.deepEqual(textosDe(c).filter((s) => !(s in pt)), []);
  const t = traducirCatalogo(c, pt, "pt");
  const de = (x: ItemCatalogo[], tipo: string) => x.find((y) => y.type === tipo)!;
  assert.equal(de(t, "quantity_offers").nombre, "Descontos por quantidade");
  assert.deepEqual(de(t, "gad-testimonials").esquema.presets, de(c, "gad-testimonials").esquema.presets);
  assert.deepEqual(de(t, "gad-testimonials").esquema.settings?.map((a) => a.default), de(c, "gad-testimonials").esquema.settings?.map((a) => a.default));
  assert.deepEqual(t.map((x) => x.type).sort(), c.map((x) => x.type).sort());
});

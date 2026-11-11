// Arma lo que publica el Worker estático (wrangler.toml, [assets] -> dist/):
// - el script de NubeSDK: src/main.ts -> dist/main.min.js (ESM minificado que exporta `App`, como create-nube-app);
// - la configuración de fábrica de las dos tiendas de prueba: dist/config/<id>.json (la DEMO). La de cada tienda la
//   guarda el panel en KV y la sirve el Worker en /config/<id>.json; si no hay, sirve este archivo;
// - dist/_headers: la tienda los carga desde otro origen (CORS) y en desarrollo no tienen que quedar en caché;
// - dist/arnes/: el arnés para ver los widgets sin la tienda (arnes/index.html), con su copia del script;
// - dist/panel/: el panel de la app en el admin de Tiendanube (src/panel/, React + Nimbus + Nexo) y su catálogo;
// - dist/preview.js: la vista previa en la tienda real sin NubeSDK (src/vista.ts), sólo para probar;
// - dist/editor.js: la vista previa del editor del panel (src/vista.ts con EDITOR), dentro de la página que trae el Worker;
// - dist/pegar.js: el código para pegar del panel (src/vista.ts con PEGADO), sin NubeSDK;
// - dist/privacidad.html y dist/soporte.html: las páginas que pide la ficha de la Tienda de Aplicaciones (src/paginas/);
// - dist/w/: la página del iframe que dibuja cada widget con el código original de Gadsden (src/w/): widget.js, el
//   Liquid y los ajustes en fuentes/ (uno común y uno por sección o bloque), y en a/ los CSS, JS y la fuente de
//   vendor/gadsden más la base propia.
// Uso: node construir.mjs [URL pública]   (por defecto, el Worker publicado).
import { build } from "esbuild";
import { copyFileSync, cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DEMO } from "./src/config.ts";
import { armarCatalogo, traducirCatalogo } from "./src/panel/catalogo.ts";

const base = process.argv[2] ?? "https://gadsden-widgets-tn.gerolopezge.workers.dev";
await build({
  entryPoints: ["src/main.ts"], bundle: true, format: "esm", minify: true, target: "es2022",
  outfile: "dist/main.min.js", define: { BASE: JSON.stringify(base) },
});
// En el arnés la configuración se pide al mismo origen.
await build({
  entryPoints: ["src/main.ts"], bundle: true, format: "esm", target: "es2022",
  outfile: "dist/arnes/widgets.min.js", define: { BASE: '""' },
});
cpSync("arnes", "dist/arnes", { recursive: true });
// La vista previa en la tienda real sin NubeSDK (el marcador del panel la carga desde el Worker).
await build({ entryPoints: ["src/vista.ts"], bundle: true, format: "iife", minify: true, target: "es2020", outfile: "dist/preview.js", define: { BASE: JSON.stringify(base), PEGADO: "false", EDITOR: "false" } });
// La vista previa del editor del panel: la página de la tienda que trae el Worker (/tienda/<id>/...), con la capa de edición.
await build({ entryPoints: ["src/vista.ts"], bundle: true, format: "iife", minify: true, target: "es2020", outfile: "dist/editor.js", define: { BASE: JSON.stringify(base), PEGADO: "false", EDITOR: "true" } });
// El código para pegar: el mismo motor, en el lugar del <div data-gadsden> que pegó el comerciante.
await build({ entryPoints: ["src/vista.ts"], bundle: true, format: "iife", minify: true, target: "es2020", outfile: "dist/pegar.js", define: { BASE: JSON.stringify(base), PEGADO: "true", EDITOR: "false" } });

// La página del iframe.
await build({ entryPoints: ["src/w/pagina.ts"], bundle: true, format: "esm", minify: true, target: "es2022", outfile: "dist/w/widget.js" });
const V = "vendor/gadsden/";
// Sin los {% comment %} del Liquid: no se ven y sólo engordan lo que baja el iframe.
const sinComentarios = (t) => t.replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, "");
// White label (BUILD.md, decisión 20): fuera los comentarios de CSS. Las clases del schema con el nombre de una tienda
// ya no existen desde Gadsden 1.2.9 (vendor/gadsden).
const sinMarcas = (t, n) => t.replace(/(<style[^>]*>|\{%-?\s*style\s*-?%\})([\s\S]*?)(<\/style>|\{%-?\s*endstyle\s*-?%\})/g, (_, a, css, b) => a + css.replace(/\/\*[\s\S]*?\*\//g, "") + b);
const carpeta = (c) => Object.fromEntries(readdirSync(c).filter((f) => f.endsWith(".liquid")).map((f) => [f.replace(".liquid", ""), sinMarcas(sinComentarios(readFileSync(c + f, "utf8")), f.replace(".liquid", ""))]));

const json = (f) => JSON.parse(readFileSync(V + "config/" + f, "utf8"));
// Las secciones de src/w/secciones/ van en lugar de las de Gadsden: las que se volvieron configurables (white label,
// con colores y letras de la tienda y textos neutros; ver BUILD.md).
const secciones = { ...carpeta(V + "sections/"), ...carpeta("src/w/secciones/") };
// Los snippets de Dawn que Gadsden pide y no trae (loading-spinner, price...): escritos de cero en src/w/snippets/.
const snippets = { ...carpeta("src/w/snippets/"), ...carpeta(V + "snippets/") };
const oscuro = JSON.parse(readFileSync("src/w/oscuro.json", "utf8"));
// Las fuentes del Liquid, partidas: cada iframe pide la común y la de su sección o bloque (src/w/pagina.ts), no todas.
// - fuentes/comun.json: los textos y los ajustes del tema;
// - fuentes/secciones/<tipo>.json: la sección, los snippets que pide con {% render %} (y los que piden esos) y lo que le
//   pone el estilo "oscuro";
// - fuentes/bloques/<tipo>.json: los snippets de gad-product-block (dibuja todos los bloques) y el schema de ese bloque.
const usa = (liquid) => [...liquid.matchAll(/\b(?:render|include)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
function snippetsDe(liquid) {
  const usados = {}, pila = usa(liquid);
  while (pila.length) {
    const n = pila.pop();
    if (n in usados || !(n in snippets)) continue;
    usados[n] = snippets[n];
    pila.push(...usa(snippets[n]));
  }
  return usados;
}
rmSync("dist/w/fuentes.json", { force: true });
for (const d of ["secciones", "bloques"]) mkdirSync(`dist/w/fuentes/${d}`, { recursive: true });
writeFileSync("dist/w/fuentes/comun.json", JSON.stringify({
  textos: json("es-gadsden.json"), ajustes: { defaults: json("defaults.json"), oscuro: json("ajustes-oscuro.json"), clasico: json("clasico.json") },
}));
for (const [tipo, liquid] of Object.entries(secciones)) {
  writeFileSync(`dist/w/fuentes/secciones/${tipo}.json`, JSON.stringify({ secciones: { [tipo]: liquid }, snippets: snippetsDe(liquid), oscuro: oscuro[tipo] ? { [tipo]: oscuro[tipo] } : {} }));
}
const deLosBloques = snippetsDe("{% render 'gad-product-block' %}");
for (const b of json("bloques.json")) writeFileSync(`dist/w/fuentes/bloques/${b.type}.json`, JSON.stringify({ snippets: deLosBloques, bloques: [b] }));
mkdirSync("dist/w/a", { recursive: true });
for (const f of readdirSync(V + "assets")) copyFileSync(V + "assets/" + f, "dist/w/a/" + f);
copyFileSync("src/w/base.css", "dist/w/a/base.css");
copyFileSync("src/w/index.html", "dist/w/index.html");
// El centinela de la barra fija (src/w/centinela.html): sólo mira si el botón de comprar del theme salió de la pantalla.
copyFileSync("src/w/centinela.html", "dist/w/centinela.html");
// El correo de soporte (wrangler.toml): lo muestran el panel, /privacidad y /soporte.
const soporte = /SOPORTE_EMAIL = "([^"]*)"/.exec(readFileSync("wrangler.toml", "utf8"))?.[1] || "[VERIFICAR: correo de soporte]";
if (soporte.startsWith("[")) console.log("Falta SOPORTE_EMAIL en wrangler.toml: /privacidad y /soporte salen sin correo.");
// El panel: el client id de la app (wrangler.toml) para Nexo; el catálogo sale de los schemas que dibuja el iframe.
await build({
  entryPoints: ["src/panel/main.tsx"], bundle: true, format: "esm", minify: true, target: "es2022", jsx: "automatic",
  outfile: "dist/panel/panel.js", define: { CLIENT_ID: JSON.stringify(/CLIENT_ID = "(\d+)"/.exec(readFileSync("wrangler.toml", "utf8"))[1]), SOPORTE: JSON.stringify(soporte), "process.env.NODE_ENV": '"production"', global: "globalThis" },
});
copyFileSync("src/panel/index.html", "dist/panel/index.html");
cpSync("src/panel/miniaturas", "dist/panel/miniaturas", { recursive: true });
// El catálogo en español y en portugués (src/panel/catalogo.pt.json; el panel pide el del idioma de la tienda).
const catalogo = armarCatalogo(secciones, json("bloques.json"));
writeFileSync("dist/panel/catalogo.json", JSON.stringify(catalogo));
writeFileSync("dist/panel/catalogo.pt.json", JSON.stringify(traducirCatalogo(catalogo, JSON.parse(readFileSync("src/panel/catalogo.pt.json", "utf8")), "pt")));
mkdirSync("dist/config", { recursive: true });
for (const tienda of ["8359789", "8379453"]) writeFileSync(`dist/config/${tienda}.json`, JSON.stringify(DEMO));
// Las páginas de privacidad y de soporte, con el correo de soporte; en portugués (Nuvemshop), en /pt/.
mkdirSync("dist/pt", { recursive: true });
for (const f of ["privacidad", "soporte", "pt/privacidad", "pt/soporte"]) writeFileSync(`dist/${f}.html`, readFileSync(`src/paginas/${f}.html`, "utf8").replaceAll("{{SOPORTE}}", soporte));
// El ícono de la app (la serpiente de Gadsden, docs/homologacion/icono.svg): favicon y encabezado del panel y de esas páginas.
for (const f of ["icono.svg", "icono-200.png"]) copyFileSync(`src/paginas/${f}`, `dist/${f}`);
// El panel sólo se deja enmarcar por el admin de Tiendanube y Nuvemshop (los dominios que la tienda misma acepta en su
// frame-ancestors; 'self' es el admin simulado de arnes/admin.html). /w/ queda abierto: lo enmarca cada tienda.
const admin = ["mitiendanube.com", "lojavirtualnuvem.com.br", "mitiendanube.com.ar", "mitiendanube.com.mx", "mitiendanube.com.co", "mitiendanube.cl"];
const marcos = ["'self'", ...admin.flatMap((d) => [`https://${d}`, `https://*.${d}`])].join(" ");
writeFileSync("dist/_headers", `/*\n  Access-Control-Allow-Origin: *\n  Cache-Control: no-cache\n/panel/*\n  Content-Security-Policy: frame-ancestors ${marcos}\n`);
console.log(`dist/: main.min.js (BASE ${base}), config/*.json`);

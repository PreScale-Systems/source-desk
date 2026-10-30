import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const samples = {
 '/sample-inventory.csv': await readFile(path.join(root,'public/sample-inventory.csv'),'utf8'),
 '/sample-distributor-replies.txt': await readFile(path.join(root,'public/sample-distributor-replies.txt'),'utf8'),
};
const entry = `
import React from "react";
import {createRoot} from "react-dom/client";
import App from "./app/page.tsx";
const realFetch = window.fetch.bind(window);
window.fetch = (input, options) => input === "/api/ai" ? Promise.resolve(Response.json({error:"The standalone demo uses sample rules. Run the full app server to enable Nemotron."},{status:503})) : realFetch(input, options);
const samples = ${JSON.stringify(samples)};
document.addEventListener("click", event => {
 const anchor = event.target.closest?.("a");
 const name = anchor?.getAttribute("href");
 if (name && Object.hasOwn(samples, name)) {
  event.preventDefault();
  const url = URL.createObjectURL(new Blob([samples[name]], {type:"text/plain"}));
  const link = document.createElement("a"); link.href=url; link.download=name.slice(1); link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
});
createRoot(document.getElementById("root")).render(React.createElement(App));
`;
const result = await build({
 stdin: { contents: entry, resolveDir: root, sourcefile: 'standalone-entry.tsx', loader: 'tsx' },
 bundle: true, write: false, minify: true, format: 'iife', platform: 'browser', target: 'es2020', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, tsconfig: path.join(root,'tsconfig.json'),
});
const css = (await readFile(path.join(root,'app/globals.css'),'utf8')).replace(/^@import[^;]+;/gm,'');
const js = result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
await mkdir(path.join(root,'outputs'),{recursive:true});
await writeFile(path.join(root,'outputs/SourceDesk-demo.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SourceDesk · Standalone Sample Demo</title><style>'+css+'</style></head><body><div id="root"></div><script>'+js+'</script></body></html>');
console.log('outputs/SourceDesk-demo.html');

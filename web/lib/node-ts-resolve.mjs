// Lets `node --test` load web/lib/*.ts, whose relative imports have no extension (as
// Next.js wants). Node 22+ strips the types itself; this only adds ".ts" when resolving.
//   cd web && node --import ./lib/node-ts-resolve.mjs --test lib/lib.test.mjs
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (/^\\.{1,2}\\//.test(spec) && !/\\.[cm]?[jt]sx?$/.test(spec)) {
    try { return await next(spec + ".ts", ctx); } catch {}
  }
  return next(spec, ctx);
}`),
  import.meta.url,
);

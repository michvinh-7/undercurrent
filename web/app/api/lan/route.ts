// The laptop's own network addresses (IPv4, not loopback), for links a phone has to open:
// a QR code built on http://localhost:3000 would point the phone at itself. Read by the cell
// invite (app/cell/page.tsx). Private ranges first: those are the Wi-Fi or hotspot address.
import { networkInterfaces } from "node:os";

export const dynamic = "force-dynamic";

const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

export function GET() {
  const all = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => a!.address);
  const addresses = [...all.filter((a) => PRIVATE.test(a)), ...all.filter((a) => !PRIVATE.test(a))];
  return Response.json({ addresses });
}
